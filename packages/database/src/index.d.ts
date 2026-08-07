import type { LedgerState } from "@dukaspot/core";

export type LedgerMutationResult = {
  state: LedgerState;
  message: string;
  imported?: number;
};

export type IdempotentOperationResult<TBody = unknown> = {
  statusCode: number;
  body: TBody;
  replayed?: boolean;
};

export type TrialBalanceAccount = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  balance: number;
};

export type TrialBalance = {
  merchantId: string;
  currency: string;
  generatedAt: string;
  accounts: TrialBalanceAccount[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
};

export type LedgerRepository = {
  getLedger(): Promise<LedgerState>;
  getTrialBalance(): Promise<TrialBalance>;
  forMerchant(merchantId: string): LedgerRepository;
  runIdempotent<TBody = unknown>(input: {
    key: string;
    requestHash: string;
    method?: string;
    path?: string;
    operation: () => Promise<IdempotentOperationResult<TBody>>;
  }): Promise<IdempotentOperationResult<TBody>>;
  replaceLedger(nextState: LedgerState, action?: string): Promise<LedgerMutationResult>;
  resetDemo(): Promise<LedgerMutationResult>;
  createOrder(order: Record<string, unknown>): Promise<LedgerMutationResult>;
  importPayments(csv: string): Promise<LedgerMutationResult>;
  matchPayment(paymentId: string, orderId: string): Promise<LedgerMutationResult>;
  classifyPayment(paymentId: string, classification: string): Promise<LedgerMutationResult>;
  unmatchPayment(paymentId: string): Promise<LedgerMutationResult>;
  updateOrder(orderId: string, patch: Record<string, unknown>): Promise<LedgerMutationResult>;
  markFollowUp(orderId: string): Promise<LedgerMutationResult>;
  addInventoryItem(item: Record<string, unknown>): Promise<LedgerMutationResult>;
  restockItem(itemId: string, quantity: number): Promise<LedgerMutationResult>;
};

export type MembershipRole =
  | "PLATFORM_SUPER_ADMIN"
  | "MERCHANT_OWNER"
  | "MERCHANT_ADMIN"
  | "FINANCE_MANAGER"
  | "SALES_MANAGER"
  | "SALES_AGENT"
  | "INVENTORY_MANAGER"
  | "FULFILMENT_AGENT"
  | "ACCOUNTANT"
  | "READ_ONLY_AUDITOR";

export type IdentityUser = {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MerchantRecord = {
  id: string;
  slug: string;
  legalName: string;
  tradingName: string;
  currency: "KES" | string;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
};

export type MerchantMembershipRecord = {
  id: string;
  merchantId: string;
  userId: string;
  role: MembershipRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MerchantMembershipWithMerchant = MerchantMembershipRecord & {
  merchant: MerchantRecord;
};

export type IdentitySession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type OwnerAccount = {
  user: Omit<IdentityUser, "passwordHash">;
  merchant: MerchantRecord;
  membership: MerchantMembershipRecord;
};

export type AuthSessionRecord = {
  session: IdentitySession;
  user: Omit<IdentityUser, "passwordHash">;
  memberships: MerchantMembershipWithMerchant[];
};

export type IdentityRepository = {
  createOwnerAccount(input: {
    email: string;
    name: string;
    passwordHash: string;
    merchantName: string;
    legalName?: string;
  }): Promise<OwnerAccount>;
  findUserByEmail(email: string): Promise<IdentityUser | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<IdentitySession>;
  getSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSessionByTokenHash(tokenHash: string): Promise<boolean>;
  getMembershipForUser(userId: string, merchantId: string): Promise<MerchantMembershipWithMerchant>;
  listMembershipsForUser(userId: string): Promise<MerchantMembershipWithMerchant[]>;
};

export class FileLedgerRepository implements LedgerRepository {
  constructor(options?: { dataFile?: string; merchantId?: string });
  getLedger(): Promise<LedgerState>;
  getTrialBalance(): Promise<TrialBalance>;
  forMerchant(merchantId: string): LedgerRepository;
  runIdempotent<TBody = unknown>(input: {
    key: string;
    requestHash: string;
    method?: string;
    path?: string;
    operation: () => Promise<IdempotentOperationResult<TBody>>;
  }): Promise<IdempotentOperationResult<TBody>>;
  replaceLedger(nextState: LedgerState, action?: string): Promise<LedgerMutationResult>;
  resetDemo(): Promise<LedgerMutationResult>;
  createOrder(order: Record<string, unknown>): Promise<LedgerMutationResult>;
  importPayments(csv: string): Promise<LedgerMutationResult>;
  matchPayment(paymentId: string, orderId: string): Promise<LedgerMutationResult>;
  classifyPayment(paymentId: string, classification: string): Promise<LedgerMutationResult>;
  unmatchPayment(paymentId: string): Promise<LedgerMutationResult>;
  updateOrder(orderId: string, patch: Record<string, unknown>): Promise<LedgerMutationResult>;
  markFollowUp(orderId: string): Promise<LedgerMutationResult>;
  addInventoryItem(item: Record<string, unknown>): Promise<LedgerMutationResult>;
  restockItem(itemId: string, quantity: number): Promise<LedgerMutationResult>;
}

export class PostgresLedgerRepository extends FileLedgerRepository {
  constructor(options?: { connectionString?: string; merchantId?: string });
  forMerchant(merchantId: string): LedgerRepository;
}

export class PostgresCommerceLedgerRepository implements LedgerRepository {
  constructor(options?: { pool?: unknown; merchantId?: string });
  getLedger(): Promise<LedgerState>;
  getTrialBalance(): Promise<TrialBalance>;
  forMerchant(merchantId: string): LedgerRepository;
  runIdempotent<TBody = unknown>(input: {
    key: string;
    requestHash: string;
    method?: string;
    path?: string;
    operation: () => Promise<IdempotentOperationResult<TBody>>;
  }): Promise<IdempotentOperationResult<TBody>>;
  replaceLedger(nextState: LedgerState, action?: string): Promise<LedgerMutationResult>;
  resetDemo(): Promise<LedgerMutationResult>;
  createOrder(order: Record<string, unknown>): Promise<LedgerMutationResult>;
  importPayments(csv: string): Promise<LedgerMutationResult>;
  matchPayment(paymentId: string, orderId: string): Promise<LedgerMutationResult>;
  classifyPayment(paymentId: string, classification: string): Promise<LedgerMutationResult>;
  unmatchPayment(paymentId: string): Promise<LedgerMutationResult>;
  updateOrder(orderId: string, patch: Record<string, unknown>): Promise<LedgerMutationResult>;
  markFollowUp(orderId: string): Promise<LedgerMutationResult>;
  addInventoryItem(item: Record<string, unknown>): Promise<LedgerMutationResult>;
  restockItem(itemId: string, quantity: number): Promise<LedgerMutationResult>;
}

export class FileIdentityRepository implements IdentityRepository {
  constructor(options?: { dataFile?: string });
  createOwnerAccount(input: {
    email: string;
    name: string;
    passwordHash: string;
    merchantName: string;
    legalName?: string;
  }): Promise<OwnerAccount>;
  findUserByEmail(email: string): Promise<IdentityUser | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<IdentitySession>;
  getSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSessionByTokenHash(tokenHash: string): Promise<boolean>;
  getMembershipForUser(userId: string, merchantId: string): Promise<MerchantMembershipWithMerchant>;
  listMembershipsForUser(userId: string): Promise<MerchantMembershipWithMerchant[]>;
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(options?: { connectionString?: string });
  createOwnerAccount(input: {
    email: string;
    name: string;
    passwordHash: string;
    merchantName: string;
    legalName?: string;
  }): Promise<OwnerAccount>;
  findUserByEmail(email: string): Promise<IdentityUser | null>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<IdentitySession>;
  getSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSessionByTokenHash(tokenHash: string): Promise<boolean>;
  getMembershipForUser(userId: string, merchantId: string): Promise<MerchantMembershipWithMerchant>;
  listMembershipsForUser(userId: string): Promise<MerchantMembershipWithMerchant[]>;
}

export function createLedgerRepository(options?: {
  databaseUrl?: string;
  dataFile?: string;
  merchantId?: string;
}): LedgerRepository;

export function createIdentityRepository(options?: {
  databaseUrl?: string;
  identityFile?: string;
}): IdentityRepository;
