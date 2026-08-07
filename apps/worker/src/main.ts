import { loadWorkerConfig } from "@dukaspot/config";
import { createLogger } from "@dukaspot/observability";
import {
  createLoggingWorker,
  createRedisConnection,
  QUEUE_NAMES,
} from "./queues.js";

const config = loadWorkerConfig();
const logger = createLogger({
  service: "dukaspot-worker",
  environment: config.nodeEnv,
  level: config.logLevel,
});
const connection = createRedisConnection(config);
const workers = Object.values(QUEUE_NAMES).map((queueName) =>
  createLoggingWorker(queueName, config, connection)
);

logger.info(
  {
    redisUrl: config.redisUrl.replace(/\/\/.*@/, "//[redacted]@"),
    queues: Object.values(QUEUE_NAMES),
  },
  "Dukaspot worker started"
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: string) {
  logger.info({ signal }, "Stopping worker");
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  process.exit(0);
}
