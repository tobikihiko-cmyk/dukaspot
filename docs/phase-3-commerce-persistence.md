# Dukaspot Phase 3 Commerce Persistence Report

Date: 2026-08-07

Phase 3 moved Dukaspot from identity-only tenancy into authenticated tenant commerce persistence. The API still returns the existing pilot ledger shape for compatibility, but authenticated PostgreSQL ledger routes now read and write normalized commerce tables for orders, payments, inventory, allocations, outbox events, and idempotency records.

## A. Work Completed

- Added normalized commerce migration `003_commerce_persistence.sql`.
- Aligned Prisma enum mappings and commerce models with the SQL migration.
- Added pilot-compatible normalized columns for order stage, payment status, order metadata, payment classification, payment external IDs, variant external IDs, reorder points, opening stock, and idempotency records.
- Added `PostgresCommerceLedgerRepository` for tenant-specific normalized PostgreSQL commerce reads/writes.
- Added `PostgresLedgerRepository.forMerchant(merchantId)` to return the normalized tenant repository for authenticated ledger routes.
- Added repository-level idempotency for local file mode and persistent PostgreSQL idempotency records.
- Required authenticated session context for ledger reads, reports, exports, and mutations.
- Required role-derived permissions on ledger routes.
- Required `Idempotency-Key` on mutating ledger routes.
- Added optional `x-dukaspot-merchant-id` tenant selection for multi-merchant sessions.
- Added OpenAPI session-cookie security metadata, tenant header metadata, and mutation idempotency header metadata.
- Added an optional PostgreSQL integration test that runs migrations and exercises normalized commerce persistence against a real database.

## B. Files Created Or Modified

Created:

- `packages/database/migrations/003_commerce_persistence.sql`
- `packages/database/src/commerce-repository.js`
- `packages/database/tests/postgres-commerce.test.mjs`
- `docs/phase-3-commerce-persistence.md`

Modified:

- `README.md`
- `apps/api/src/nest-app.ts`
- `apps/api/tests/api.test.mjs`
- `packages/database/package.json`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/file-repository.js`
- `packages/database/src/index.d.ts`
- `packages/database/src/index.js`
- `packages/database/src/postgres-repository.js`
- `packages/database/tests/repository.test.mjs`

## C. Architecture Decisions

- Preserve the current ledger response contract while shifting authenticated PostgreSQL persistence to normalized commerce rows. This lets the frontend and API tests keep working while the storage model evolves.
- Keep the legacy `PostgresLedgerRepository` snapshot path for readiness and backward compatibility, but route authenticated tenant ledger operations through `forMerchant`.
- Use business-facing external IDs (`ord_*`, `pay_*`, SKUs) in API responses while storing UUID primary keys and foreign keys internally.
- Store idempotency records per merchant in PostgreSQL, keyed by `Idempotency-Key` and a stable request-body hash.
- Keep file-mode idempotency in memory for local tests and development. PostgreSQL is the production tenant isolation path.
- Use outbox events for commerce mutations so future workers can publish downstream jobs without changing the API boundary.

## D. Database Changes

Added:

- Enum types: `order_status`, `inventory_movement_type`, `payment_provider`, `payment_status`, and `journal_entry_status`.
- Commerce tables: `branches`, `customers`, `products`, `product_variants`, `inventory_locations`, `inventory_movements`, `orders`, `order_items`, `payments`, and `payment_allocations`.
- Accounting/event tables: `journal_entries`, `journal_lines`, `outbox_events`, and `webhook_events`.
- Idempotency table: `idempotency_records`.

Important constraints:

- Tenant-owned tables reference `merchants(id)` and cascade on merchant deletion.
- Orders are unique by `(merchant_id, order_number)`.
- Payments are unique by `(merchant_id, external_id)` and `(merchant_id, provider, receipt)`.
- Product variants are unique by `(merchant_id, sku)` and `(merchant_id, external_id)`.
- Payment allocations are unique by `(merchant_id, payment_id, order_id)`.
- Idempotency records are unique by `(merchant_id, idempotency_key)`.

## E. Tests

Added or updated:

- API integration test now verifies anonymous ledger access returns `UNAUTHORIZED`.
- API integration test now verifies authenticated ledger access with a session cookie.
- API integration test now verifies missing `Idempotency-Key` returns `BAD_REQUEST`.
- API integration test now verifies idempotent order creation replay does not create a duplicate order.
- API integration test now verifies reusing an idempotency key with a different payload returns `CONFLICT`.
- File repository test now covers local idempotency replay and conflict behavior.
- PostgreSQL commerce test now runs migrations, creates real merchants, seeds/read projects tenant ledger state, creates an order, replays idempotency, imports/matches a payment, and confirms another merchant cannot see the created order.

## F. Results

Verified commands:

| Command | Result |
| --- | --- |
| `npm run build -w @dukaspot/database` | Passed |
| `npm run test -w @dukaspot/database` | Passed with PostgreSQL test skipped when `DUKASPOT_POSTGRES_TEST_URL` is unset |
| `npm run test -w @dukaspot/api` | Passed with localhost binding permission |
| `npm run lint` | Passed |
| `npm run db:validate` | Passed; Prisma schema valid |
| `npm run typecheck` | Passed |
| `npm test` | Passed with localhost binding permission |
| `npm run check` | Passed end-to-end with localhost and registry permission; `found 0 vulnerabilities` |
| `docker compose config` | Passed |
| `POSTGRES_PORT=55433 docker compose up -d postgres` | Passed after default port `5433` was already allocated |
| `DUKASPOT_POSTGRES_TEST_URL=postgres://dukaspot:dukaspot@127.0.0.1:55433/dukaspot npm run test -w @dukaspot/database` | Passed against real PostgreSQL |
| `POSTGRES_PORT=55433 docker compose stop postgres` | Passed |
| `docker compose build api` | Passed |

## G. Security Considerations

Improved:

- Ledger reads, reports, exports, and mutations now require an authenticated session.
- Ledger routes resolve tenant access from active merchant membership.
- Mutations enforce role-derived permissions before writes.
- Mutations require idempotency keys and reject key reuse with mismatched payloads.
- PostgreSQL idempotency is tenant-scoped.
- Normalized commerce rows carry merchant foreign keys, reducing cross-tenant query risk.
- The real PostgreSQL integration test verifies data created for one merchant is not visible to another merchant.

Still missing:

- CSRF strategy for cookie-authenticated mutations.
- Rate limiting for auth and mutation routes.
- Authenticated frontend login and tenant switching UI.
- PostgreSQL row-level security policies.
- Full audit actor persistence beyond the compatibility audit log.
- Double-entry posting behavior for orders, payments, refunds, fees, and inventory cost of goods sold.

## H. Remaining Blockers

- The Next.js dashboard is still a static foundation screen and has no login/session UI.
- File-mode ledger storage remains single-file compatibility storage and should not be treated as production tenant isolation.
- The normalized repository currently projects one order item per pilot order because the current API contract only captures one item per order.
- Payment allocation remains a compatibility single-payment-to-order path in the API, though the table can support richer allocation records later.
- Full `docker compose up` for all services was not run in this phase; only Postgres was started for integration testing.

## I. Next Phase

Proceed to Phase 4: financial ledger posting and accounting correctness. The next work should add double-entry journal posting for order confirmation, payment allocation, refunds, expenses, delivery fees, inventory COGS, reversals, and trial balance reporting, while preserving idempotency and tenant isolation.
