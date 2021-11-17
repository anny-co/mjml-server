const express = require("express");
const mjml = require("mjml");
const pino = require("pino-http")();
const logger = require("pino")();
const authentication = require("./authentication");
const pkg = require("./package.json");

/**
 * Factory function for mjml API servers
 * @param {Record<string, unknown>} factoryOptions override options for the configuration of the server
 * @returns express server application with handlers attached
 */
function serverFactory (factoryOptions) {
  const options = {
    host: process.env.HOST || "0.0.0.0",
    port: process.env.PORT || "80",
    keepComments: Boolean(process.env.KEEP_COMMENTS) || true,
    beautify: Boolean(process.env.BEAUTIFY) || false,
    minify: Boolean(process.env.MINIFY) || false,
    validationLevel: process.env.VALIDATION_LEVEL || "soft", // choices: "strict", "soft", "skip"
    maxBody: process.env.MAX_BODY || "1mb",
    "mjml-version": pkg.dependencies.mjml, // requires launching through either npm or yarn, but not directly node,
    authentication: {
      enabled: Boolean(process.env.AUTH_ENABLED) || false,
      type: process.env.AUTH_TYPE === "token" ? "token" : process.env.AUTH_TYPE === "basic" ? "basic" : "none",
      basicAuth: {
        username: process.env.BASIC_AUTH_USERNAME,
        password: process.env.BASIC_AUTH_PASSWORD
      },
      token: {
        secret: process.env.AUTH_TOKEN
      }
    },
    ...factoryOptions
  };

  const app = express();

  // Parse request body to a buffer, as it might contain JSON but doesn't have to
  app.use(express.raw({
    type: () => true,
    limit: options.maxBody
  }));

  // minimal JSON logging middleware
  app.use(pino);

  logger.info({ config: options }, "Parsed configuration");

  // main API endpoint for mjml renderer
  app.post("/v1/render", authentication(options.authentication), (req, res, next) => {
    let mjmlText;

    // attempt to parse JSON off of body
    try {
      // req.body is a Buffer, see express.raw()
      mjmlText = JSON.parse(req.body.toString()).mjml;
    } catch (err) {
      mjmlText = req.body.toString();
    }

    let result;
    const config = {
      keepComments: options.keepComments,
      beautify: options.beautify, // TODO(fibis): no longer supported in mjml ^4.0.0, see deprectation notice
      minify: options.minify, // TODO(fibis): no longer supported in mjml ^4.0.0, see deprectation notice
      validationLevel: options.validationLevel
    };
    try {
      result = mjml(mjmlText, config);
    } catch (err) {
      req.log.error(err);
      res.status(500).send({ message: "Failed to compile mjml", ...err });
      next(err);
      return;
    }

    const { html, errors } = result;

    res.send({
      html,
      mjml: mjmlText,
      mjml_version: options["mjml-version"],
      errors
    });
  });

  // Generic healthchecking endpoints
  app.get(["/healthz", "/livez", "/readyz"], (_, res) => res.status(200).end());

  return Object.assign(app, {
    port: options.port,
    host: options.host
  });
}

module.exports = {
  create: serverFactory
};
