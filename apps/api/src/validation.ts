import { z } from "zod";
import {
  normalizePhone,
  ORDER_STAGES,
  PAYMENT_CLASSES,
  type OrderStage,
  type PaymentClass,
} from "@dukaspot/core";
import { AuthLoginSchema, AuthRegisterSchema } from "@dukaspot/contracts";

const isoDate = z.string().datetime().optional();
const nonEmpty = z.string().trim().min(1);
const amount = z.coerce.number().finite().min(0);
const orderStages = ORDER_STAGES as [OrderStage, ...OrderStage[]];
const paymentClasses = PAYMENT_CLASSES as [PaymentClass, ...PaymentClass[]];

export const orderSchema = z.object({
  id: z.string().optional(),
  createdAt: isoDate,
  customerName: nonEmpty.max(120),
  phone: nonEmpty.max(40).transform(normalizePhone),
  productName: nonEmpty.max(160),
  variant: z.string().trim().max(120).default(""),
  quantity: z.coerce.number().int().positive().max(10_000),
  unitPrice: amount,
  unitCost: amount,
  deliveryFee: amount.default(0),
  discount: amount.default(0),
  location: z.string().trim().max(180).default(""),
  source: z.string().trim().max(80).default("WhatsApp"),
  agent: z.string().trim().max(120).default("Unassigned"),
  stage: z.enum(orderStages).default("confirmed"),
  paymentStatus: z.string().trim().max(40).default("unpaid"),
  notes: z.string().trim().max(800).default(""),
  lastFollowUpAt: z.string().optional().default(""),
});

export const paymentImportSchema = z.object({
  csv: z.string().max(1_500_000),
});

export const matchPaymentSchema = z.object({
  orderId: nonEmpty,
});

export const classifyPaymentSchema = z.object({
  classification: z.enum(paymentClasses),
});

export const orderPatchSchema = z
  .object({
    stage: z.enum(orderStages).optional(),
    notes: z.string().trim().max(800).optional(),
    location: z.string().trim().max(180).optional(),
    agent: z.string().trim().max(120).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one editable field is required",
  });

export const inventoryItemSchema = z.object({
  id: z.string().optional(),
  sku: nonEmpty.max(80),
  productName: nonEmpty.max(160),
  variant: z.string().trim().max(120).default(""),
  onHand: z.coerce.number().int().min(0).max(1_000_000),
  reorderPoint: z.coerce.number().int().min(0).max(1_000_000).default(0),
  unitCost: amount.default(0),
  sellingPrice: amount.default(0),
});

export const restockSchema = z.object({
  quantity: z.coerce.number().int().positive().max(1_000_000),
});

export const authRegisterSchema = AuthRegisterSchema;
export const authLoginSchema = AuthLoginSchema;

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  throw new RequestValidationError(result.error.flatten());
}

export class RequestValidationError extends Error {
  statusCode = 400;

  constructor(readonly details: unknown) {
    super("Request validation failed");
  }
}
