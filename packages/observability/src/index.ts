import crypto from "node:crypto";
import pino from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LoggerOptions = {
  service: string;
  environment: string;
  level?: LogLevel;
};

export function createLogger(options: LoggerOptions) {
  return pino({
    level: options.level || "info",
    base: {
      service: options.service,
      environment: options.environment,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "password",
        "pin",
        "token",
        "cookie",
        "authorization",
        "consumerSecret",
        "passkey",
        "*.password",
        "*.pin",
        "*.token",
        "*.cookie",
        "*.authorization",
        "*.consumerSecret",
        "*.passkey",
      ],
      censor: "[redacted]",
    },
  });
}

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

export function maskPhone(value = ""): string {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 6) return "[masked]";
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}
