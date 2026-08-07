# Dukaspot Launch Readiness

## Readiness Rating

This document has been superseded by the evidence-based Phase 0 audit and the current phase reports through [phase-6-production-hardening.md](phase-6-production-hardening.md).

Current Phase 0 production SaaS readiness score: **14 / 100**.

Phase 6 improves the technical foundation, authenticated tenancy, normalized commerce persistence, accounting posting path, authenticated frontend workflows, CSRF protection, and basic rate limiting, but this is still only ready for a small merchant pilot where operators understand that payment matching and journal posting need human review. It is not yet a regulated accounting, lending, or tax product.

## Resolved Blockers

- Frontend, backend, core logic, and database persistence are separated into workspaces.
- The browser no longer owns financial state.
- API mutations are validated before they reach persistence.
- API responses include JSON 404s, CORS failures use 403s, and every response gets an `x-request-id`.
- Local development accepts both `127.0.0.1:5173` and `localhost:5173`; production requires an explicit `CORS_ORIGIN`.
- `/api/ready` verifies that the persistence layer can return a ledger.
- M-PESA CSV import, payment matching, classification, exports, and reset flows are server-backed.
- PostgreSQL deployment path exists through `DATABASE_URL` and migrations.
- Next.js, NestJS, BullMQ worker, shared TypeScript packages, Prisma schema validation, and CI now exist.
- `/api/v1` aliases and OpenAPI JSON now exist.
- Local development still works without Postgres through serialized, atomic file persistence.
- PostgreSQL ledger mutations are transactional with row-level locking.
- Dockerfiles and `docker-compose.yml` define a deployable topology.
- Tests cover core matching, file persistence, and API workflows.
- Production API startup requires `DATABASE_URL`.
- `npm audit` is clean.
- Docker images for API, web, and worker build successfully.
- Session-based authentication and role-derived tenant authorization protect API ledger routes.
- PostgreSQL commerce mutations use normalized tenant tables for orders, payments, inventory, and allocations.
- Mutating ledger routes require idempotency keys.
- PostgreSQL accounting posts deterministic journal entries and exposes a tenant-scoped trial balance.
- The Next.js frontend supports login, registration, logout, session resume, tenant selection, permission-aware controls, and trial balance visibility.
- Cookie-authenticated ledger mutations and logout require double-submit CSRF tokens.
- Login, registration, logout, and unsafe mutation routes have basic in-process rate limits.
- OpenAPI documents `/api/v1/auth/csrf`, CSRF headers, idempotency headers, and rate-limit errors.

## Remaining Non-Blockers

- Add browser-level automated UI tests.
- Replace in-process rate limiting with Redis-backed or edge/provider-backed distributed rate limiting before horizontal production scaling.
- Add password reset, email verification, and user/member management screens.
- Add accountant review workflows, adjustment journals, period locking, and close controls.
- Add tax/VAT, restock purchase accruals, shipping payables, and configurable chart of accounts.
- Add PostgreSQL row-level security policies before opening this to unrelated merchants.
- Add metrics, traces, error tracking, dashboards, and incident runbooks.
- Add backups and restore drills for production PostgreSQL.
- Add WhatsApp Business and M-PESA Daraja integrations only after consent and data-protection review.

## Launch Gate

Ship to pilot when:

- `npm run check` passes.
- `docker compose up --build` starts all services.
- `/api/health` and `/api/ready` return `ok: true`.
- A merchant can create an order, import M-PESA CSV, match a payment, review trial balance, export ledgers, and reset demo data in staging.
