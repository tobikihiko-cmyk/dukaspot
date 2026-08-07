# Dukaspot Phase 1 Foundation Report

Date: 2026-08-06

Phase 1 established the production foundation requested by the master prompt while preserving the Phase 0 pilot behavior behind compatibility adapters. This is still not production SaaS. The normalized database schema, worker queues, typed packages, CI, and Docker topology now exist; auth, tenancy enforcement, double-entry posting, provider integrations, and migrations remain Phase 2+ work.

## A. Work Completed

- Converted the workspace foundation to strict TypeScript with root project references.
- Added flat ESLint configuration and root verification scripts: `lint`, `typecheck`, `db:validate`, and aggregate `check`.
- Introduced shared packages for API contracts, environment configuration, and observability.
- Replaced the Express runtime entry with a NestJS API wrapper while preserving existing pilot routes and behavior.
- Added `/api/v1` route aliases, structured error envelopes, request correlation IDs, Helmet, CORS, readiness, and local OpenAPI JSON at `/api/docs` and `/api/openapi.json`.
- Added a Next.js app-router web shell for the merchant operations dashboard.
- Added a BullMQ worker app with typed queue names and structured job envelope validation.
- Added a normalized Prisma schema scaffold for tenants, users, merchants, inventory, orders, payments, allocations, journal entries, outbox, and webhook events.
- Added Dockerfiles for API, web, and worker plus Redis in Compose.
- Added GitHub Actions CI for install, lint, typecheck, tests, Prisma validation, build, and audit.

## B. Files Created Or Modified

Created:

- `.github/workflows/ci.yml`
- `.dockerignore`
- `tsconfig.base.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `apps/api/src/main.ts`
- `apps/api/src/nest-app.ts`
- `apps/api/src/validation.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/api-health-pill.tsx`
- `apps/web/app/globals.css`
- `apps/web/next.config.ts`
- `apps/web/next-env.d.ts`
- `apps/web/tsconfig.json`
- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/src/main.ts`
- `apps/worker/src/queues.ts`
- `apps/worker/Dockerfile`
- `packages/contracts/*`
- `packages/config/*`
- `packages/observability/*`
- `packages/database/prisma/schema.prisma`
- `packages/core/src/ledger.d.ts`
- `packages/database/src/index.d.ts`
- `docs/phase-1-foundation.md`

Modified:

- `package.json`
- `package-lock.json`
- `README.md`
- `docker-compose.yml`
- `apps/api/package.json`
- `apps/api/Dockerfile`
- `apps/api/tests/api.test.mjs`
- `apps/web/package.json`
- `apps/web/Dockerfile`
- `apps/web/tailwind.config.js`
- `packages/core/package.json`
- `packages/database/package.json`
- `docs/launch-readiness.md`

## C. Architecture Decisions

- Keep the pilot domain logic in `packages/core` as the characterization-protected source of truth until Phase 2 extracts proper domain modules.
- Use TypeScript project references for `contracts`, `config`, `observability`, API, and worker so build order is explicit.
- Use NestJS as the API runtime now, but delegate ledger mutations to the existing repository so Phase 1 does not rewrite financial behavior.
- Expose local OpenAPI JSON without `@nestjs/swagger`; removing that dependency chain kept `npm audit` clean.
- Use Next.js 16 with webpack builds. Turbopack failed in this sandbox with a port-binding panic, and Next's TypeScript CLI checker failed to parse captured `tsc --showConfig`, so `experimental.useTypeScriptCli` is disabled and the build script runs `tsc` directly before `next build --webpack`.
- Pin TypeScript to `5.9.3`. TypeScript 7 was the registry latest, but the current lint/build ecosystem here required the latest compatible 5.x line for stable Next and `typescript-eslint` behavior.
- Use Prisma 6.19.3 for the schema scaffold. Prisma 7 moved datasource URL configuration out of schema and raised runtime expectations, so Prisma 6 is the compatible foundation for the current Node 20 baseline.
- Upgrade `lucide-react` to a React 19-compatible release and dedupe the workspace so Next, Lucide, TanStack Query, React Hook Form, React, and React DOM resolve to React 19.2.8 instead of a split React 18/19 tree.

## D. Database Changes

- Added a Prisma schema scaffold at `packages/database/prisma/schema.prisma`.
- Modeled tenant-owned data with explicit `tenantId` fields and composite uniqueness where relevant.
- Added entities for users, sessions, merchants, memberships, branches, customers, products, variants, inventory locations, inventory movements, orders, order items, payments, payment allocations, journal entries, journal lines, outbox events, and webhook events.
- Modeled monetary amounts as integer minor units (`BigInt`) in the new schema.

No Prisma migration was generated in Phase 1. The existing JSONB/file repository remains the runtime persistence path until Phase 2 migration planning and data validation.

## E. Tests

Added or updated tests:

- API integration test now boots the Nest app and validates health, readiness, OpenAPI JSON, structured errors, `/api/v1/ledger`, order creation, payment import, and manual matching.
- Existing core characterization tests from Phase 0 remain intact.
- Web test is now `tsc -p tsconfig.json --noEmit`.
- Worker test builds the worker TypeScript package.
- Prisma validation is part of the root `check` command.

## F. Results

Verified commands:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed with localhost binding permission |
| `npm run db:validate` | Passed; Prisma schema valid |
| `npm run build` | Passed |
| `npm run audit` | Passed with registry access: `found 0 vulnerabilities` |
| `npm run check` | Passed end-to-end with localhost and registry permission |
| `docker compose config` | Passed; project name is now `dukaspot` |
| `docker compose build api web worker` | Passed after fixing TypeScript build-info/Dockerfile issues and rebuilding on the final lockfile |
| `docker compose build web` | Passed after disabling Next telemetry in the final web image |

## G. Security Considerations

Improved:

- Structured error envelope includes stable error codes and request correlation IDs.
- Structured Pino logging package includes common sensitive-field redaction.
- CORS remains allow-list based.
- Helmet remains enabled.
- OpenAPI docs avoid the vulnerable Swagger dependency chain.
- Docker runtime images use non-root users.
- `npm audit --workspaces` is clean.

Still missing:

- Authentication, session lifecycle, password hashing, RBAC, tenant authorization, idempotency keys, rate limiting, CSRF decisions, webhook signature verification, encrypted provider credentials, audit actor identity, and production secrets management.

## H. Remaining Blockers

- The normalized Prisma schema is not migrated or connected to runtime repositories.
- Tenant IDs exist in contracts/schema but are not enforced from authenticated user context.
- The worker queues are wired but not connected to real WhatsApp, Daraja, ledger posting, reconciliation, or notification jobs.
- The API still delegates to pilot JSON ledger behavior for all business mutations.
- No browser E2E tests, PostgreSQL integration tests, Redis/BullMQ integration tests, or load tests exist yet.
- Compose can build all images, but full `docker compose up` was not re-run after the Phase 1 image fixes.

## I. Next Phase

Proceed to Phase 2: domain model and persistence. The next work should connect the Prisma schema to real repositories, create migrations, enforce tenant boundaries from authenticated context, introduce idempotent mutation boundaries, and start replacing JSONB snapshot writes with normalized transactional tables.
