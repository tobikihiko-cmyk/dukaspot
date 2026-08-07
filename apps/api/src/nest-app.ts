import "reflect-metadata";
import crypto from "node:crypto";
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  DynamicModule,
  ExceptionFilter,
  Get,
  HttpException,
  Inject,
  LoggerService,
  Module,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import express from "express";
import {
  buildReconciliation,
  dailyOwnerReport,
  deriveOrder,
  getAgentMetrics,
  getCustomerProfiles,
  getFollowUps,
  getInventoryRows,
  getSummary,
  parseMpesaCsv,
  toCsv,
} from "@dukaspot/core";
import type { LedgerState } from "@dukaspot/core";
import type { ApiConfig } from "@dukaspot/config";
import {
  ApiErrorCodeSchema,
  type ApiErrorCode,
  type AuthSessionResponse,
} from "@dukaspot/contracts";
import type {
  IdentityRepository,
  LedgerRepository,
  MerchantMembershipWithMerchant,
} from "@dukaspot/database";
import {
  assertPermission,
  permissionsForRole,
  type Permission,
} from "@dukaspot/auth";
import { createSessionToken, hashPassword, hashToken, verifyPassword } from "@dukaspot/security";
import { createLogger } from "@dukaspot/observability";
import {
  authLoginSchema,
  authRegisterSchema,
  classifyPaymentSchema,
  inventoryItemSchema,
  matchPaymentSchema,
  orderPatchSchema,
  orderSchema,
  parseBody,
  paymentImportSchema,
  restockSchema,
} from "./validation.js";

const API_CONFIG = Symbol("API_CONFIG");
const LEDGER_REPOSITORY = Symbol("LEDGER_REPOSITORY");
const IDENTITY_REPOSITORY = Symbol("IDENTITY_REPOSITORY");
const SESSION_COOKIE_NAME = "dukaspot_session";
const CSRF_COOKIE_NAME = "dukaspot_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_LOGIN_RATE_LIMIT = { name: "auth:login", max: 10, windowMs: 60_000 };
const AUTH_REGISTER_RATE_LIMIT = { name: "auth:register", max: 5, windowMs: 60_000 };
const AUTH_LOGOUT_RATE_LIMIT = { name: "auth:logout", max: 30, windowMs: 60_000 };
const MUTATION_RATE_LIMIT = { name: "mutation", max: 120, windowMs: 60_000 };
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

type RequestWithId = {
  id?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  originalUrl?: string;
  socket?: { remoteAddress?: string };
  url?: string;
  get?: (header: string) => string | undefined;
};

type ResponseLike = {
  status(code: number): ResponseLike;
  json(body: unknown): void;
  type(value: string): ResponseLike;
  attachment(filename: string): ResponseLike;
  send(body: unknown): void;
  setHeader(name: string, value: string | string[]): ResponseLike;
};

export async function createNestApp(options: {
  repository: LedgerRepository;
  identityRepository: IdentityRepository;
  config: ApiConfig;
}) {
  const app = await NestFactory.create(
    DukaspotApiModule.register(options),
    {
      logger: new NestJsonLogger(options.config),
    }
  );

  app.use((request: RequestWithId, response: ResponseLike, next: () => void) => {
    const requestId = request.get?.("x-request-id") || crypto.randomUUID();
    request.id = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.use(rateLimitMiddleware());
  app.use(helmet({ crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: "2mb" }));
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || options.config.corsOrigins.includes("*") || options.config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenCorsError(), false);
    },
    credentials: true,
  });
  app.useGlobalFilters(new ApiExceptionFilter());

  return app;
}

@Module({})
class DukaspotApiModule {
  static register(options: {
    repository: LedgerRepository;
    identityRepository: IdentityRepository;
    config: ApiConfig;
  }): DynamicModule {
    return {
      module: DukaspotApiModule,
      controllers: [HealthController, IdentityController, LedgerController],
      providers: [
        { provide: API_CONFIG, useValue: options.config },
        { provide: LEDGER_REPOSITORY, useValue: options.repository },
        { provide: IDENTITY_REPOSITORY, useValue: options.identityRepository },
      ],
    };
  }
}

@Controller({ path: ["api", "api/v1"] })
class HealthController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(LEDGER_REPOSITORY) private readonly repository: LedgerRepository
  ) {}

  @Get("health")
  health() {
    return {
      ok: true,
      service: "dukaspot-api",
      version: "0.9.5",
      persistence: this.config.databaseUrl ? "postgres" : "file",
      checkedAt: new Date().toISOString(),
    };
  }

  @Get("ready")
  async ready() {
    await this.repository.getLedger();
    return {
      ok: true,
      service: "dukaspot-api",
      persistence: this.config.databaseUrl ? "postgres" : "file",
      checkedAt: new Date().toISOString(),
    };
  }

  @Get(["docs", "openapi.json"])
  docs() {
    return createOpenApiDocument();
  }
}

@Controller({ path: ["api", "api/v1"] })
class IdentityController {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(IDENTITY_REPOSITORY) private readonly identityRepository: IdentityRepository
  ) {}

  @Post("auth/register")
  async register(@Body() body: unknown, @Res() response: ResponseLike) {
    const input = parseBody(authRegisterSchema, body);
    const passwordHash = await hashPassword(input.password);
    const account = await this.identityRepository.createOwnerAccount({
      email: input.email,
      name: input.name,
      passwordHash,
      merchantName: input.merchantName,
      ...(input.legalName ? { legalName: input.legalName } : {}),
    });
    const session = await this.createSession(account.user.id);
    const csrfToken = createCsrfToken();
    const memberships = await this.identityRepository.listMembershipsForUser(account.user.id);

    response
      .status(201)
      .setHeader("set-cookie", [
        sessionCookie(session.rawToken, session.expiresAt, this.config),
        csrfCookie(csrfToken, this.config),
      ])
      .json(presentAuthSession(account.user, memberships, account.merchant.id));
  }

  @Post("auth/login")
  async login(@Body() body: unknown, @Res() response: ResponseLike) {
    const input = parseBody(authLoginSchema, body);
    const user = await this.identityRepository.findUserByEmail(input.email);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedRequestError("Invalid email or password");
    }

    const memberships = input.merchantId
      ? [await this.identityRepository.getMembershipForUser(user.id, input.merchantId)]
      : await this.identityRepository.listMembershipsForUser(user.id);
    const session = await this.createSession(user.id);
    const csrfToken = createCsrfToken();

    response
      .status(200)
      .setHeader("set-cookie", [
        sessionCookie(session.rawToken, session.expiresAt, this.config),
        csrfCookie(csrfToken, this.config),
      ])
      .json(presentAuthSession(user, memberships, input.merchantId));
  }

  @Post("auth/logout")
  async logout(@Req() request: RequestWithId, @Res() response: ResponseLike) {
    requireCsrfToken(request);
    const rawToken = readSessionToken(request);
    if (rawToken) {
      await this.identityRepository.revokeSessionByTokenHash(hashToken(rawToken));
    }

    response
      .status(200)
      .setHeader("set-cookie", [
        expiredSessionCookie(this.config),
        expiredCsrfCookie(this.config),
      ])
      .json({ ok: true });
  }

  @Get("auth/csrf")
  csrf(@Res() response: ResponseLike) {
    const csrfToken = createCsrfToken();
    response
      .status(200)
      .setHeader("cache-control", "no-store")
      .setHeader("set-cookie", csrfCookie(csrfToken, this.config))
      .json({ csrfToken });
  }

  @Get("auth/me")
  async me(@Req() request: RequestWithId) {
    const session = await requireAuthenticatedSession(this.identityRepository, request);
    return presentAuthSession(session.user, session.memberships);
  }

  @Get("tenants/:merchantId")
  async tenant(@Param("merchantId") merchantId: string, @Req() request: RequestWithId) {
    const session = await requireAuthenticatedSession(this.identityRepository, request);
    const membership = await this.identityRepository.getMembershipForUser(
      session.user.id,
      merchantId
    );
    return {
      tenant: presentMembership(membership),
    };
  }

  private async createSession(userId: string) {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await this.identityRepository.createSession({
      userId,
      tokenHash: token.tokenHash,
      expiresAt,
    });
    return { ...token, expiresAt };
  }
}

@Controller({ path: ["api", "api/v1"] })
class LedgerController {
  constructor(
    @Inject(LEDGER_REPOSITORY) private readonly repository: LedgerRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identityRepository: IdentityRepository
  ) {}

  @Get("ledger")
  async ledger(@Req() request: RequestWithId) {
    const { repository } = await this.resolveTenant(request, "merchant:read");
    return presentLedger(await repository.getLedger());
  }

  @Get("accounting/trial-balance")
  async trialBalance(@Req() request: RequestWithId) {
    const { repository } = await this.resolveTenant(request, "report:read");
    return repository.getTrialBalance();
  }

  @Post("orders")
  async createOrder(
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "order:write");
    const order = parseBody(orderSchema, body);
    await runIdempotentMutation(request, response, repository, body, 201, async () =>
      presentResult(
        await repository.createOrder({
          ...order,
          createdAt: order.createdAt || new Date().toISOString(),
          lastFollowUpAt: order.lastFollowUpAt || "",
        })
      )
    );
  }

  @Patch("orders/:orderId")
  async updateOrder(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "order:write");
    const patch = parseBody(orderPatchSchema, body);
    await runIdempotentMutation(request, response, repository, { orderId, body }, 200, async () =>
      presentResult(await repository.updateOrder(orderId, patch))
    );
  }

  @Post("orders/:orderId/follow-up")
  async markFollowUp(
    @Param("orderId") orderId: string,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "order:write");
    await runIdempotentMutation(request, response, repository, { orderId }, 200, async () =>
      presentResult(await repository.markFollowUp(orderId))
    );
  }

  @Post("payments/import")
  async importPayments(
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "payment:allocate");
    const { csv } = parseBody(paymentImportSchema, body);
    const preview = parseMpesaImportCount(csv);
    await runIdempotentMutation(
      request,
      response,
      repository,
      body,
      preview ? 201 : 200,
      async () => {
        const result = await repository.importPayments(csv);
        return presentResult(result);
      }
    );
  }

  @Post("payments/:paymentId/match")
  async matchPayment(
    @Param("paymentId") paymentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "payment:allocate");
    const { orderId } = parseBody(matchPaymentSchema, body);
    await runIdempotentMutation(
      request,
      response,
      repository,
      { paymentId, body },
      200,
      async () => presentResult(await repository.matchPayment(paymentId, orderId))
    );
  }

  @Post("payments/:paymentId/classify")
  async classifyPayment(
    @Param("paymentId") paymentId: string,
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "payment:allocate");
    const { classification } = parseBody(classifyPaymentSchema, body);
    await runIdempotentMutation(
      request,
      response,
      repository,
      { paymentId, body },
      200,
      async () => presentResult(await repository.classifyPayment(paymentId, classification))
    );
  }

  @Post("payments/:paymentId/unmatch")
  async unmatchPayment(
    @Param("paymentId") paymentId: string,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "payment:allocate");
    await runIdempotentMutation(
      request,
      response,
      repository,
      { paymentId },
      200,
      async () => presentResult(await repository.unmatchPayment(paymentId))
    );
  }

  @Post("inventory")
  async addInventory(
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "inventory:write");
    const item = parseBody(inventoryItemSchema, body);
    await runIdempotentMutation(request, response, repository, body, 201, async () =>
      presentResult(await repository.addInventoryItem(item))
    );
  }

  @Post("inventory/:itemId/restock")
  async restockInventory(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: RequestWithId,
    @Res() response: ResponseLike
  ) {
    const { repository } = await this.resolveTenant(request, "inventory:write");
    const { quantity } = parseBody(restockSchema, body);
    await runIdempotentMutation(request, response, repository, { itemId, body }, 200, async () =>
      presentResult(await repository.restockItem(itemId, quantity))
    );
  }

  @Post("demo/reset")
  async resetDemo(@Req() request: RequestWithId, @Res() response: ResponseLike) {
    const { repository } = await this.resolveTenant(request, "merchant:manage");
    await runIdempotentMutation(request, response, repository, {}, 200, async () =>
      presentResult(await repository.resetDemo())
    );
  }

  @Get("reports/daily")
  async dailyReport(@Req() request: RequestWithId, @Res() response: ResponseLike) {
    const { repository } = await this.resolveTenant(request, "report:read");
    response.type("text/plain").send(dailyOwnerReport(await repository.getLedger()));
  }

  @Get("exports/orders.csv")
  async exportOrders(@Req() request: RequestWithId, @Res() response: ResponseLike) {
    const { repository } = await this.resolveTenant(request, "report:read");
    const state = await repository.getLedger();
    const rows = state.orders.map((order) => {
      const derived = deriveOrder(order, state.payments);
      return {
        id: order.id,
        createdAt: order.createdAt,
        customerName: order.customerName,
        phone: order.phone,
        productName: order.productName,
        variant: order.variant,
        quantity: order.quantity,
        total: derived.total,
        paidAmount: derived.paidAmount,
        balance: derived.balance,
        stage: order.stage,
        paymentStatus: derived.computedPaymentStatus,
        agent: order.agent,
        source: order.source,
        location: order.location,
        grossProfit: derived.grossProfit,
      };
    });
    response
      .type("text/csv")
      .attachment("dukaspot-orders.csv")
      .send(
        toCsv(rows, [
          { key: "id", label: "Order ID" },
          { key: "createdAt", label: "Created At" },
          { key: "customerName", label: "Customer" },
          { key: "phone", label: "Phone" },
          { key: "productName", label: "Product" },
          { key: "variant", label: "Variant" },
          { key: "quantity", label: "Quantity" },
          { key: "total", label: "Total" },
          { key: "paidAmount", label: "Paid" },
          { key: "balance", label: "Balance" },
          { key: "stage", label: "Stage" },
          { key: "paymentStatus", label: "Payment Status" },
          { key: "agent", label: "Agent" },
          { key: "source", label: "Source" },
          { key: "location", label: "Location" },
          { key: "grossProfit", label: "Gross Profit" },
        ])
      );
  }

  @Get("exports/payments.csv")
  async exportPayments(@Req() request: RequestWithId, @Res() response: ResponseLike) {
    const { repository } = await this.resolveTenant(request, "report:read");
    const state = await repository.getLedger();
    response
      .type("text/csv")
      .attachment("dukaspot-payments.csv")
      .send(
        toCsv(state.payments, [
          { key: "receipt", label: "Receipt" },
          { key: "receivedAt", label: "Received At" },
          { key: "payerName", label: "Payer" },
          { key: "phone", label: "Phone" },
          { key: "amount", label: "Amount" },
          { key: "classification", label: "Classification" },
          { key: "status", label: "Status" },
          { key: "orderId", label: "Order ID" },
          { key: "details", label: "Details" },
        ])
      );
  }

  private async resolveTenant(request: RequestWithId, permission: Permission) {
    const session = await requireAuthenticatedSession(this.identityRepository, request);
    const requestedMerchantId =
      readHeader(request, "x-dukaspot-merchant-id") ||
      session.memberships[0]?.merchantId;
    if (!requestedMerchantId) throw new TenantAccessError();

    const membership = await this.identityRepository.getMembershipForUser(
      session.user.id,
      requestedMerchantId
    );
    const permissions = permissionsForRole(membership.role);
    assertPermission(
      {
        userId: session.user.id,
        merchantId: membership.merchantId,
        membershipId: membership.id,
        role: membership.role,
        permissions,
      },
      permission
    );

    return {
      session,
      membership,
      permissions,
      repository: this.repository.forMerchant(membership.merchantId),
    };
  }
}

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<ResponseLike>();
    const statusCode = getStatusCode(exception);
    const message = getErrorMessage(exception, statusCode);
    const details = getErrorDetails(exception);
    const body: Record<string, unknown> = {
      error: {
        code: getErrorCode(exception, statusCode, message),
        message,
        correlationId: request.id || "unknown",
      },
    };
    if (details !== undefined) body.details = details;
    response.status(statusCode).json(body);
  }
}

class ForbiddenCorsError extends Error {
  statusCode = 403;

  constructor() {
    super("Origin is not allowed by CORS");
  }
}

class UnauthorizedRequestError extends Error {
  statusCode = 401;
  code = "UNAUTHORIZED";

  constructor(message = "Authentication required") {
    super(message);
  }
}

class BadRequestError extends Error {
  statusCode = 400;
  code = "BAD_REQUEST";

  constructor(message: string) {
    super(message);
  }
}

class CsrfTokenError extends Error {
  statusCode = 403;
  code = "FORBIDDEN";

  constructor() {
    super("CSRF token is missing or invalid");
  }
}

class TenantAccessError extends Error {
  statusCode = 403;
  code = "TENANT_ACCESS_DENIED";

  constructor() {
    super("Tenant access denied");
  }
}

class NestJsonLogger implements LoggerService {
  private readonly logger;

  constructor(config: ApiConfig) {
    this.logger = createLogger({
      service: "dukaspot-api",
      environment: config.nodeEnv,
      level: config.logLevel,
    });
  }

  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }

  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}

type RateLimitPolicy = {
  name: string;
  max: number;
  windowMs: number;
};

function rateLimitMiddleware() {
  return (
    request: RequestWithId,
    response: ResponseLike,
    next: (error?: unknown) => void
  ) => {
    const policy = rateLimitPolicy(request);
    if (!policy) {
      next();
      return;
    }

    const result = consumeRateLimit(`${policy.name}:${clientAddress(request)}`, policy);
    response.setHeader("x-ratelimit-limit", String(policy.max));
    response.setHeader("x-ratelimit-remaining", String(result.remaining));
    response.setHeader("x-ratelimit-reset", new Date(result.resetAt).toISOString());

    if (!result.allowed) {
      response.setHeader("retry-after", String(result.retryAfterSeconds));
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
          correlationId: request.id || "unknown",
        },
      });
      return;
    }

    next();
  };
}

function rateLimitPolicy(request: RequestWithId): RateLimitPolicy | null {
  const method = (request.method || "GET").toUpperCase();
  const path = (request.originalUrl || request.url || "").split("?")[0]?.replace(/\/+$/, "") || "";

  if (method === "POST" && /\/api(?:\/v1)?\/auth\/login$/.test(path)) {
    return AUTH_LOGIN_RATE_LIMIT;
  }
  if (method === "POST" && /\/api(?:\/v1)?\/auth\/register$/.test(path)) {
    return AUTH_REGISTER_RATE_LIMIT;
  }
  if (method === "POST" && /\/api(?:\/v1)?\/auth\/logout$/.test(path)) {
    return AUTH_LOGOUT_RATE_LIMIT;
  }
  if (isUnsafeMethod(method)) return MUTATION_RATE_LIMIT;
  return null;
}

function consumeRateLimit(key: string, policy: RateLimitPolicy) {
  const now = Date.now();
  pruneRateLimitBuckets(now);
  const existing = rateLimitBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + policy.windowMs };

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  const allowed = bucket.count <= policy.max;
  return {
    allowed,
    remaining: Math.max(0, policy.max - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function pruneRateLimitBuckets(now: number) {
  if (rateLimitBuckets.size < 1000) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function clientAddress(request: RequestWithId) {
  const forwarded = readHeader(request, "x-forwarded-for").split(",")[0]?.trim();
  return request.ip || request.socket?.remoteAddress || forwarded || "unknown";
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

async function requireAuthenticatedSession(
  identityRepository: IdentityRepository,
  request: RequestWithId
) {
  const rawToken = readSessionToken(request);
  if (!rawToken) throw new UnauthorizedRequestError();

  const session = await identityRepository.getSessionByTokenHash(hashToken(rawToken));
  if (!session) throw new UnauthorizedRequestError();
  return session;
}

async function runIdempotentMutation<TBody>(
  request: RequestWithId,
  response: ResponseLike,
  repository: LedgerRepository,
  body: unknown,
  statusCode: number,
  operation: () => Promise<TBody>
) {
  requireCsrfToken(request);

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    throw new BadRequestError("Idempotency-Key header is required for mutations");
  }

  const result = await repository.runIdempotent<TBody>({
    key: idempotencyKey,
    requestHash: requestBodyHash(body),
    method: request.method || "",
    path: request.originalUrl || request.url || "",
    operation: async () => ({
      statusCode,
      body: await operation(),
    }),
  });

  if (result.replayed) response.setHeader("x-idempotency-replayed", "true");
  response.status(result.statusCode).json(result.body);
}

function readIdempotencyKey(request: RequestWithId): string {
  return (
    readHeader(request, "idempotency-key") ||
    readHeader(request, "x-idempotency-key") ||
    ""
  ).trim();
}

function requestBodyHash(body: unknown) {
  return crypto.createHash("sha256").update(stableJson(body), "utf8").digest("base64url");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function presentAuthSession(
  user: { id: string; email: string; name: string; emailVerified: boolean },
  memberships: MerchantMembershipWithMerchant[],
  currentMerchantId?: string
): AuthSessionResponse {
  const presentedMemberships = memberships.map(presentMembership);
  const currentTenant = currentMerchantId
    ? presentedMemberships.find((membership) => membership.merchantId === currentMerchantId)
    : presentedMemberships[0];

  if (!currentTenant) throw new TenantAccessError();

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    },
    memberships: presentedMemberships,
    currentTenant,
  };
}

function presentMembership(
  membership: MerchantMembershipWithMerchant
): AuthSessionResponse["memberships"][number] {
  return {
    id: membership.id,
    merchantId: membership.merchantId,
    merchantSlug: membership.merchant.slug,
    merchantName: membership.merchant.tradingName,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  };
}

function sessionCookie(rawToken: string, expiresAt: string, config: ApiConfig) {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)
  );
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

function csrfCookie(token: string, config: ApiConfig) {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

function expiredSessionCookie(config: ApiConfig) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

function expiredCsrfCookie(config: ApiConfig) {
  const parts = [
    `${CSRF_COOKIE_NAME}=`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (config.nodeEnv === "production") parts.push("Secure");
  return parts.join("; ");
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function requireCsrfToken(request: RequestWithId) {
  const cookieToken = readCookie(request, CSRF_COOKIE_NAME);
  const headerToken = readHeader(request, CSRF_HEADER_NAME).trim();
  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    throw new CsrfTokenError();
  }
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readSessionToken(request: RequestWithId): string | null {
  return readCookie(request, SESSION_COOKIE_NAME);
}

function readCookie(request: RequestWithId, cookieName: string): string | null {
  const header = readHeader(request, "cookie");
  if (!header) return null;

  for (const cookie of header.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== cookieName) continue;
    const value = valueParts.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function readHeader(request: RequestWithId, name: string): string {
  const direct = request.get?.(name);
  if (direct) return direct;
  return stringHeader(request.headers?.[name.toLowerCase()]) || "";
}

function stringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join("; ") : value;
}

function parseMpesaImportCount(csv: string) {
  return parseMpesaCsv(csv).length;
}

function presentResult(result: { state: LedgerState; message?: string; imported?: number }) {
  return {
    message: result.message,
    imported: result.imported,
    ...presentLedger(result.state),
  };
}

function presentLedger(state: LedgerState) {
  return {
    state,
    summary: getSummary(state),
    reconciliation: buildReconciliation(state.orders, state.payments),
    inventoryRows: getInventoryRows(state.inventory, state.orders, state.payments),
    followUps: getFollowUps(state.orders, state.payments),
    customers: getCustomerProfiles(state.orders, state.payments),
    agents: getAgentMetrics(state.orders, state.payments),
    ownerReport: dailyOwnerReport(state),
  };
}

function createOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Dukaspot API",
      version: "1.0.0",
      description: "Versioned merchant operations API for the Dukaspot production foundation.",
    },
    servers: [{ url: "/api" }, { url: "/api/v1" }],
    tags: [
      { name: "system", description: "Health, readiness, and API metadata" },
      { name: "identity", description: "Authentication, sessions, and merchant tenancy" },
      { name: "ledger", description: "Ledger reads, order mutations, reconciliation, and exports" },
    ],
    paths: {
      ...buildOpenApiPaths("/api"),
      ...buildOpenApiPaths("/api/v1"),
    },
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE_NAME,
        },
      },
      schemas: {
        ApiError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "correlationId"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                correlationId: { type: "string" },
              },
            },
            details: {},
          },
        },
      },
    },
  };
}

function buildOpenApiPaths(prefix: "/api" | "/api/v1") {
  return {
    [`${prefix}/health`]: {
      get: operation("system", "Health check", "Reports process health and persistence mode."),
    },
    [`${prefix}/ready`]: {
      get: operation("system", "Readiness check", "Verifies the ledger repository can be read."),
    },
    [`${prefix}/docs`]: {
      get: operation("system", "OpenAPI document", "Returns this OpenAPI 3.1 document."),
    },
    [`${prefix}/openapi.json`]: {
      get: operation("system", "OpenAPI document", "Returns this OpenAPI 3.1 document."),
    },
    [`${prefix}/ledger`]: {
      get: operation("ledger", "Ledger snapshot", "Returns the ledger, summary, reconciliation queues, inventory rows, and reports."),
    },
    [`${prefix}/accounting/trial-balance`]: {
      get: operation("ledger", "Trial balance", "Returns posted double-entry debit and credit totals by account."),
    },
    [`${prefix}/auth/register`]: {
      post: operation("identity", "Register owner", "Creates a merchant owner account and starts a session."),
    },
    [`${prefix}/auth/login`]: {
      post: operation("identity", "Login", "Verifies credentials and starts a session."),
    },
    [`${prefix}/auth/logout`]: {
      post: {
        ...operation("identity", "Logout", "Revokes the current session cookie."),
        parameters: [csrfParameter()],
      },
    },
    [`${prefix}/auth/csrf`]: {
      get: operation("identity", "CSRF token", "Issues a double-submit token for protected browser mutations."),
    },
    [`${prefix}/auth/me`]: {
      get: operation("identity", "Current session", "Returns the authenticated user and tenant memberships."),
    },
    [`${prefix}/tenants/{merchantId}`]: {
      get: operation("identity", "Tenant access", "Returns a tenant only when the current session has active membership."),
    },
    [`${prefix}/orders`]: {
      post: mutationOperation("ledger", "Create order", "Creates a normalized social-commerce order."),
    },
    [`${prefix}/orders/{orderId}`]: {
      patch: mutationOperation("ledger", "Update order", "Applies a partial order update."),
    },
    [`${prefix}/orders/{orderId}/follow-up`]: {
      post: mutationOperation("ledger", "Mark follow-up", "Records a follow-up timestamp for an order."),
    },
    [`${prefix}/payments/import`]: {
      post: mutationOperation("ledger", "Import payments", "Imports M-PESA-style CSV statement rows."),
    },
    [`${prefix}/payments/{paymentId}/match`]: {
      post: mutationOperation("ledger", "Match payment", "Matches a payment to an order."),
    },
    [`${prefix}/payments/{paymentId}/classify`]: {
      post: mutationOperation("ledger", "Classify payment", "Marks an unmatched payment as owner_draw, expense, refund, or unknown."),
    },
    [`${prefix}/payments/{paymentId}/unmatch`]: {
      post: mutationOperation("ledger", "Unmatch payment", "Removes a payment/order match."),
    },
    [`${prefix}/inventory`]: {
      post: mutationOperation("ledger", "Add inventory item", "Creates an inventory item in the tenant repository."),
    },
    [`${prefix}/inventory/{itemId}/restock`]: {
      post: mutationOperation("ledger", "Restock item", "Adds stock quantity to an inventory item."),
    },
    [`${prefix}/demo/reset`]: {
      post: mutationOperation("ledger", "Reset demo data", "Restores seed pilot data."),
    },
    [`${prefix}/reports/daily`]: {
      get: textOperation("ledger", "Daily owner report", "Returns a plain-text daily operating report."),
    },
    [`${prefix}/exports/orders.csv`]: {
      get: csvOperation("ledger", "Export orders", "Downloads orders as CSV."),
    },
    [`${prefix}/exports/payments.csv`]: {
      get: csvOperation("ledger", "Export payments", "Downloads payments as CSV."),
    },
  };
}

function operation(tag: "system" | "identity" | "ledger", summary: string, description: string) {
  return {
    tags: [tag],
    summary,
    description,
    ...(tag === "ledger" ? ledgerSecurity() : {}),
    responses: {
      "200": { description: "OK" },
      "400": { description: "Request validation failed", content: errorContent() },
      "401": { description: "Authentication required", content: errorContent() },
      "403": { description: "Tenant access denied", content: errorContent() },
      "404": { description: "Resource not found", content: errorContent() },
      "409": { description: "Conflict", content: errorContent() },
      "429": { description: "Rate limit exceeded", content: errorContent() },
      "500": { description: "Internal server error", content: errorContent() },
    },
  };
}

function mutationOperation(tag: "ledger", summary: string, description: string) {
  return {
    ...operation(tag, summary, description),
    parameters: [
      ...tenantParameters(),
      csrfParameter(),
      {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1 },
        description: "Required stable key for retry-safe merchant mutations.",
      },
    ],
  };
}

function ledgerSecurity() {
  return {
    security: [{ sessionCookie: [] }],
    parameters: tenantParameters(),
  };
}

function tenantParameters() {
  return [
    {
      name: "x-dukaspot-merchant-id",
      in: "header",
      required: false,
      schema: { type: "string" },
      description: "Optional merchant tenant override for users with multiple memberships.",
    },
  ];
}

function csrfParameter() {
  return {
    name: CSRF_HEADER_NAME,
    in: "header",
    required: true,
    schema: { type: "string", minLength: 1 },
    description: "Required double-submit CSRF token for cookie-authenticated mutations.",
  };
}

function textOperation(tag: "system" | "identity" | "ledger", summary: string, description: string) {
  return {
    ...operation(tag, summary, description),
    responses: {
      "200": { description: "OK", content: { "text/plain": { schema: { type: "string" } } } },
      "500": { description: "Internal server error", content: errorContent() },
    },
  };
}

function csvOperation(tag: "system" | "identity" | "ledger", summary: string, description: string) {
  return {
    ...operation(tag, summary, description),
    responses: {
      "200": { description: "OK", content: { "text/csv": { schema: { type: "string" } } } },
      "500": { description: "Internal server error", content: errorContent() },
    },
  };
}

function errorContent() {
  return {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  };
}

function getStatusCode(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  if (hasNumberProperty(exception, "statusCode")) return exception.statusCode;
  if (hasNumberProperty(exception, "status")) return exception.status;
  return 500;
}

function getErrorMessage(exception: unknown, statusCode: number): string {
  if (statusCode >= 500) return "Internal server error";
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === "string") return response;
    if (isRecord(response) && typeof response.message === "string") return response.message;
    if (isRecord(response) && Array.isArray(response.message)) return response.message.join("; ");
  }
  if (exception instanceof Error) return exception.message;
  return "Request failed";
}

function getErrorDetails(exception: unknown): unknown {
  if (isRecord(exception) && "details" in exception) return exception.details;
  return undefined;
}

function getErrorCode(exception: unknown, statusCode: number, message: string): ApiErrorCode {
  const explicitCode = getExplicitErrorCode(exception);
  if (explicitCode) return explicitCode;
  if (message === "Request validation failed") return "VALIDATION_FAILED";
  if (statusCode === 400) return "BAD_REQUEST";
  if (statusCode === 401) return "UNAUTHORIZED";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "CONFLICT";
  if (statusCode === 429) return "RATE_LIMITED";
  return "INTERNAL_ERROR";
}

function getExplicitErrorCode(exception: unknown): ApiErrorCode | null {
  if (!isRecord(exception) || typeof exception.code !== "string") return null;
  const result = ApiErrorCodeSchema.safeParse(exception.code);
  return result.success ? result.data : null;
}

function hasNumberProperty<T extends string>(
  value: unknown,
  property: T
): value is Record<T, number> {
  return isRecord(value) && typeof value[property] === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
