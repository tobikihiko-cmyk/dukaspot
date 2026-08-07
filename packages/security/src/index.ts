import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const SESSION_TOKEN_BYTES = 32;

export type SessionToken = {
  rawToken: string;
  tokenHash: string;
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export function createSessionToken(): SessionToken {
  const rawToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
  };
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("base64url");
}

export function createOpaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
