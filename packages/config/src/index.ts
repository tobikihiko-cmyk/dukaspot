import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

const baseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  SERVICE_NAME: z.string().min(1).default("dukaspot"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export const ApiConfigSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  HOST: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().optional(),
  DATABASE_URL: z.string().url().optional(),
  DUKASPOT_DATA_FILE: z.string().optional(),
  DUKASPOT_IDENTITY_FILE: z.string().optional(),
  DUKASPOT_MERCHANT_ID: z.string().min(1).default("pilot-merchant"),
});

export const WorkerConfigSchema = baseEnvSchema.extend({
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  DATABASE_URL: z.string().url().optional(),
  DUKASPOT_MERCHANT_ID: z.string().min(1).default("pilot-merchant"),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema> & {
  host: string;
  port: number;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  dataFile: string | undefined;
  identityFile: string | undefined;
  merchantId: string;
  nodeEnv: "development" | "test" | "production";
  serviceName: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
};

export type WorkerConfig = z.infer<typeof WorkerConfigSchema> & {
  redisUrl: string;
  databaseUrl: string | undefined;
  merchantId: string;
  nodeEnv: "development" | "test" | "production";
  serviceName: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
};

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ApiConfigSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV;

  if (nodeEnv === "production" && !parsed.CORS_ORIGIN) {
    throw new Error("CORS_ORIGIN is required in production");
  }

  if (nodeEnv === "production" && !parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }

  return {
    ...parsed,
    nodeEnv,
    host: parsed.HOST || (nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1"),
    port: parsed.PORT,
    corsOrigins: parseCsv(parsed.CORS_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173"),
    databaseUrl: parsed.DATABASE_URL,
    dataFile: parsed.DUKASPOT_DATA_FILE,
    identityFile: parsed.DUKASPOT_IDENTITY_FILE,
    merchantId: parsed.DUKASPOT_MERCHANT_ID,
    serviceName: parsed.SERVICE_NAME,
    logLevel: parsed.LOG_LEVEL,
  };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = WorkerConfigSchema.parse(env);

  return {
    ...parsed,
    nodeEnv: parsed.NODE_ENV,
    redisUrl: parsed.REDIS_URL,
    databaseUrl: parsed.DATABASE_URL,
    merchantId: parsed.DUKASPOT_MERCHANT_ID,
    serviceName: parsed.SERVICE_NAME,
    logLevel: parsed.LOG_LEVEL,
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
