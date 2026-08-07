# Dukaspot Phase 2 Identity And Tenancy Report

Date: 2026-08-06

Phase 2 established the first production identity and tenant boundary for Dukaspot. The ledger pilot routes remain compatibility routes, but the API now has owner registration, login, logout, current-session lookup, role-derived permissions, session persistence, and an explicit tenant access check backed by file and PostgreSQL repository implementations.

## A. Work Completed

- Added `@dukaspot/auth` for membership roles, permissions, permission checks, and tenant assertions.
- Added `@dukaspot/security` for Argon2id password hashing, password verification, opaque session tokens, token hashing, and opaque IDs.
- Added shared auth request/response schemas to `@dukaspot/contracts`.
- Added typed `DUKASPOT_IDENTITY_FILE` configuration for local identity storage.
- Added a database identity repository abstraction with file-backed local persistence and PostgreSQL-backed production persistence.
- Added API auth routes under both `/api` and `/api/v1`: register, login, logout, and current session.
- Added `/api/tenants/:merchantId` and `/api/v1/tenants/:merchantId` to prove tenant membership enforcement from a session.
- Added HTTP-only session cookies with one-week expiry and `Secure` cookies in production mode.
- Added stable error-code serialization for repository/auth errors such as `UNAUTHORIZED`, `CONFLICT`, and `TENANT_ACCESS_DENIED`.
- Added OpenAPI entries for the identity and tenant routes.
- Updated Dockerfiles so the new `auth` and `security` workspaces are available in API, web, and worker builds.

## B. Files Created Or Modified

Created:

- `packages/auth/package.json`
- `packages/auth/tsconfig.json`
- `packages/auth/src/index.ts`
- `packages/auth/tests/auth.test.mjs`
- `packages/security/package.json`
- `packages/security/tsconfig.json`
- `packages/security/src/index.ts`
- `packages/security/tests/security.test.mjs`
- `packages/database/src/identity-repository.js`
- `packages/database/migrations/002_identity_tenancy.sql`
- `packages/database/tests/identity.test.mjs`
- `docs/phase-2-identity-tenancy.md`

Modified:

- `package-lock.json`
- `tsconfig.json`
- `.env.example`
- `README.md`
- `apps/api/.env.example`
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/Dockerfile`
- `apps/api/src/config.js`
- `apps/api/src/main.ts`
- `apps/api/src/nest-app.ts`
- `apps/api/src/validation.ts`
- `apps/api/tests/api.test.mjs`
- `apps/web/Dockerfile`
- `apps/worker/Dockerfile`
- `packages/config/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/database/package.json`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/index.d.ts`
- `packages/database/src/index.js`

## C. Architecture Decisions

- Keep auth and security as separate packages. Authorization rules change with product policy, while password/session primitives should stay small and harder to misuse.
- Use Argon2id through `@node-rs/argon2` instead of bcrypt or a pure-JS password hash.
- Store only hashed session tokens. Raw session tokens are returned to clients only through an HTTP-only cookie.
- Keep the identity repository beside the existing database package instead of introducing Prisma runtime calls yet. This matches the current repository boundary and keeps Phase 2 incremental.
- Support both file and PostgreSQL identity storage so local development and API integration tests do not require a database service.
- Do not gate the existing pilot ledger routes behind auth yet. Phase 2 proves user/session/tenant isolation, while later commerce phases should move ledger mutations onto authenticated, tenant-scoped normalized repositories.
- Map Prisma `MembershipRole` to the SQL enum name `membership_role` so the schema and migration describe the same PostgreSQL type.

## D. Database Changes

Added migration `packages/database/migrations/002_identity_tenancy.sql`:

- Enables `pgcrypto` for UUID generation.
- Creates `membership_role` enum if it does not exist.
- Creates `users` with unique normalized email, optional password hash, email verification flag, and timestamps.
- Creates `merchants` with slug, legal/trading names, currency, time zone, and timestamps.
- Creates `merchant_memberships` with `(merchant_id, user_id)` uniqueness, active flag, and role.
- Creates `sessions` with unique token hash, expiry, revocation timestamp, and user foreign key.
- Adds lookup indexes for memberships and sessions.

Runtime behavior:

- Local development uses `data/dukaspot.identity.dev.json` unless `DUKASPOT_IDENTITY_FILE` is set.
- PostgreSQL mode uses the new identity tables when `DATABASE_URL` is configured.
- Existing pilot ledger mutations still use the JSON/file or `ledger_states` snapshot repository.

## E. Tests

Added or updated tests:

- API integration test now covers anonymous `/auth/me`, owner registration, duplicate registration conflict, login failure, login success, `/auth/me`, logout, session revocation, and cross-tenant denial.
- Database identity test covers file-backed owner creation, duplicate email protection, membership lookup, session creation, session revocation, and cross-tenant denial.
- Auth package test covers role-derived permissions, permission denial, and tenant assertion denial.
- Security package test covers Argon2id password hashing, password verification, session token creation, and deterministic token hashing.

## F. Results

Verified commands:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Initially blocked by sandbox localhost binding; passed with localhost permission |
| `npm run db:validate` | Passed; Prisma schema valid |
| `npm run build` | Passed |
| `npm run audit` | Initially blocked by sandbox DNS; passed with registry access: `found 0 vulnerabilities` |
| `npm run check` | Passed end-to-end with localhost and registry permission |
| `docker compose config` | Passed |
| `docker compose build api web worker` | Initially blocked by Docker buildx sandbox write restriction; passed with Docker approval |

## G. Security Considerations

Improved:

- Passwords are hashed with Argon2id before persistence.
- Session storage uses SHA-256 token hashes instead of storing raw bearer tokens.
- Session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped to `/`, and expire after seven days.
- Production-mode cookies include `Secure`.
- Login failures return `UNAUTHORIZED` without revealing whether the email exists.
- Tenant access failures return a stable `TENANT_ACCESS_DENIED` code.
- Repository tests and HTTP tests both prove a user from one merchant cannot read another merchant through the tenant endpoint.
- `npm audit --workspaces` is clean.

Still missing:

- CSRF strategy for cookie-authenticated mutations.
- Rate limiting and lockout controls for login/register.
- Email verification and password reset flows.
- MFA, invite flows, role management endpoints, and membership lifecycle screens.
- Authenticated audit actor propagation into ledger mutations.
- Idempotency keys for financial mutations.
- PostgreSQL integration tests that run migrations against a real database.

## H. Remaining Blockers

- The existing pilot ledger routes are not yet authenticated or scoped from a per-request tenant context.
- Normalized commerce tables are still schema/migration scaffolds; orders, payments, inventory, allocations, and journal entries are not yet runtime repositories.
- There is no UI for login, registration, tenant switching, or membership administration.
- No production session secret rotation, device/session listing, or account recovery flow exists.
- No full `docker compose up` smoke test was run after the successful image builds.

## I. Next Phase

Proceed to Phase 3: authenticated commerce persistence. The next work should move order, payment, inventory, and allocation mutations into normalized PostgreSQL repositories, require authenticated tenant context for those routes, add idempotency keys, and introduce PostgreSQL-backed integration tests for tenant isolation across real tables.
