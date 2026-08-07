# Dukaspot Phase 4 Accounting Correctness Report

Date: 2026-08-07

Phase 4 adds first-pass double-entry accounting controls to the authenticated PostgreSQL commerce path. Dukaspot now posts deterministic journal entries for order revenue, delivery fees, discounts, cost of goods sold, payment allocations, classified non-sales payments, and reversals, then exposes a tenant-scoped trial balance API.

## A. Work Completed

- Added accounting migration `004_accounting_controls.sql`.
- Added journal-line controls so each line must be a single-sided positive debit or credit.
- Added a journal entry index for merchant/entry lookup.
- Added repository `getTrialBalance()` contract and response types.
- Added file-repository trial balance fallback for local/dev compatibility.
- Added PostgreSQL trial balance aggregation from posted journal entries.
- Added deterministic double-entry posting for eligible orders.
- Added COGS/inventory postings for posted order stages.
- Added payment allocation postings against accounts receivable and M-PESA cash.
- Added classified payment postings for owner deposits, personal transfers, supplier payments, business expenses, refunds, and delivery payments.
- Added reversal journal entries when payments are unmatched, reclassified, or rematched.
- Added authenticated `GET /api/accounting/trial-balance` and `/api/v1/accounting/trial-balance`.
- Added OpenAPI metadata for the trial balance route.
- Extended tests for API access and PostgreSQL accounting balance.

## B. Files Created Or Modified

Created:

- `packages/database/migrations/004_accounting_controls.sql`
- `docs/phase-4-accounting-correctness.md`

Modified:

- `README.md`
- `apps/api/src/nest-app.ts`
- `apps/api/tests/api.test.mjs`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/commerce-repository.js`
- `packages/database/src/file-repository.js`
- `packages/database/src/index.d.ts`
- `packages/database/tests/postgres-commerce.test.mjs`

## C. Accounting Behavior

Posted order stages:

- `reserved`
- `confirmed`
- `dispatched`

Non-posted or reversed order stages:

- `enquiry`
- `cancelled`
- `returned`

Core posting rules:

- Order sale: debit accounts receivable; debit sales discounts when present; credit sales revenue and delivery revenue.
- Order COGS: debit cost of goods sold; credit inventory.
- Payment allocation: debit M-PESA cash and credit accounts receivable for inflows; reverse direction for negative payment allocations.
- Owner deposit: debit cash and credit owner contribution for inflows.
- Personal transfer: posts to owner contribution for inflows and owner draw for outflows.
- Supplier payment: debit supplier payments and credit cash for outflows.
- Business expense: debit business expense and credit cash for outflows.
- Refund: debit customer refunds and credit cash for outflows.
- Delivery payment: debit cash and credit delivery revenue for inflows.

## D. Trial Balance API

Authenticated routes:

- `GET /api/accounting/trial-balance`
- `GET /api/v1/accounting/trial-balance`

Permission:

- `report:read`

Response shape:

- `merchantId`
- `currency`
- `generatedAt`
- `accounts`
- `totalDebits`
- `totalCredits`
- `balanced`

Only `POSTED` journal entries are included. Reversed source entries are excluded, and their explicit reversal entries remain posted until the same source event is reactivated.

## E. Tests

Added or updated:

- API integration test verifies OpenAPI includes the trial balance route.
- API integration test verifies anonymous trial balance access returns `UNAUTHORIZED`.
- API integration test verifies authenticated trial balance response is balanced in file mode.
- PostgreSQL commerce test verifies seed accounting creates a balanced trial balance.
- PostgreSQL commerce test verifies order creation, import, payment allocation, unmatch reversal, and rematch remain balanced.
- PostgreSQL commerce test verifies expected accounts appear in the trial balance.
- PostgreSQL commerce test verifies no journal entry has unequal debit and credit totals.
- PostgreSQL commerce test preserves tenant isolation by checking another merchant cannot see the created order and has a balanced own trial balance.

## F. Results

Verified commands:

| Command | Result |
| --- | --- |
| `npm run build -w @dukaspot/database` | Passed |
| `npm run test -w @dukaspot/api` | Passed with localhost binding permission |
| `npm run test -w @dukaspot/database` | Passed with PostgreSQL test skipped when `DUKASPOT_POSTGRES_TEST_URL` is unset |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run db:validate` | Passed; Prisma schema valid |
| `npm test` | Passed with localhost binding permission |
| `npm run check` | Passed end-to-end with localhost and audit permission; `found 0 vulnerabilities` |
| `POSTGRES_PORT=55433 docker compose up -d postgres` | Passed |
| `DUKASPOT_POSTGRES_TEST_URL=postgres://dukaspot:dukaspot@127.0.0.1:55433/dukaspot npm run test -w @dukaspot/database` | Passed against real PostgreSQL |
| `POSTGRES_PORT=55433 docker compose stop postgres` | Passed |

## G. Security And Correctness Considerations

Improved:

- Trial balance reads require authenticated tenant membership and `report:read`.
- Journal rows are tenant-scoped and cascade with merchant deletion.
- Journal sources are deterministic to preserve idempotent commerce behavior.
- Reclassification and unmatching create explicit reversal entries instead of silently deleting accounting history.
- Database constraints reject zero, negative, and two-sided journal lines.
- Integration tests verify each journal entry balances independently.

Still missing:

- Formal chart-of-accounts table and account types.
- Period locking and close controls.
- Tax/VAT posting.
- Shipping/courier payable posting.
- Inventory restock/purchase accrual posting.
- Multi-line order accounting.
- Cash-basis vs accrual-basis reporting options.
- Row-level security policies.
- Accountant review and adjustment journal workflows.

## H. Remaining Blockers

- The frontend does not yet show the authenticated trial balance.
- The chart of accounts is currently code-defined, not merchant-configurable.
- File-mode trial balance is an empty compatibility fallback; production accounting behavior is PostgreSQL-only.
- Accounting postings are operationally useful but not yet sufficient for statutory tax filings or regulated financial reporting.
- Full `docker compose up` for all services was not run in this phase; only Postgres was started for integration testing.

## I. Next Phase

Proceed to Phase 5: authenticated frontend workflows. The next work should add login/session UI, tenant selection, authenticated API client behavior, trial balance visibility, and permission-aware dashboard states while preserving the pilot ledger workflows.
