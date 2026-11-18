# Phase 0 acceptance report

**Date:** 17 November 2026
**Scope:** Pluck Agro ERP — Phase 0 Technical Foundation
**Repository:** `pluck-agro-erp/`

---

## 1. Executive summary

Phase 0 delivers a working, tested technical foundation: a Next.js 16 / TypeScript application
with Supabase authentication, role-based authorization enforced in both application services and
PostgreSQL RLS, an append-only audit trail, and a professional administration console for
employees, departments, users, roles, permissions and settings.

Operational and financial modules are **not implemented** and are labelled as such in the UI.
No business workflow, threshold, formula or financial figure was invented.

## 2. Repository assessment (starting state)

The workspace was empty. `create-next-app` produced a bare App Router skeleton
(`app/page.tsx`, `app/layout.tsx`, `app/globals.css`, default `next.config.ts`,
`eslint.config.mjs`, `tsconfig.json`). That scaffold was preserved and extended; nothing was
deleted for cosmetic reasons. Legacy PHP/MySQL source was **not** present in the workspace, so no
legacy code was inspected or migrated.

## 3. Architecture delivered

- Modular monolith: `app/` (routes), `components/`, `services/` (server-only use cases),
  `lib/` (env, Supabase clients, permissions, validation, errors), `supabase/migrations`.
- Three Supabase client patterns with a `server-only` guard on privileged code.
- Next.js 16 `proxy.ts` for session refresh + coarse route gating; fine-grained authorization in
  layouts, pages and Server Actions; RLS as the final authority.
- Typed action results (`ActionResult`) and centralized error mapping; no raw SQL errors leak.

## 4. Database implementation

14 versioned migrations; 10 tables (`departments`, `employees`, `profiles`, `roles`,
`permissions`, `role_permissions`, `user_roles`, `approval_limits`, `audit_logs`,
`system_settings`); UUID keys; 10+ foreign keys; ~20 check constraints; unique and partial-unique
indexes; `updated_at` triggers; append-only audit trigger; 6 security helper functions; RLS with
~25 policies; 16 roles, 44 permissions, 249 grants seeded idempotently and generated from the
TypeScript catalogue.

## 5. Authentication and authorization

Login, logout, forgot-password and reset-password implemented with Supabase Auth. Identity
resolution requires an active profile (and active employee where linked) in addition to a valid
session — a session alone is never sufficient. Permissions resolve from active, non-expired role
assignments. Self-elevation, self-deactivation, permission tampering and audit tampering are
blocked in code, policy and trigger.

## 6. UI/UX

App shell with permission-aware sidebar (collapsible, mobile drawer), sticky header, user menu,
toasts; design tokens for a forest-green enterprise theme; components for tables, dialogs, forms,
badges, alerts, skeletons, empty/error states; pages: login, forgot/reset password, dashboard,
profile, administration (overview, employees, departments, users, user detail, roles,
permissions), audit logs, settings, and honest placeholders for 15 planned module routes.

## 7. Audit and governance

Audited events: `auth.login_succeeded`, `auth.login_failed`, `employee.created`,
`employee.updated`, `user.role_assigned`, `user.role_revoked`, `user.activated`,
`user.deactivated`, `system.admin_bootstrapped`. Audit writes occur only through a server-only
service after authorization; the table has no write grants for application roles and a trigger
rejects updates/deletes. No secrets, tokens or passwords are recorded.

## 8. Verification results

All commands below were executed in this workspace on 17 November 2026.

| Check | Result | Evidence |
|---|---|---|
| `npm install` | PASS | 461 packages, 0 vulnerabilities |
| `npm run lint` | PASS | 0 errors, 1 documented warning (React Compiler skips TanStack `useReactTable`) |
| `npm run typecheck` | PASS | `tsc --noEmit`, strict + `noUncheckedIndexedAccess`, 0 errors |
| `npm run test` (unit) | PASS | 44 tests, 5 files |
| `npm run test:db` (migrations + RLS) | PASS | 28 tests, 2 files |
| `npm run test:e2e` | PASS | 18 tests (Chromium desktop + Pixel 7) |
| `npm run build` | PASS | Production build, 31 routes, proxy compiled |
| Migration run against clean DB | PASS | All 14 migrations applied in `tests/helpers/pglite.ts` |
| Service-role key absent from build output | PASS | Recursive grep of `.next` for key material → no matches |
| Unauthenticated route protection | PASS | `/dashboard`, `/administration/users`, `/audit-logs` → `307 /login?next=…` |
| Health endpoint | PASS | 503 + `degraded` when unconfigured; JSON schema verified in e2e |

## 9. Security findings

Addressed: server-side authorization on every route and action, RLS on all 10 tables,
`anon` grants revoked, service-role key never bundled, append-only audit, self-elevation blocked,
Zod validation at all input boundaries, security headers (`X-Frame-Options`, `nosniff`,
Referrer-Policy, Permissions-Policy), generic auth error messages, hashed passwords delegated to
Supabase Auth.

Requires operator action / later phase:

1. **No live Supabase project** was used: Supabase Auth integration and hosted-PostgREST policy
   behaviour are unverified end-to-end (see Outstanding issues).
2. `NEXT_PUBLIC_*` values are build-time inlined — set them in the Vercel build environment.
3. Sign-in rate limiting is in-process; move to a shared store before multi-instance scaling.
4. MFA for privileged accounts is specified in the PRD but not enabled.
5. No CSP header yet; add one before exposing the app publicly.
6. GitHub secret scanning / branch protection were not configured (no remote repository).

## 10. Outstanding issues

| # | Item | Status |
|---|---|---|
| 1 | Apply migrations to a real Supabase project and run the smoke tests | BLOCKED (free-project limit reached — 2 active projects) |
| 2 | Authenticated Playwright journeys (sign-in, role assignment, RLS-by-UI) | NOT IMPLEMENTED (needs live project + seeded users) |
| 3 | `types/database.types.ts` generated by CLI | PARTIAL — hand-authored mirror; regenerate with `npm run db:types` |
| 4 | Department create/edit UI | NOT IMPLEMENTED (Phase 1) |
| 5 | Role → permission grant editing UI | NOT IMPLEMENTED (Phase 1) |
| 6 | MFA, CSP, shared rate limiter | NOT IMPLEMENTED (hardening) |
| 7 | Legacy data migration assessment | BLOCKED (legacy dump not supplied to this workspace) |

## 11. Acceptance checklist

| Requirement | Status |
|---|---|
| Repository architecture established | VERIFIED IMPLEMENTED |
| Application starts successfully | VERIFIED IMPLEMENTED |
| Supabase integration (clients, SSR cookies, service-role isolation) | IMPLEMENTED BUT NOT VERIFIED (no hosted project) |
| Database migrations execute successfully | VERIFIED IMPLEMENTED (PGlite, real PostgreSQL 17) |
| Foundational tables and relationships | VERIFIED IMPLEMENTED |
| Authentication works (login/logout/recovery) | IMPLEMENTED BUT NOT VERIFIED (requires hosted auth) |
| Profile resolution | IMPLEMENTED BUT NOT VERIFIED (unit/DB logic verified, HTTP flow not) |
| Inactive-account protection | VERIFIED IMPLEMENTED (RLS tests) |
| Role and permission management | PARTIALLY IMPLEMENTED (assign/revoke verified; role CRUD deferred) |
| Server-side permission checks | VERIFIED IMPLEMENTED |
| RLS enabled and tested | VERIFIED IMPLEMENTED |
| Administrative changes audited | VERIFIED IMPLEMENTED (code + DB trigger tests) |
| Service-role credentials protected | VERIFIED IMPLEMENTED (bundle scan) |
| Responsive ERP shell | VERIFIED IMPLEMENTED (desktop/mobile e2e) |
| Initial administration pages functional | IMPLEMENTED BUT NOT VERIFIED with live data |
| Automated tests pass | VERIFIED IMPLEMENTED (90 tests) |
| Production build succeeds | VERIFIED IMPLEMENTED |
| Technical documentation accurate | VERIFIED IMPLEMENTED |
| Final implementation report | VERIFIED IMPLEMENTED (this document) |

## 12. Next-phase recommendation

1. **Unblock the database:** create the Supabase project (pause or upgrade an inactive one),
   run `supabase db push`, regenerate types, bootstrap the first administrator and complete the
   smoke-test matrix in `docs/deployment.md`.
2. **Phase 1 — Master data and governance:** department/employee CRUD completion, role and
   permission administration screens, approval-limit configuration, legacy schema mapping and a
   validated migration plan (requires the production SQL dump).
3. **Do not start Phase 2 (procurement/inventory posting)** until Phase 1 master data and the
   opening-balance strategy are signed off by Finance.
