#!/usr/bin/env node
import "dotenv/config";
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { create } from "./server.js";

/**
 * WORKERS env controls the number of cluster workers:
 *   - unset / 0 / "auto" → CPU count
 *   - 1 → no clustering, run in-process
 *   - N → fork N workers
 */
function workerCount () {
  const v = (process.env.WORKERS || "auto").toLowerCase();
  if (v === "auto" || v === "" || v === "0") return availableParallelism();
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : availableParallelism();
}

async function startWorker () {
  const app = create();
  try {
    await app.listen(app.listenOpts);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal) => {
    app.log.info({ signal }, "Received signal, shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

const workers = workerCount();

if (workers <= 1 || !cluster.isPrimary) {
  await startWorker();
} else {
  // Primary: fork workers and restart any that die unexpectedly.
  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    // Don't respawn during graceful shutdown.
    if (worker.exitedAfterDisconnect) return;
    console.error(`worker ${worker.process.pid} died (code=${code} signal=${signal}); spawning replacement`);
    cluster.fork();
  });

  const shutdown = (signal) => {
    console.log(`primary received ${signal}, disconnecting workers`);
    for (const id in cluster.workers) cluster.workers[id]?.disconnect();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
