export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  if (nodeEnv === "production" && !env.CORS_ORIGIN) {
    throw new Error("CORS_ORIGIN is required in production");
  }

  const corsOrigins = String(
    env.CORS_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (nodeEnv === "production" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }

  return {
    nodeEnv,
    port,
    host: env.HOST || (nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1"),
    corsOrigins,
    databaseUrl: env.DATABASE_URL,
    dataFile: env.DUKASPOT_DATA_FILE,
    identityFile: env.DUKASPOT_IDENTITY_FILE,
    merchantId: env.DUKASPOT_MERCHANT_ID || "pilot-merchant",
  };
}
