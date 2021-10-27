#!/usr/bin/env node
require("dotenv").config();
const graceful = require("node-graceful");
const logger = require("pino")();
const app = require("./server").create();

// app.listen returns nodejs' http.Server, which we need to close it gracefully
const server = app.listen(app.port, app.host, () => {
  logger.info({ port: app.port, hostname: app.host }, "Starting mjml api server");
});

graceful.on("exit", (done, event, signal) => {
  logger.info(`Received ${signal} signal - exiting gracefully`);
  server.close(done);
});
