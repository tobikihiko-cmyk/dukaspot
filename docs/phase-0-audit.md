# Dukaspot Phase 0 Repository Audit

Date: 2026-08-06

This report covers Phase 0 only. The repository was already extracted in the workspace at `/home/mikitech/Documents/projects/ChatLedger`; no `ChatLedger.tar.gz` or other `*.tar.gz` archive was present in the project tree, so no extraction step was performed.

## A. Work Completed

- Mapped the current workspace architecture from source, package files, docs, environment examples, Docker files, tests, and migrations.
- Installed dependencies and ran documented verification commands.
- Started the documented local dev stack and verified the web and API URLs.
- Built Docker images through Compose and recorded the stack startup failure.
- Inspected the database model, persistence layer, API routes, validation boundaries, reconciliation logic, CSV import/export behavior, frontend workflow, and deployment assets.
- Added characterization tests around existing financial and reconciliation behavior before future refactoring.
- Produced this production-gap report with a weighted readiness score.

## B. Files Created Or Modified

- Created: `docs/phase-0-audit.md`
- Modified: `packages/core/tests/ledger.test.mjs`

## C. Repository Map

Current application structure:

- `apps/web`: Vite, React, htm, Tailwind CSS merchant UI in a single large `src/app.js` file.
- `apps/api`: Express API with REST routes, Zod validation, Helmet, CORS, Morgan, health/readiness endpoints, exports, and mutations.
- `packages/core`: Framework-independent pilot domain logic for phone normalization, M-PESA CSV parsing, order totals, matching, inventory projections, customer profiles, agent metrics, summary, reports, and CSV export.
- `packages/database`: Repository abstraction with file-backed local mode, PostgreSQL JSONB snapshot persistence, and a simple migration runner.
- `data/dukaspot.dev.json`: Local file-backed seed/demo state.
- `docs/launch-readiness.md`: Existing pilot launch note that overstates readiness relative to the production SaaS target.
- No `.github/workflows` directory found.
- No `.dockerignore` found.
- Root `src/` and `tests/` directories exist but are empty.

## D. Verified Current Architecture

The app is a JavaScript npm workspace, not a TypeScript monorepo. The current stack is:

- Frontend: Vite + React 18 + Tailwind + htm.
- Backend: Express 4 + Zod + Helmet + CORS + Morgan.
- Persistence: local JSON file or PostgreSQL table containing a full JSONB ledger snapshot.
- Tests: hand-rolled Node test scripts using `node:assert`.
- Deployment: Dockerfiles for API and web, plus Docker Compose with Postgres only.

The target architecture in the master prompt is not yet implemented:

- No Next.js app.
- No NestJS API.
- No TypeScript strict mode.
- No Prisma.
- No Redis or BullMQ worker.
- No normalized relational commerce schema.
- No authentication, sessions, roles, permissions, or tenant authorization.
- No WhatsApp Cloud API integration.
- No Daraja integration.
- No double-entry ledger.
- No OpenAPI, CI, observability, backups, or incident runbooks.

## E. API Surface

Current API routes:

- `GET /api/health`
- `GET /api/ready`
- `GET /api/ledger`
- `POST /api/orders`
- `PATCH /api/orders/:orderId`
- `POST /api/orders/:orderId/follow-up`
- `POST /api/payments/import`
- `POST /api/payments/:paymentId/match`
- `POST /api/payments/:paymentId/classify`
- `POST /api/payments/:paymentId/unmatch`
- `POST /api/inventory`
- `POST /api/inventory/:itemId/restock`
- `POST /api/demo/reset`
- `GET /api/reports/daily`
- `GET /api/exports/orders.csv`
- `GET /api/exports/payments.csv`

Useful current protections:

- Request JSON size limit is 2 MB.
- CSV import payload is capped at 1.5 MB.
- Zod validates order, payment import, classification, matching, inventory, restock, and order patch payloads.
- Helmet is enabled.
- CORS checks configured origins.
- Every response gets an `x-request-id`.
- Production startup requires `CORS_ORIGIN` and `DATABASE_URL`.

Major gaps:

- Routes are unversioned and use `/api`, not `/api/v1`.
- Error envelope is not the required `{ error: { code, message, correlationId } }` shape.
- No authentication or authorization.
- No tenant context from authenticated membership.
- No idempotency keys for mutation endpoints.
- No rate limiting.
- No OpenAPI.
- No audit actor from session identity.

## F. Database Changes

No database schema changes were made in Phase 0.

Current migration:

```sql
create table if not exists ledger_states (
  merchant_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ledger_states_state_gin
  on ledger_states using gin (state);
```

Assessment:

- The current database is not a normalized financial SaaS model.
- The only tenant boundary is `ledger_states.merchant_id`.
- Orders, payments, inventory, customers, audit events, and reports are mutable JSON inside one row.
- PostgreSQL mutations use row-level locking on the merchant snapshot, which is useful for the pilot.
- There are no database-level unique constraints for M-PESA receipts, callback IDs, order references, payment allocations, or journal posting idempotency.
- There are no foreign keys or immutable financial records.

## G. Reconciliation And Financial Behavior

Reusable logic found in `packages/core/src/ledger.js`:

- Kenyan phone normalization.
- M-PESA CSV parsing with flexible header matching.
- Order subtotal, total, cost, and gross profit calculations.
- Matched payment filtering by order and payment classification.
- Deterministic payment-to-order scoring using amount, phone, name overlap, timing, and agent.
- Suggested match queue with confidence labels.
- Duplicate receipt detection.
- Inventory projection from orders and payment status.
- Customer profile aggregation.
- Agent metric aggregation.
- Daily owner report.
- CSV export escaping for quotes, commas, and newlines.

Important characterization captured in tests:

- Order totals include delivery fees and discounts.
- Gross profit currently excludes delivery revenue and subtracts product cost from discounted product subtotal.
- Owner deposits, personal transfers, supplier payments, business expenses, and duplicate payments are excluded from order payment totals.
- Duplicate receipt detection identifies later duplicate records but does not mutate their status.
- Seed summary output is now locked down by tests.

Financial gaps:

- Money uses JavaScript `number`, not integer minor units or a money abstraction.
- Payment allocation is a single `payment.orderId`, so one payment cannot cover multiple orders and one order cannot preserve allocation records.
- Manual matching directly mutates payment status and classification.
- There is no ledger posting engine.
- There are no journal entries, journal lines, trial balance, reversals, or posting idempotency.
- Historical financial snapshots are stored on orders but remain mutable and not protected by schema constraints.

## H. Tests

Existing tests before Phase 0:

- Core tests for phone normalization, M-PESA CSV parsing, exact payment match suggestion, partial balances, inventory, and customer records.
- API test for health, readiness, ledger retrieval, order creation, import, and match workflow.
- Database file repository persistence workflow.

Added Phase 0 characterization tests:

- Pilot order totals and gross profit.
- Matched payment exclusions for non-sales classifications and duplicate status.
- Duplicate receipt detection without automatic status mutation.
- Seed summary and owner report figures.

Missing test categories:

- No TypeScript type tests.
- No linting.
- No integration tests with real PostgreSQL.
- No Redis/BullMQ tests.
- No authorization or tenant isolation tests.
- No property-based tests.
- No browser end-to-end tests.
- No WhatsApp or Daraja contract tests.
- No CSV injection rejection tests.
- No load tests.

## I. Command Results

Commands run:

| Command | Result |
| --- | --- |
| `find . -maxdepth 3 -type f -name '*.tar.gz' -print` | No archive found. Repo was already extracted. |
| `npm install --ignore-scripts` | Passed, already up to date. |
| `npm run test -w @dukaspot/core` | Passed after adding characterization tests. |
| `npm test` | Passed with localhost binding permission. |
| `npm run build` | Passed. API/database/core syntax checks passed; web Vite build passed. |
| `npm run audit` | Failed in sandbox due DNS/network restriction, then passed with registry access: `found 0 vulnerabilities`. |
| `npm run check` | Passed with localhost/network permission. |
| `npm run lint` | Failed: missing npm script. |
| `npm run typecheck` | Failed: missing npm script. |
| `npm run migrate -w @dukaspot/database` | Failed without `DATABASE_URL`, with explicit guard message. |
| `npm run dev` | Started API and web successfully. |
| `curl http://127.0.0.1:8787/api/health` | Passed: `ok: true`, service `dukaspot-api`, persistence `file`. |
| `curl http://127.0.0.1:8787/api/ready` | Passed: `ok: true`, persistence `file`. |
| `curl -I http://127.0.0.1:5173/` | Passed: HTTP 200. |
| `docker compose config` | Passed, but generated project/network/volume names still use `chatledger` from the directory name. |
| `docker compose up --build --detach` | Built API and web images, then failed because host port `5432` was already in use. Created containers/network were removed. Temporary volume was removed. |

## J. Security Considerations

Current mitigations:

- Helmet is enabled.
- CORS allow-list exists.
- Basic request IDs exist.
- Zod validates common mutation payloads.
- Production requires explicit CORS origin and database URL.
- `npm audit` reports zero known vulnerabilities as of this audit.

Critical security gaps:

- No authentication.
- No session security.
- No role or permission model.
- No tenant authorization.
- No CSRF controls.
- No rate limiting.
- No password hashing or account lifecycle.
- No webhook signature validation.
- No encrypted payment-provider credentials.
- No secret masking policy.
- No structured safe logging.
- No audit actor identity.
- CSV export does not prevent spreadsheet formula injection.
- File-backed demo data contains customer names and phone numbers in plaintext.

## K. Architecture Decisions

- Preserve `packages/core` deterministic logic for the next phase. It is small, testable, and contains the product's current domain value.
- Do not start the Next.js/NestJS/Prisma rebuild in Phase 0. The master prompt explicitly says to complete audit and characterization first.
- Treat the JSONB snapshot repository as a pilot compatibility layer and migration source, not as the production data model.
- Treat current UI workflows as behavior references for the future merchant task interface.
- Treat current Docker assets as a starting point only. They build, but do not satisfy non-root runtime, health checks, Redis, worker, object storage, or production hardening requirements.

## L. Remaining Blockers Before Phase 1

- Decide whether the renamed product should also rename the repository directory and Compose project name from `ChatLedger`/`chatledger` to `Dukaspot`/`dukaspot`.
- Add lint and typecheck scripts or acknowledge that TypeScript migration will introduce them in Phase 1.
- Choose package manager and monorepo tooling for the target stack.
- Choose authentication/session library and password hashing package.
- Choose money representation and migration strategy from existing JS-number amounts.
- Design normalized schema and migration validation plan before touching production data paths.

## M. Next Phase

Recommended Phase 1 tasks:

1. Add TypeScript workspace foundation without removing the current pilot.
2. Split `packages/core` into a compatibility domain module with characterization tests still passing.
3. Add typed config package.
4. Add normalized Prisma schema draft and migration docs, but keep the JSONB snapshot path available until migration validation exists.
5. Add Redis and worker scaffolding with tenant-aware job contracts.
6. Add CI workflow that runs install, lint, typecheck, tests, build, audit, and Docker build.

## Required Phase 0 Closing Summary

### Current verified capabilities

- Local npm install completes.
- Local dev stack starts with API on `127.0.0.1:8787` and web on `127.0.0.1:5173`.
- Health and readiness endpoints return `ok: true` in file-backed mode.
- API supports ledger retrieval, order creation, payment CSV import, manual matching, classification, unmatching, inventory creation/restock, reports, exports, and demo reset.
- Web UI exposes dashboard, reconciliation, orders, inventory, customers, agents, and reports.
- Deterministic reconciliation suggests matches using amount, phone, name, time window, and agent scoring.
- File-backed repository serializes writes and writes atomically through a temp file rename.
- PostgreSQL repository stores one JSONB state per merchant and uses row locks during mutations.
- `npm test`, `npm run build`, `npm run audit`, and `npm run check` pass with necessary localhost/network permissions.

### Broken capabilities

- `npm run lint` is missing.
- `npm run typecheck` is missing.
- `docker compose up --build` did not start successfully on this machine because host port `5432` was already in use.
- Docker Compose generated image/network/volume names still use `chatledger` because the project directory name remains `ChatLedger`.
- `npm run migrate -w @dukaspot/database` cannot run without an external `DATABASE_URL`.
- No CI workflow exists.

### Data-integrity risks

- Financial state is mutable JSONB or mutable JSON file content.
- Money uses JavaScript `number`.
- Payment allocation is modeled as one mutable `orderId` on the payment.
- Duplicate receipt detection is not backed by a database unique constraint.
- CSV import silently filters zero-amount rows and does not produce rejection reports.
- Inventory is projected from current order/payment state, not append-only movements.
- No immutable journal entries or balanced double-entry ledger.

### Security risks

- No authentication, sessions, authorization, roles, or tenant membership checks.
- No cross-tenant access controls at the API layer.
- No CSRF protection or rate limiting.
- No encrypted credential storage.
- No webhook signature verification.
- No audit identity beyond a hard-coded default actor.
- No formula-injection prevention in CSV exports.
- Logs are not structured or sensitivity-filtered.

### Multi-tenancy risks

- Tenant identity is configured server-side as one `merchantId`, not resolved from authenticated user membership.
- There are no tenant-owned normalized tables.
- No cross-tenant tests exist.
- Platform admin flows and elevated audit controls do not exist.
- Cache, queue, and object-storage tenant isolation are not applicable yet because those systems do not exist.

### Migration risks

- Existing pilot data is stored as nested JSON snapshots, so migration requires careful mapping into normalized tables.
- Historical financial totals may change if money representation, allocation, inventory, or gross-profit semantics are corrected.
- Existing order/payment IDs are string identifiers with implicit meaning; target schema should preserve source IDs or store legacy IDs.
- There is no migration validation report or rollback procedure yet.

### Code worth preserving

- Deterministic reconciliation scoring and explanations.
- Phone normalization.
- M-PESA CSV parsing as a starting point.
- Order derivation and summary/report calculations as behavior references.
- File repository for local development compatibility.
- PostgreSQL row-locking snapshot repository as an interim migration bridge.
- Existing merchant task UI workflows as product references.

### Code requiring replacement

- JSONB snapshot as the primary production model.
- Mutable payment matching model.
- JS-number money calculations.
- CSV import/export safety model.
- Ad hoc Node test runner once TypeScript tooling is introduced.
- Express API surface if Phase 1 adopts NestJS as required.
- Vite single-file UI if Phase 1 adopts Next.js as required.
- Docker assets before production release, especially non-root runtime, health checks, Compose naming, Redis/worker, and secrets handling.

### Recommended implementation order

1. Add production-grade testing/tooling gates: lint, TypeScript typecheck, CI, and Docker build checks.
2. Introduce identity, membership, tenant context, and authorization before adding multi-tenant data.
3. Design normalized Prisma schema and migration validation reports.
4. Port and harden reconciliation into a dedicated package with allocation records and idempotency.
5. Add append-only inventory movements.
6. Add double-entry ledger posting engine and financial invariants.
7. Add Redis, BullMQ, outbox, and worker scaffolding.
8. Add WhatsApp Cloud API ingestion.
9. Add Daraja integration with encrypted credentials and callback idempotency.
10. Rebuild the merchant UI around onboarding, order workspace, reconciliation, inventory, and reporting.

### Realistic readiness score based on evidence

Weighted production SaaS readiness: **14 / 100**.

Score rationale:

| Area | Weight | Score |
| --- | ---: | ---: |
| Authentication and authorization | 10 | 0 |
| Tenant isolation | 10 | 1 |
| Financial integrity | 15 | 2 |
| Payment idempotency | 10 | 2 |
| Data model and migrations | 8 | 1 |
| WhatsApp reliability | 7 | 0 |
| Daraja reliability | 7 | 0 |
| Security | 10 | 2 |
| Testing | 8 | 2 |
| Observability | 5 | 1 |
| Deployment and rollback | 4 | 1 |
| Backup and recovery | 3 | 0 |
| Merchant usability | 3 | 2 |
| Total | 100 | 14 |

This is a working single-merchant pilot foundation, not a production-ready multi-tenant fintech SaaS platform.
