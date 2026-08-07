import { z } from "zod";

export const CurrencyCodeSchema = z.enum(["KES"]);

export const TenantContextSchema = z.object({
  merchantId: z.string().min(1),
  userId: z.string().min(1).optional(),
  membershipId: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).default([]),
});

export const AuthRegisterSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
  name: z.string().trim().min(1).max(120),
  merchantName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(180).optional(),
});

export const AuthLoginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256),
  merchantId: z.string().min(1).optional(),
});

export const AuthenticatedUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  emailVerified: z.boolean(),
});

export const AuthenticatedMembershipSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  merchantSlug: z.string().min(1),
  merchantName: z.string().min(1),
  role: z.string().min(1),
  permissions: z.array(z.string().min(1)),
});

export const AuthSessionResponseSchema = z.object({
  user: AuthenticatedUserSchema,
  memberships: z.array(AuthenticatedMembershipSchema),
  currentTenant: AuthenticatedMembershipSchema,
});

export const ApiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "PAYMENT_ALREADY_ALLOCATED",
  "TENANT_ACCESS_DENIED",
  "VALIDATION_FAILED",
]);

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    correlationId: z.string(),
  }),
  details: z.unknown().optional(),
});

export const MoneyMinorSchema = z.object({
  amountMinor: z.bigint(),
  currency: CurrencyCodeSchema.default("KES"),
});

export const JobEnvelopeSchema = z.object({
  jobType: z.string().min(1),
  version: z.literal(1),
  merchantId: z.string().min(1),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sourceEventId: z.string().min(1),
  attempt: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
  payload: z.record(z.unknown()).default({}),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
export type AuthLogin = z.infer<typeof AuthLoginSchema>;
export type AuthRegister = z.infer<typeof AuthRegisterSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;
export type MoneyMinor = z.infer<typeof MoneyMinorSchema>;
export type TenantContext = z.infer<typeof TenantContextSchema>;

export function createJobEnvelope(
  input: Omit<JobEnvelope, "version" | "attempt" | "createdAt"> &
    Partial<Pick<JobEnvelope, "attempt" | "createdAt">>
): JobEnvelope {
  return JobEnvelopeSchema.parse({
    version: 1,
    attempt: 0,
    createdAt: new Date().toISOString(),
    ...input,
  });
}
