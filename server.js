import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import mjml2html from "mjml";
import { LRUCache } from "lru-cache";
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge
} from "prom-client";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
);

/**
 * Parse a boolean-ish env var. Accepts "true"/"1"/"yes"/"on" (case-insensitive).
 * Returns `fallback` when unset/empty.
 * @param {string|undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function parseBool (value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

/**
 * Constant-time string equality.
 * @param {string} input
 * @param {string} secret
 * @returns {boolean}
 */
export function safeCompare (input, secret) {
  if (typeof input !== "string" || typeof secret !== "string") return false;
  const il = Buffer.byteLength(input);
  const sl = Buffer.byteLength(secret);
  const max = Math.max(il, sl, 1);
  const ib = Buffer.alloc(max, 0, "utf8"); ib.write(input);
  const sb = Buffer.alloc(max, 0, "utf8"); sb.write(secret);
  return il === sl && timingSafeEqual(ib, sb);
}

/**
 * Parse `Authorization: Basic <base64>`.
 * @param {string|undefined} header
 * @returns {{ name: string, pass: string } | null}
 */
export function parseBasicAuth (header) {
  if (!header || typeof header !== "string") return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "basic" || !value) return null;
  let decoded;
  try { decoded = Buffer.from(value, "base64").toString("utf8"); } catch { return null; }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return { name: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

function resolveOptions (factoryOptions = {}) {
  return {
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT) || 80,
    keepComments: parseBool(process.env.KEEP_COMMENTS, true),
    beautify: parseBool(process.env.BEAUTIFY, false),
    minify: parseBool(process.env.MINIFY, false),
    sanitizeStyles: parseBool(process.env.SANITIZE_STYLES, false),
    validationLevel: process.env.VALIDATION_LEVEL || "soft",
    maxBody: Number(process.env.MAX_BODY_BYTES) || 1024 * 1024,
    cacheEnabled: parseBool(process.env.CACHE_ENABLED, true),
    cacheMax: Number(process.env.CACHE_MAX) || 500,
    cacheTtlMs: Number(process.env.CACHE_TTL_MS) || 0,
    metricsEnabled: parseBool(process.env.METRICS_ENABLED, true),
    "mjml-version": pkg.dependencies.mjml,
    authentication: {
      enabled: parseBool(process.env.AUTH_ENABLED, false),
      type: process.env.AUTH_TYPE === "token"
        ? "token"
        : process.env.AUTH_TYPE === "basic" ? "basic" : "none",
      basicAuth: {
        username: process.env.BASIC_AUTH_USERNAME,
        password: process.env.BASIC_AUTH_PASSWORD
      },
      token: { secret: process.env.AUTH_TOKEN }
    },
    ...factoryOptions
  };
}

/**
 * Build a configured Fastify instance exposing /v1/render and health endpoints.
 * @param {Record<string, unknown>} factoryOptions overrides for env-driven options
 * @returns {import("fastify").FastifyInstance & { listenOpts: { host: string, port: number } }}
 */
export function create (factoryOptions = {}) {
  const options = resolveOptions(factoryOptions);

  const app = Fastify({
    bodyLimit: options.maxBody,
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers[\"x-authentication-token\"]",
          "res.headers[\"set-cookie\"]"
        ],
        censor: "[REDACTED]"
      }
    }
  });

  // Accept any content type — legacy clients POST raw MJML without a JSON wrapper.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  const cache = options.cacheEnabled
    ? new LRUCache({
      max: options.cacheMax,
      ...(options.cacheTtlMs > 0 ? { ttl: options.cacheTtlMs } : {})
    })
    : null;

  // Prometheus metrics — per-process registry. Under cluster mode each worker
  // exposes its own /metrics; have your scraper target the service or aggregate
  // with prom-client's AggregatorRegistry behind a separate sidecar if needed.
  const registry = options.metricsEnabled ? new Registry() : null;
  const metrics = registry
    ? {
        renderDuration: new Histogram({
          name: "mjml_render_duration_seconds",
          help: "MJML render duration in seconds",
          labelNames: ["status", "cache"],
          buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
          registers: [registry]
        }),
        renderTotal: new Counter({
          name: "mjml_renders_total",
          help: "Total number of MJML render requests",
          labelNames: ["status", "cache"],
          registers: [registry]
        }),
        cacheSize: cache
          ? new Gauge({
            name: "mjml_cache_size",
            help: "Current number of entries in the response cache",
            registers: [registry],
            collect () { this.set(cache.size); }
          })
          : null,
        cacheMax: cache
          ? new Gauge({
            name: "mjml_cache_max",
            help: "Configured maximum number of entries in the response cache",
            registers: [registry]
          })
          : null
      }
    : null;
  if (registry) {
    collectDefaultMetrics({ register: registry, prefix: "mjml_server_" });
    if (metrics.cacheMax) metrics.cacheMax.set(options.cacheMax);
  }

  app.log.info(
    {
      config: {
        ...options,
        authentication: {
          ...options.authentication,
          basicAuth: "[REDACTED]",
          token: "[REDACTED]"
        }
      }
    },
    "Parsed configuration"
  );

  function authenticate (req, reply, done) {
    const a = options.authentication;
    if (!a.enabled || a.type === "none") return done();

    if (a.type === "basic") {
      const creds = parseBasicAuth(req.headers.authorization);
      if (
        creds &&
        safeCompare(creds.name, a.basicAuth.username || "") &&
        safeCompare(creds.pass, a.basicAuth.password || "")
      ) return done();
      return reply.code(401).send();
    }

    if (a.type === "token") {
      const token = req.query.token || req.headers["x-authentication-token"];
      if (token && safeCompare(String(token), a.token.secret || "")) return done();
      return reply.code(401).send();
    }

    return reply.code(401).send();
  }

  app.post("/v1/render", { preHandler: authenticate }, async (req, reply) => {
    const endTimer = metrics ? metrics.renderDuration.startTimer() : null;
    let cacheLabel = "disabled";
    let statusLabel = "ok";

    const raw = req.body;
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");

    let mjmlText;
    try {
      const parsed = JSON.parse(text);
      mjmlText = typeof parsed?.mjml === "string" ? parsed.mjml : text;
    } catch {
      mjmlText = text;
    }

    const config = {
      keepComments: options.keepComments,
      beautify: options.beautify,
      minify: options.minify,
      sanitizeStyles: options.sanitizeStyles,
      validationLevel: options.validationLevel
    };

    let cacheKey;
    if (cache) {
      cacheKey = createHash("sha256")
        .update(mjmlText)
        .update("\0")
        .update(JSON.stringify(config))
        .digest("hex");
      const hit = cache.get(cacheKey);
      if (hit) {
        cacheLabel = "hit";
        reply.header("X-Cache", "HIT");
        if (metrics) {
          metrics.renderTotal.inc({ status: statusLabel, cache: cacheLabel });
          endTimer({ status: statusLabel, cache: cacheLabel });
        }
        return {
          html: hit.html,
          mjml: mjmlText,
          mjml_version: options["mjml-version"],
          errors: hit.errors
        };
      }
      cacheLabel = "miss";
    }

    let result;
    try {
      result = await mjml2html(mjmlText, config);
    } catch (err) {
      req.log.error(err);
      statusLabel = "error";
      if (metrics) {
        metrics.renderTotal.inc({ status: statusLabel, cache: cacheLabel });
        endTimer({ status: statusLabel, cache: cacheLabel });
      }
      return reply.code(500).send({ message: "Failed to compile mjml", ...err });
    }

    const { html, errors } = result;
    if (cache) {
      cache.set(cacheKey, { html, errors });
      reply.header("X-Cache", "MISS");
    }

    if (metrics) {
      metrics.renderTotal.inc({ status: statusLabel, cache: cacheLabel });
      endTimer({ status: statusLabel, cache: cacheLabel });
    }

    return {
      html,
      mjml: mjmlText,
      mjml_version: options["mjml-version"],
      errors
    };
  });

  if (registry) {
    app.get("/metrics", async (_req, reply) => {
      reply.header("content-type", registry.contentType);
      return registry.metrics();
    });
  }

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/livez", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ok" }));

  app.decorate("listenOpts", { host: options.host, port: options.port });

  return app;
}
