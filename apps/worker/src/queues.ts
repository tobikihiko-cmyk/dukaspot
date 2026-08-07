import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { JobEnvelopeSchema, type JobEnvelope } from "@dukaspot/contracts";
import type { WorkerConfig } from "@dukaspot/config";
import { createLogger } from "@dukaspot/observability";

export const QUEUE_NAMES = {
  whatsappInbound: "whatsapp-inbound",
  whatsappOutbound: "whatsapp-outbound",
  darajaCallbacks: "daraja-callbacks",
  paymentReconciliation: "payment-reconciliation",
  ledgerPosting: "ledger-posting",
  dailyMerchantClose: "daily-merchant-close",
  reportGeneration: "report-generation",
  importProcessing: "import-processing",
  inventoryAlerts: "inventory-alerts",
  deadLetter: "dead-letter",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function createRedisConnection(config: WorkerConfig) {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function createTenantQueue(
  name: QueueName,
  connection: Redis
): Queue<JobEnvelope> {
  return new Queue<JobEnvelope>(name, {
    connection,
    defaultJobOptions: defaultJobOptions(),
  });
}

export function defaultJobOptions(): JobsOptions {
  return {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1_000,
    },
    removeOnComplete: 1_000,
    removeOnFail: false,
  };
}

export function createLoggingWorker(
  name: QueueName,
  config: WorkerConfig,
  connection: Redis
) {
  const logger = createLogger({
    service: `dukaspot-worker:${name}`,
    environment: config.nodeEnv,
    level: config.logLevel,
  });

  const worker = new Worker<JobEnvelope>(
    name,
    async (job) => {
      const envelope = JobEnvelopeSchema.parse(job.data);
      logger.info(
        {
          queue: name,
          jobId: job.id,
          jobType: envelope.jobType,
          merchantId: envelope.merchantId,
          correlationId: envelope.correlationId,
          idempotencyKey: envelope.idempotencyKey,
          sourceEventId: envelope.sourceEventId,
          attempt: job.attemptsMade,
        },
        "Received queued job"
      );
      return { accepted: true };
    },
    { connection }
  );

  worker.on("failed", (job, error) => {
    logger.error(
      {
        queue: name,
        jobId: job?.id,
        merchantId: job?.data?.merchantId,
        correlationId: job?.data?.correlationId,
        error: error.message,
      },
      "Job failed"
    );
  });

  return worker;
}
