# Dukaspot Kenya

Dukaspot is a WhatsApp-to-books operating system for Kenyan social sellers. It captures social-commerce orders, imports M-PESA statement rows, suggests deterministic payment matches, keeps uncertain payments in human review, and produces operational ledgers for owners and accountants.

## Readiness

Current audited status: **working pilot foundation with authenticated tenant, commerce persistence, accounting posting, authenticated frontend workflows, and first-pass production hardening**.

Production SaaS readiness from Phase 0 evidence: **14 / 100**. See [docs/phase-0-audit.md](docs/phase-0-audit.md) for the command results, verified capabilities, production gaps, and recommended implementation order.

The app is now split into deployable layers:

- `apps/web`: Next.js app-router merchant operations dashboard.
- `apps/api`: NestJS API with validation, security headers, CORS, health/readiness checks, OpenAPI JSON, authenticated tenant ledger routes, exports, and pilot-compatible mutations.
- `apps/worker`: BullMQ worker foundation for async jobs.
- `packages/auth`: role, permission, and tenant authorization helpers.
- `packages/core`: deterministic ledger, reconciliation, reporting, CSV parsing, and seed data.
- `packages/database`: repository abstraction, file-backed local persistence, PostgreSQL identity and normalized commerce persistence, legacy snapshots, migrations, and Prisma schema.
- `packages/contracts`: shared Zod contracts and typed job/API envelopes.
- `packages/config`: typed environment loading.
- `packages/observability`: structured logging and redaction helpers.
- `packages/security`: password hashing and session-token helpers.

See [docs/phase-1-foundation.md](docs/phase-1-foundation.md), [docs/phase-2-identity-tenancy.md](docs/phase-2-identity-tenancy.md), [docs/phase-3-commerce-persistence.md](docs/phase-3-commerce-persistence.md), [docs/phase-4-accounting-correctness.md](docs/phase-4-accounting-correctness.md), [docs/phase-5-authenticated-frontend.md](docs/phase-5-authenticated-frontend.md), and [docs/phase-6-production-hardening.md](docs/phase-6-production-hardening.md) for the latest phase reports.

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

If port `3000` is already in use, Next.js chooses the next available port and prints it in the terminal. Docker still maps the web service to `http://localhost:5173`.

API health and readiness:

```text
http://127.0.0.1:8787/api/health
http://127.0.0.1:8787/api/ready
http://127.0.0.1:8787/api/openapi.json
```

Identity routes are available under both `/api` and `/api/v1`:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/csrf
GET  /api/auth/me
GET  /api/tenants/:merchantId
```

The web app now supports registration, login, logout, session resume, tenant selection, permission-aware controls, authenticated ledger reads, authenticated mutations, exports, and trial balance display.

Ledger routes require a valid `dukaspot_session` cookie. Mutating ledger routes also require an `Idempotency-Key` header and an `x-csrf-token` header matching the `dukaspot_csrf` cookie from `/api/auth/csrf`. Use `x-dukaspot-merchant-id` when a user belongs to more than one merchant.

Accounting routes are available under both `/api` and `/api/v1`:

```text
GET /api/accounting/trial-balance
```

Run the API, web, and worker together:

```bash
npm run dev:full
```

## Verify

```bash
npm run test
npm run lint
npm run typecheck
npm run db:validate
npm run build
npm run audit
npm run check
```

The API test binds a short-lived local port. In restricted environments it may require permission to bind localhost.

Run the optional normalized PostgreSQL commerce integration test with:

```bash
DUKASPOT_POSTGRES_TEST_URL=postgres://dukaspot:dukaspot@127.0.0.1:55433/dukaspot npm run test -w @dukaspot/database
```

## Database

Local development uses a file-backed repository at:

```text
data/dukaspot.dev.json
data/dukaspot.identity.dev.json
```

Production requires PostgreSQL:

```bash
DATABASE_URL=postgres://user:password@host:5432/dukaspot npm run migrate -w @dukaspot/database
DATABASE_URL=postgres://user:password@host:5432/dukaspot npm run start -w @dukaspot/api
```

The normalized Prisma schema lives at:

```text
packages/database/prisma/schema.prisma
```

Identity and session runtime writes use `users`, `merchants`, `merchant_memberships`, and `sessions` in PostgreSQL mode, or the local identity JSON file in file mode. Authenticated PostgreSQL ledger routes use normalized commerce tables for customers, products, variants, orders, order items, payments, allocations, inventory movements, outbox events, and idempotency records while preserving the current ledger response contract. The PostgreSQL path also posts deterministic double-entry rows into `journal_entries` and `journal_lines` and exposes a tenant-scoped trial balance.

## Docker

```bash
docker compose up --build
```

Services:

- Web: `http://localhost:5173`
- API: `http://localhost:8787/api/health`
- Postgres: `localhost:5433`
- Redis: `localhost:6379`

## Environment

Copy `.env.example` or the app-specific examples:

- `.env.example`
- `apps/api/.env.example`
- `apps/web/.env.example`

Production API startup requires `DATABASE_URL`.

## Launch Notes

See [docs/launch-readiness.md](docs/launch-readiness.md) for the readiness review, remaining non-blockers, and launch gate.
