import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { create } from "../server.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

const sampleMjml = `
  <mjml>
    <mj-body>
      <mj-section>
        <mj-column>
          <mj-text>Hello World!</mj-text>
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.path]
 * @param {string} [opts.body] raw body string
 * @param {boolean} [opts.json] wrap body as { mjml: body } JSON (default true)
 * @param {Record<string,string>} [opts.headers]
 */
async function post (url, { path = "/v1/render", body = "", json = true, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  let payload;
  if (json) {
    finalHeaders["content-type"] = finalHeaders["content-type"] || "application/json";
    payload = JSON.stringify({ mjml: body });
  } else {
    payload = body;
  }
  const res = await fetch(url + path, { method: "POST", headers: finalHeaders, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: Object.fromEntries(res.headers), data };
}

async function startServer (opts = {}) {
  const app = create({ ...opts });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, url: address };
}

describe("server", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ validationLevel: "strict", cacheEnabled: false })); });
  after(async () => { await app.close(); });

  test("renders valid mjml", async () => {
    const res = await post(url, { body: sampleMjml });
    assert.equal(res.status, 200);
    assert.match(res.data.html, /<!doctype html>/i);
    assert.equal(res.data.mjml, sampleMjml);
    assert.equal(res.data.mjml_version, pkg.dependencies.mjml);
    assert.deepEqual(res.data.errors, []);
  });

  test("returns 500 on validation errors", async () => {
    const res = await post(url, { body: "<mj-text foo=bar>hello</mj-text>" });
    assert.equal(res.status, 500);
    assert.equal(res.data.message, "Failed to compile mjml");
    assert.ok(Array.isArray(res.data.errors));
    assert.ok(res.data.errors[0]?.message?.toLowerCase().includes("illegal"));
  });

  test("returns 404 on unknown route", async () => {
    const res = await post(url, { path: "/", body: sampleMjml });
    assert.equal(res.status, 404);
  });

  test("backwards compatible with raw-body API", async () => {
    const res = await post(url, { body: sampleMjml, json: false, headers: { "content-type": "text/plain" } });
    assert.equal(res.status, 200);
    assert.match(res.data.html, /<!doctype html>/i);
  });
});

describe("body limit", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ maxBody: 64 })); });
  after(async () => { await app.close(); });

  test("returns 413 for payloads larger than maxBody", async () => {
    const huge = "o".repeat(10000);
    const res = await post(url, { body: huge });
    assert.equal(res.status, 413);
  });
});

describe("HTTP basic authentication", () => {
  let app, url;
  const username = "test_user";
  const password = "secreeeeet_pw";
  const basicHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  before(async () => {
    ({ app, url } = await startServer({
      authentication: { enabled: true, type: "basic", basicAuth: { username, password }, token: {} }
    }));
  });
  after(async () => { await app.close(); });

  test("authenticated request succeeds", async () => {
    const res = await post(url, { body: sampleMjml, headers: { authorization: basicHeader } });
    assert.equal(res.status, 200);
  });

  test("wrong credentials → 401", async () => {
    const bad = "Basic " + Buffer.from("mallory:admin123").toString("base64");
    const res = await post(url, { body: sampleMjml, headers: { authorization: bad } });
    assert.equal(res.status, 401);
  });

  test("missing credentials → 401", async () => {
    const res = await post(url, { body: sampleMjml });
    assert.equal(res.status, 401);
  });
});

describe("token authentication", () => {
  let app, url;
  const token = "bXlfc2VjcmV0X3Rva2Vu";

  before(async () => {
    ({ app, url } = await startServer({
      authentication: { enabled: true, type: "token", basicAuth: {}, token: { secret: token } }
    }));
  });
  after(async () => { await app.close(); });

  test("token via query param", async () => {
    const res = await post(url, { path: `/v1/render?token=${token}`, body: sampleMjml });
    assert.equal(res.status, 200);
  });

  test("token via header", async () => {
    const res = await post(url, { body: sampleMjml, headers: { "x-authentication-token": token } });
    assert.equal(res.status, 200);
  });

  test("wrong token in query → 401", async () => {
    const res = await post(url, { path: "/v1/render?token=wrong", body: sampleMjml });
    assert.equal(res.status, 401);
  });

  test("wrong token in header → 401", async () => {
    const res = await post(url, { body: sampleMjml, headers: { "x-authentication-token": "wrong" } });
    assert.equal(res.status, 401);
  });

  test("missing token → 401", async () => {
    const res = await post(url, { body: sampleMjml });
    assert.equal(res.status, 401);
  });
});

describe("response cache", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ cacheEnabled: true, cacheMax: 10 })); });
  after(async () => { await app.close(); });

  test("first request MISS, second HIT", async () => {
    const first = await post(url, { body: sampleMjml });
    assert.equal(first.status, 200);
    assert.equal(first.headers["x-cache"], "MISS");
    const second = await post(url, { body: sampleMjml });
    assert.equal(second.status, 200);
    assert.equal(second.headers["x-cache"], "HIT");
    assert.equal(second.data.html, first.data.html);
  });

  test("different MJML inputs do not collide", async () => {
    const a = sampleMjml.replace("Hello World!", "Variant A");
    const b = sampleMjml.replace("Hello World!", "Variant B");
    const ra = await post(url, { body: a });
    const rb = await post(url, { body: b });
    assert.equal(ra.headers["x-cache"], "MISS");
    assert.equal(rb.headers["x-cache"], "MISS");
    assert.notEqual(ra.data.html, rb.data.html);
    // Re-requesting both should now hit.
    assert.equal((await post(url, { body: a })).headers["x-cache"], "HIT");
    assert.equal((await post(url, { body: b })).headers["x-cache"], "HIT");
  });
});

describe("response cache eviction", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ cacheEnabled: true, cacheMax: 2 })); });
  after(async () => { await app.close(); });

  test("LRU evicts oldest entry when capacity exceeded", async () => {
    const docs = [1, 2, 3].map((n) => sampleMjml.replace("Hello World!", `doc-${n}`));
    // Fill cache with 2 entries, then push a 3rd → evicts doc-1.
    for (const d of docs) {
      const r = await post(url, { body: d });
      assert.equal(r.headers["x-cache"], "MISS");
    }
    // doc-1 should now be a MISS again (evicted).
    const evicted = await post(url, { body: docs[0] });
    assert.equal(evicted.headers["x-cache"], "MISS");
    // doc-3 should still be a HIT (most recently inserted).
    const fresh = await post(url, { body: docs[2] });
    assert.equal(fresh.headers["x-cache"], "HIT");
  });
});

describe("cache disabled", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ cacheEnabled: false })); });
  after(async () => { await app.close(); });

  test("does not set X-Cache header", async () => {
    const res = await post(url, { body: sampleMjml });
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-cache"], undefined);
  });
});

describe("health endpoints", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer()); });
  after(async () => { await app.close(); });

  for (const p of ["/healthz", "/livez", "/readyz"]) {
    test(`GET ${p} → 200`, async () => {
      const res = await fetch(url + p);
      assert.equal(res.status, 200);
    });
  }
});

describe("metrics endpoint", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ metricsEnabled: true, cacheEnabled: true })); });
  after(async () => { await app.close(); });

  test("GET /metrics exposes prometheus output and includes custom metrics", async () => {
    // Trigger one render so the histogram/counter have a sample.
    await post(url, { body: sampleMjml });
    const res = await fetch(url + "/metrics");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/plain/);
    const body = await res.text();
    assert.match(body, /mjml_renders_total/);
    assert.match(body, /mjml_render_duration_seconds_bucket/);
    assert.match(body, /mjml_cache_size/);
    assert.match(body, /mjml_server_process_cpu_user_seconds_total/);
  });

  test("counter labels reflect cache hit, miss, and error paths", async () => {
    const unique = sampleMjml.replace("Hello World!", `label-test-${Date.now()}`);
    await post(url, { body: unique });               // MISS
    await post(url, { body: unique });               // HIT
    const errRes = await post(url, { body: "<mj-text foo=bar>x</mj-text>" });
    assert.equal(errRes.status, 500);                // error path

    const body = await (await fetch(url + "/metrics")).text();
    // prom-client formats labels as: metric_name{label="value",...} <number>
    const findCounter = (labels) => {
      const re = new RegExp(`^mjml_renders_total\\{[^}]*${labels}[^}]*\\}\\s+(\\d+(?:\\.\\d+)?)`, "m");
      const m = body.match(re);
      return m ? Number(m[1]) : 0;
    };
    assert.ok(findCounter('cache="hit"') >= 1, "expected at least one cache=hit counter sample");
    assert.ok(findCounter('cache="miss"') >= 1, "expected at least one cache=miss counter sample");
    assert.ok(findCounter('status="error"') >= 1, "expected at least one status=error counter sample");
  });
});

describe("metrics disabled", () => {
  let app, url;
  before(async () => { ({ app, url } = await startServer({ metricsEnabled: false })); });
  after(async () => { await app.close(); });

  test("GET /metrics → 404", async () => {
    const res = await fetch(url + "/metrics");
    assert.equal(res.status, 404);
  });
});
