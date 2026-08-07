# Dukaspot Phase 6 Production Hardening Report

Date: 2026-08-07

Phase 6 adds the first browser-mutation hardening layer for the authenticated Dukaspot workspace. Cookie-backed mutations now require a double-submit CSRF token, auth-sensitive routes have basic in-process rate limits, the web client refreshes CSRF tokens automatically, and the API contract documents the new security headers.

## A. Work Completed

- Added a `GET /api/auth/csrf` and `GET /api/v1/auth/csrf` endpoint.
- Added a readable `dukaspot_csrf` cookie for browser double-submit protection.
- Kept `dukaspot_session` as an HTTP-only session cookie.
- Added CSRF token issuance on registration and login.
- Required `x-csrf-token` to match the CSRF cookie for logout and all idempotent ledger mutations.
- Cleared the CSRF cookie during logout alongside the session cookie.
- Added in-process per-client rate limits for login, registration, logout, and unsafe mutation routes.
- Added rate-limit response headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, and `retry-after` on blocked requests.
- Added OpenAPI coverage for the CSRF endpoint, CSRF header, and `429` errors.
- Updated the authenticated frontend API client to fetch/cache CSRF tokens for unsafe requests.
- Extended API tests to prove missing CSRF is rejected while valid CSRF plus idempotency still supports create/replay/conflict flows.

## B. Files Created Or Modified

Created:

- `docs/phase-6-production-hardening.md`

Modified:

- `README.md`
- `apps/api/src/nest-app.ts`
- `apps/api/tests/api.test.mjs`
- `apps/web/app/merchant-workspace.tsx`
- `docs/launch-readiness.md`

## C. Security Behavior

CSRF:

- `GET /api/auth/csrf` returns `{ csrfToken }` and sets `dukaspot_csrf`.
- Browser mutations send the token as `x-csrf-token`.
- The API compares the header and cookie before executing ledger mutation side effects.
- Login and registration remain CSRF-token bootstrap points.

Rate limiting:

- Login: 10 requests per minute per client.
- Registration: 5 requests per minute per client.
- Logout: 30 requests per minute per client.
- Other unsafe API methods: 120 requests per minute per client.
- Current limiter is process-local and should be replaced by Redis or provider-native rate limiting before horizontal production scaling.

## D. Tests And Verification

Verified command:

| Command | Result |
| --- | --- |
| `npm run check` | Passed end-to-end with localhost binding permission; `npm audit` found 0 vulnerabilities |

Notes:

- The first sandboxed run reached the API test but failed to bind `127.0.0.1` with `EPERM`.
- The approved rerun passed lint, typecheck, workspace tests, Prisma validation, production build, and audit.
- The optional PostgreSQL commerce integration test remains skipped unless `DUKASPOT_POSTGRES_TEST_URL` is set.

## E. Remaining Production Work

- Add browser-level automated UI tests for login, tenant selection, order creation, payment import/matching, exports, and logout.
- Replace in-process rate limiting with a shared Redis-backed or edge/provider-backed limiter before multi-instance deployment.
- Add structured frontend error telemetry and server-side metrics/tracing dashboards.
- Add password reset, email verification, and member management screens.
- Add accountant review workflows, adjustment journals, period locking, and close controls.
- Add PostgreSQL row-level security policies before opening this to unrelated merchants.
- Add backups, restore drills, staging smoke tests, and incident runbooks.
- Add WhatsApp Business and M-PESA Daraja integrations only after consent and data-protection review.

## F. Next Phase

Proceed to Phase 7: automated browser/staging verification and operational telemetry. The next work should add Playwright coverage for the authenticated workspace, staging smoke scripts, frontend error capture, and production observability hooks.
