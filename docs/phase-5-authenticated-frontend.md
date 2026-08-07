# Dukaspot Phase 5 Authenticated Frontend Report

Date: 2026-08-07

Phase 5 turns the Next.js frontend from a static foundation screen into an authenticated merchant workspace. The web app now resumes API sessions, supports owner login and registration, selects an active merchant tenant, sends tenant/idempotency headers for API calls, gates views and actions by permissions, and renders the Phase 4 trial balance.

## A. Work Completed

- Replaced the static Next.js page with a client-side merchant workspace.
- Added login and registration forms backed by `/api/auth/login` and `/api/auth/register`.
- Added session resume through `/api/auth/me`.
- Added logout through `/api/auth/logout`.
- Added merchant tenant selection for multi-membership sessions.
- Added an authenticated API client using same-origin cookies, tenant headers, and idempotency keys for mutations.
- Added role/permission-aware navigation.
- Added permission-aware order, payment, inventory, accounting, and report controls.
- Added authenticated ledger loading from `/api/ledger`.
- Added authenticated trial balance loading from `/api/accounting/trial-balance`.
- Added order creation and stage update workflows.
- Added payment CSV import, order matching, classification, and unmatch workflows.
- Added inventory item creation and restock workflows.
- Added CSV exports through authenticated download requests.
- Preserved the API health indicator in the authenticated shell and auth screen.

## B. Files Created Or Modified

Created:

- `apps/web/app/merchant-workspace.tsx`
- `docs/phase-5-authenticated-frontend.md`

Modified:

- `README.md`
- `apps/web/app/page.tsx`
- `docs/launch-readiness.md`

## C. Frontend Behavior

Session states:

- Anonymous users see login/register controls.
- Existing session cookies are resumed on page load.
- Expired or revoked sessions return to the auth screen.
- Logout clears the browser workspace state.

Tenant behavior:

- The active tenant is selected from API-provided memberships.
- Ledger, trial balance, exports, and mutations include `x-dukaspot-merchant-id`.
- Multi-tenant users can switch merchants from the header.

Permission behavior:

- Navigation hides views the active tenant role cannot read.
- Order mutation controls require `order:write`.
- Payment allocation/classification controls require `payment:allocate`.
- Inventory mutation controls require `inventory:write`.
- Accounting and report panels require `report:read`.

Accounting behavior:

- Trial balance totals and account rows are fetched from the authenticated API.
- Balanced status is shown in the summary metrics and accounting view.
- Trial balance refreshes after ledger mutations when the active role can read reports.

## D. Tests And Verification

Verified commands:

| Command | Result |
| --- | --- |
| `npm run test -w @dukaspot/web` | Passed |
| `npm run lint` | Passed |
| `npm run build -w @dukaspot/web` | Passed |
| `npm run test -w @dukaspot/api` | Passed with localhost binding permission |
| `npm run check` | Passed end-to-end with localhost and audit permission; `found 0 vulnerabilities` |
| Local API dev server on `127.0.0.1:8787` with `/tmp` data files | Started and stopped successfully |
| Local Next dev server with `API_PROXY_TARGET=http://127.0.0.1:8787` | Started on `127.0.0.1:3001` because `3000` was occupied |
| `GET http://127.0.0.1:3001/` | Returned `200` |
| `GET http://127.0.0.1:3001/api/health` | Returned `200` through the Next proxy |
| `POST http://127.0.0.1:3001/api/auth/register` | Returned `201` and set `dukaspot_session` |
| `GET http://127.0.0.1:3001/api/auth/me` with cookie | Returned `200` |
| `GET http://127.0.0.1:3001/api/ledger` with cookie and tenant header | Returned `200` |
| `GET http://127.0.0.1:3001/api/accounting/trial-balance` with cookie and tenant header | Returned `200` and `balanced: true` |

## E. Security And Correctness Considerations

Improved:

- The browser no longer assumes ledger routes are public.
- Session cookies are sent with same-origin API requests.
- Merchant tenant headers are consistently sent for tenant-scoped reads, exports, and mutations.
- Mutating frontend requests generate `Idempotency-Key` headers.
- UI controls reflect server-provided permissions.

Still missing:

- CSRF protection for cookie-authenticated mutations.
- First-class password reset and email verification flows.
- User/member management screens.
- Browser-level automated UI tests.
- Full replacement of the older Vite-era dashboard surface.
- Frontend row-level audit actor display.

## F. Remaining Blockers

- File-mode local development still shares one compatibility ledger across tenants; PostgreSQL remains the production tenancy path.
- The authenticated frontend is operational but not yet visually exhaustive compared with the older Vite pilot dashboard.
- Permission gating improves UX but does not replace backend authorization.
- Full `docker compose up` for all services was not run in this phase.

## G. Next Phase

Proceed to Phase 6: production hardening. The next work should add CSRF protection, rate limiting, browser UI tests, structured frontend error telemetry, password reset/email verification, and a production staging smoke path.
