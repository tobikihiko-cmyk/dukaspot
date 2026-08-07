export type OrderStage =
  | "enquiry"
  | "reserved"
  | "confirmed"
  | "dispatched"
  | "cancelled"
  | "returned";

export type PaymentClass =
  | "product_sale"
  | "delivery_payment"
  | "refund"
  | "owner_deposit"
  | "personal_transfer"
  | "supplier_payment"
  | "business_expense"
  | "unknown";

export type LedgerOrder = Record<string, unknown> & {
  id: string;
  createdAt: string;
  customerName: string;
  phone: string;
  productName: string;
  variant?: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discount?: number;
  deliveryFee?: number;
  stage: OrderStage;
  paymentStatus?: string;
  agent?: string;
};

export type LedgerPayment = Record<string, unknown> & {
  id: string;
  receipt: string;
  receivedAt: string;
  payerName: string;
  phone: string;
  amount: number;
  classification: PaymentClass;
  status: string;
  orderId?: string;
};

export type LedgerState = {
  merchant: Record<string, unknown>;
  agents: string[];
  inventory: Array<Record<string, unknown>>;
  orders: LedgerOrder[];
  payments: LedgerPayment[];
  auditLog: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export const STORAGE_KEY: string;
export const ORDER_STAGES: readonly OrderStage[];
export const PAYMENT_CLASSES: readonly PaymentClass[];
export function money(value: unknown): string;
export function uid(prefix?: string): string;
export function parseAmount(value: unknown): number;
export function normalizePhone(input?: string): string;
export function extractPhone(text?: string): string;
export function orderTotal(order: Partial<LedgerOrder>): number;
export function orderGrossProfit(order: Partial<LedgerOrder>): number;
export function matchedPaymentsForOrder(orderId: string, payments?: LedgerPayment[]): LedgerPayment[];
export function deriveOrder(order: LedgerOrder, payments?: LedgerPayment[]): LedgerOrder & Record<string, unknown>;
export function parseMpesaCsv(text?: string): LedgerPayment[];
export function buildReconciliation(
  orders?: LedgerOrder[],
  payments?: LedgerPayment[]
): Record<string, unknown>;
export function findDuplicatePayments(payments?: LedgerPayment[]): LedgerPayment[];
export function getFollowUps(
  orders?: LedgerOrder[],
  payments?: LedgerPayment[],
  asOf?: Date
): Array<Record<string, unknown>>;
export function getInventoryRows(
  inventory?: Array<Record<string, unknown>>,
  orders?: LedgerOrder[],
  payments?: LedgerPayment[]
): Array<Record<string, unknown>>;
export function getCustomerProfiles(
  orders?: LedgerOrder[],
  payments?: LedgerPayment[]
): Array<Record<string, unknown>>;
export function getAgentMetrics(
  orders?: LedgerOrder[],
  payments?: LedgerPayment[]
): Array<Record<string, unknown>>;
export function getSummary(state: LedgerState, asOf?: Date): Record<string, unknown>;
export function dailyOwnerReport(state: LedgerState, asOf?: Date): string;
export function toCsv(rows: Array<Record<string, unknown>>, headers: Array<{ key: string; label: string }>): string;
export function createSeedData(now?: Date): LedgerState;
