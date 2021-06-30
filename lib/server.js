const express = require('express');
const mjml = require('mjml');

const { logger, middleware: loggingMiddleware } = require('./logging.js');
const { dependencies } = require('../package.json');

const renderEndpoint = '/v1/render';

/**
 * Render route request handler
 */
function handleRequest (req, res) {
  let mjmlText;

  // attempt to parse JSON off of body
  try {
    // req.body is a Buffer, see express.raw()
    mjmlText = JSON.parse(req.body.toString()).mjml;
  } catch (err) {
    mjmlText = req.body.toString();
  }

  let result;
  try {
    result = mjml(mjmlText, req.app.get('mjmlConfig'));
  } catch (err) {
    logger.error(err);
    res.status(400).send({ message: 'Failed to compile mjml', ...err });
    return; // exit express call chain early
  }

  const { html, errors } = result;

  res.send({
    html,
    mjml: mjmlText,
    mjml_version: dependencies.mjml,
    errors
  });
}

/**
 * Express server factory
 */
function create (argv) {
  const config = {
    keepComments: argv.keepComments,
    beautify: argv.beautify,
    minify: argv.minify,
    validationLevel: argv.validationLevel
  };

  logger.info('Using configuration:', config);

  const app = express();

  app.set('mjmlConfig', config);
  app.use(loggingMiddleware);

  // Parse request body to a buffer, as it might contain JSON but doesn't have
  app.use(express.raw({
    type: () => true,
    limit: argv.maxBody
  }));

  /** render endpoint */
  app.post(renderEndpoint, handleRequest);

  /** Fall-through route for all other requests */
  app.use((_, res) => {
    res.status(404).send({ message: `You're probably looking for ${renderEndpoint}` });
  });

  return app;
};

module.exports = {
  create
};
