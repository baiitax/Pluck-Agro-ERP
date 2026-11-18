# Phase 1 acceptance report — Identity, Organizational Management & Enterprise Governance

**Date:** 17 November 2026
**Scope:** Pluck Agro ERP — Phase 1 (specification dated 17 November 2026, 23 sections, Parts A–M)
**Repository:** `pluck-agro-erp/`
**Baseline:** Phase 0 verified codebase (90 tests: 44 unit, 28 database, 18 end-to-end)

Status vocabulary used throughout:

| Status | Meaning |
|---|---|
| **VERIFIED IMPLEMENTED** | Code exists, is reachable, and was exercised by an automated check that passed in this workspace. |
| **IMPLEMENTED BUT NOT VERIFIED** | Code exists and compiles, but exercising it needs a live Supabase project, which could not be created (see §18). |
| **PARTIALLY IMPLEMENTED** | Deliberately bounded subset of the requirement, with the missing part named. |
| **NOT IMPLEMENTED** | Absent, by scope decision or because it belongs to a later phase. |
| **BLOCKED** | Cannot be completed in this environment for an environmental reason. |

---

## 1. Executive summary

Phase 1 delivers identity, organisational management and enterprise governance on top of the
Phase 0 foundation: a central employee record with central numbering, a department hierarchy with
positions and an organisation chart, secure server-side account provisioning with a six-state
lifecycle and application-level session revocation, a fully configurable role/permission model with
granular `module.resource.action` codes (75 permissions, 16 role templates, 325 grants), approval
authority **configuration** (no limits invented), delegation with limit/expiry/cycle protection,
configurable segregation-of-duties with BLOCK/WARN/REQUIRE_OVERRIDE, an enhanced audit trail with
detail view, redaction and CSV export, access reviews, and a governance dashboard computed from
live database rows.

Nothing was collapsed: employment status, account status, position, permissions and approval
authority remain five separate facts about a person. No approval limit, department, hierarchy or
SOD rule was invented — the authority and SOD tables ship empty with explicit empty states, because
Pluck Agro management has not yet approved those policies in writing.

Verification: **151 automated tests pass** (90 unit, 61 database), **52 end-to-end checks pass**,
lint has 0 errors (1 pre-existing React-Compiler advisory), `tsc --noEmit` is clean, and the
production build succeeds with **44 routes**. All 29 migrations (including the 9 new Phase 1
tables) apply from empty and were exercised against PGlite.

Everything that requires an authenticated session against a real Supabase project is
**implemented but not verified**: the project cap on the Supabase organisation blocked creating a
project, per the standing instruction not to pause or delete any existing project.

## 2. Scope delivered against the specification

| Specification area | Status | Where |
|---|---|---|
| Central employee register, numbering, directory, detail, 7 tabs, history, emergency contacts | VERIFIED IMPLEMENTED (schema + routes) / IMPLEMENTED BUT NOT VERIFIED (live data) | §5 |
| Department hierarchy, positions, org chart | same | §6 |
| Employee status vs account status separation | VERIFIED IMPLEMENTED | §3 |
| Server-side account provisioning, six lifecycle states, session revocation | IMPLEMENTED BUT NOT VERIFIED (needs live Auth) | §7, §8 |
| RBAC: configurable roles, granular permissions, matrix, multi-role, scopes, self-elevation prevention | VERIFIED IMPLEMENTED (catalogue, seeds, guards) | §9, §10 |
| Approval authority configuration (no invented limits, no workflow execution) | VERIFIED IMPLEMENTED (DB invariants) / IMPLEMENTED BUT NOT VERIFIED (screens) | §11 |
| Delegation with subordinate limits, expiry, revocation, no cycles | VERIFIED IMPLEMENTED | §12 |
| Configurable SOD with BLOCK/WARN/REQUIRE_OVERRIDE | VERIFIED IMPLEMENTED (evaluation logic + DB) | §13 |
| Enhanced audit (event_id, category, actor employee, old/new, metadata, request_id, severity, redaction, detail, export) | VERIFIED IMPLEMENTED (schema, redaction) / IMPLEMENTED BUT NOT VERIFIED (UI, CSV) | §14 |
| Access reviews | IMPLEMENTED BUT NOT VERIFIED | §15 |
| Governance dashboard with real metrics and alerts | IMPLEMENTED BUT NOT VERIFIED | §16 |
| Permission-aware administration navigation | VERIFIED IMPLEMENTED (nav parity unit test) | §17 |
| RLS on every new table | VERIFIED IMPLEMENTED | §4 |
| Tests (unit, database, E2E, including unauthorised attempts) | VERIFIED IMPLEMENTED | §20 |
| Documentation and this report | VERIFIED IMPLEMENTED | — |

## 3. Identity model — five facts, never one field

`employees` (employment) → `employee_positions` (job) → `profiles`/`auth.users` (account) →
`role_permissions` (permissions) → `approval_authorities` (value authority).

- Employment status has 7 values (`active`, `probation`, `on_leave`, `suspended`, `resigned`,
  `terminated`, `retired`) and lives only on `employees`.
- Account status has 6 values (`invited`, `pending_setup`, `active`, `suspended`, `deactivated`,
  `locked`) and lives only on `profiles`.
- `profiles.is_active` is a derived mirror maintained by a trigger; application code never writes it.
- The sign-in gate (`resolveCurrentPrincipal`) checks, in order: session → profile → account status
  → session-revocation stamp → employment status. Each failure returns its own reason code, and the
  login screen renders a plain-language message rather than leaking which check failed in detail.

**Status: VERIFIED IMPLEMENTED** — the seven/six value sets, the transition table and the sign-in
reason codes are unit-tested; illegal transitions are rejected by a PostgreSQL trigger that is
database-tested.

## 4. Database implementation

- 29 migrations (`0001`–`0029`), 19 tables. Phase 1 added 9 tables: `employee_positions`,
  `employee_department_history`, `employee_emergency_contacts`, `account_activity`,
  `approval_authorities`, `approval_delegations`, `segregation_of_duties_rules`, `sod_overrides`,
  `access_review_records`; and extended `departments`, `employees`, `profiles`, `roles`,
  `role_permissions`, `permissions`, `audit_logs`.
- Phase 1 migrations: `0015` permission scheme v2, `0016` organisation structure, `0017` account
  lifecycle, `0018` role management, `0019` authorities, `0020` delegations, `0021` SOD, `0022`
  audit enhancements, `0023` access reviews, `0024` RLS policies, `0025`–`0027` generated seeds,
  `0028` grants, `0029` session revocation.
- Invariants enforced in SQL, not just in TypeScript: department cycles, department deactivation
  with active employees/sub-departments, illegal account transitions, one active profile per
  employee, system-role protection, assigned-role protection, delegation limits and cycles, SOD
  code format and distinct actions, audit append-only, audit payload redaction, access-review
  period format and uniqueness.
- RLS is enabled on every table in `public` (asserted dynamically by a test that enumerates
  `pg_class`), with Phase 1 policies in `0024` and grants in `0028`.
- `0025`–`0027` are idempotent and re-runnable; the superseded Phase 0 seeds `0012`–`0014` are not,
  and are documented as do-not-rerun.

**Status: VERIFIED IMPLEMENTED** — 61 database tests; the whole chain applies cleanly to an empty
PGlite instance, twice for the generated seeds.

## 5. Employee management

- Central register with `PA-EMP-######` numbering allocated by `public.next_employee_number()`;
  leaving `employeeNumber` blank allocates centrally. Duplicate numbers are rejected by a unique
  constraint, and blank numbers are rejected by validation.
- Directory (`/administration/employees`) with search, department/position/status filters, sorting
  and pagination.
- Create and edit forms capture name (incl. middle name), contact details, employment
  type/status/category, work location, department, position, supervisor, dates and notes.
- Detail page with seven tabs: Overview, Employment, Organization, Account, Emergency contacts,
  Authority, History. Tabs are permission-aware (`employees.history.view` gates History).
- Emergency contacts: add/remove with relationship, phone, email, priority, primary flag; audit
  written per change.
- Department/position/supervisor changes are captured automatically into
  `employee_department_history` by a trigger, so history cannot be lost by a forgotten application
  call.
- Deactivation is blocked while the employee still supervises others or holds an active account or
  approval authority; the reason is shown rather than silently failing.

**Status: IMPLEMENTED BUT NOT VERIFIED** for the screens (they require a live database); the
schema-level behaviours (numbering, history, one-open-interval, supervisor/self constraints) are
**VERIFIED IMPLEMENTED** by database tests.

## 6. Organizational management

- `departments`: hierarchy with `parent_department_id`, cost-centre codes, descriptions, head of
  department, activation state; create/edit/deactivate.
- Cycle prevention is a database trigger: *"Department hierarchy cannot contain a cycle"*.
- `employee_positions`: title, code, department, grade, reports-to, description; create/edit.
- `/administration/org-chart` renders the department tree with heads and live headcounts, and lists
  employees without a department so gaps are visible.
- `lib/organization/tree.ts` builds/flattens the tree defensively: cyclic or orphaned rows cannot
  hang the renderer (unit-tested).

**Status: VERIFIED IMPLEMENTED (tree logic, cycle guard) / IMPLEMENTED BUT NOT VERIFIED (screens).**

## 7. Account provisioning and lifecycle

`services/accounts/manage-account.ts`:

- `provisionAccount` — requires `access.accounts.invite`, a central employee record, no existing
  active account for that employee, and at least one role. The role set must be a subset of the
  actor's own permissions (super administrator excepted). Sent as a Supabase invitation; **no
  password is generated, stored, logged or returned**. Compensation deletes the auth user if a later
  step fails.
- `updateAccountStatus` — permission per target status, legal-transition check, no self-status
  change, last-active-super-administrator protection, `account_activity` row + audit row
  (`warning`/`critical` severity for suspension/deactivation).
- `resendInvitation`, `getAccountActivity`.
- Account screens: `/administration/users` (filters incl. status, stale invitations), detail with
  lifecycle actions, role assignments, activity timeline and session controls.

**Status: IMPLEMENTED BUT NOT VERIFIED** — invitations require the Supabase Auth admin API, which
cannot be exercised without a project. The permission gates, validators and compensation logic are
type-checked and unit-tested where pure.

## 8. Session revocation

`0029` adds `profiles.sessions_valid_after`, `sessions_revoked_at`, `sessions_revoked_by`. Any
session whose `last_sign_in_at` predates the stamp is rejected on every request, with reason
`sessions_revoked`. A user cannot clear their own stamp (guarded by
`private.guard_profile_privileged_columns`). Revocation requires `access.accounts.revoke`, is
audited at `critical` severity and appears in the account activity timeline.

The document is explicit about the limitation: the pinned Supabase SDK has no "sign out all
sessions" admin call, so enforcement is the ERP's own gate rather than a GoTrue-side deletion. That
is a real, working mechanism — not a simulated one — but its live behaviour cannot be demonstrated
without a project.

**Status: VERIFIED IMPLEMENTED (column, guard trigger, tests) / IMPLEMENTED BUT NOT VERIFIED (live
session rejection).**

## 9. RBAC

- 75 permissions with 3-segment codes, 20 actions, 7 scopes.
- 16 configurable role templates, 325 grants; `super_administrator` holds all 75 and is provably the
  only role that does; `auditor` holds only `.view` permissions; `system_administrator` holds no
  business approval permission (all asserted by unit tests).
- Role CRUD: create, rename, re-describe, change category, clone, deactivate, delete, with
  system-role and assigned-role protection.
- Permission matrix page shows each code grouped by module → resource with the roles holding it;
  the role detail page edits grants per permission with scope selection.
- Multiple roles per user (`user_roles`), each with optional `expires_at`; expiring assignments are
  counted on the governance dashboard.
- Scoped grants are stored (`role_permissions.scope_type`) and evaluated by
  `private.has_scoped_permission`. Global checks use `private.has_permission`, which ignores scoped
  rows, so a scoped grant can never leak into a global decision.

**Status: VERIFIED IMPLEMENTED** for the catalogue, seeds, parity and guards; screens are
**IMPLEMENTED BUT NOT VERIFIED**.

## 10. Self-elevation prevention

Blocked and audited: changing your own account status; assigning/revoking a role on your own
account; editing the permission set of a role you hold; granting a permission or role you do not
hold; suspending/deactivating the last active super administrator.

**Status: VERIFIED IMPLEMENTED** — the SQL-side guards are database-tested; the service-side
guards are type-checked and reviewed line by line.

## 11. Approval authority configuration

- `approval_authorities` supports an employee **or** a role principal (never both), module,
  transaction type, currency, min/max amount, authority level, scope (`GLOBAL`/`DEPARTMENT`/
  `LOCATION`/`WAREHOUSE`/`ENTITY`), validity window, justification, activation.
- Ships **empty**. The UI states that no limit exists until management enters one, and nothing
  suggests a default.
- No approval workflow reads these rows in Phase 1; the screens and docs say so.
- Validation: `0 ≤ minimum ≤ maximum`, `effective_until ≥ effective_from`, 3-letter currency,
  department scope requires a department.

**Status: VERIFIED IMPLEMENTED (constraints, tests) / IMPLEMENTED BUT NOT VERIFIED (screens).**

## 12. Delegation

Create, approve/reject, revoke; live/pending/expired/revoked states; delegator must hold active
authority for the same module/transaction; delegated limit may not exceed the delegator's own;
no cycles; window required; revocation requires a reason. Expiry is derived, not written.

**Status: VERIFIED IMPLEMENTED** — six database tests cover the authority requirement, the limit
ceiling, cycle rejection and the pending default; two unit tests cover the expiry derivation.

## 13. Segregation of duties

Rules are configurable, seeded **empty** (no company policy asserted), with `BLOCK`, `WARN`,
`REQUIRE_OVERRIDE`; overrides are recorded with justification (≥ 10 characters) and optional expiry;
`evaluateSod()` returns allow / warn / require_override / block and is unit-tested for: no conflict,
block, warn, inactive rules, live override downgrade, expired override, override for another
employee, and multi-rule precedence.

Not wired into transaction approvals, because no transaction workflows exist in Phase 1. The role
detail and governance screens provide a preview of the decision for a role's action set.

**Status: VERIFIED IMPLEMENTED (evaluation + DB) / PARTIALLY IMPLEMENTED (workflow integration is
Phase 2+ by design).**

## 14. Audit trail

Enhanced shape (event_id, category, severity, actor employee, old/new values, metadata, request_id,
IP, user agent), append-only triggers, trusted-writes-only, fail-closed writes, redaction in both
application and database, filtered list, detail view with side-by-side values, and CSV export with
formula-injection protection and a 5 000-row cap.

**Status: VERIFIED IMPLEMENTED (schema, redaction, immutability, export columns) / IMPLEMENTED BUT
NOT VERIFIED (CSV download and detail render in a live session).**

## 15. Access reviews

One record per period and user; current-period coverage, unreviewed accounts, decisions
(`retain`/`amend`/`revoke`) with notes. The page states plainly that recording a decision does not
change access.

**Status: IMPLEMENTED BUT NOT VERIFIED.**

## 16. Governance dashboard

`/governance` computes every figure from live rows: workforce totals and gaps, accounts by status,
never-signed-in accounts, stale invitations, role/permission counts, expiring assignments, authority
and delegation counts, SOD coverage, review coverage, audit volume by category/severity, plus
concrete alert cards. No metric is estimated, seeded or invented; metrics that would need Phase 2
data are simply absent.

**Status: IMPLEMENTED BUT NOT VERIFIED.**

## 17. UI and navigation

- Permission-aware navigation: 7 Administration entries and 6 Governance entries, every one gated by
  a permission that exists (unit-tested), with planned modules present but labelled as not
  implemented.
- New shared components: filter bar, metrics, status badges covering all 6 account and 7 employment
  statuses, empty states that explain *why* a screen is empty.
- Design system and responsive behaviour unchanged from Phase 0; the mobile drawer exposes the new
  sections.

**Status: VERIFIED IMPLEMENTED (nav parity, route gating) / IMPLEMENTED BUT NOT VERIFIED (screens).**

## 18. Verification evidence

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **0 errors, 1 warning** (pre-existing TanStack Table/React Compiler advisory, unchanged from Phase 0) |
| Types | `npm run typecheck` | **clean** |
| Unit tests | `npm test` (unit project) | **90 passed** (6 files) |
| Database tests | `npx vitest run --project database` | **61 passed** (3 files) |
| End-to-end | `npm run test:e2e` | **52 passed** (2 projects: desktop + Pixel 7) |
| Build | `npm run build` | **succeeded, 44 routes** |

Phase 1 test growth: unit 44 → 90, database 28 → 61, end-to-end 18 → 52. Total: 90 → 203
individual test executions.

Environment limitation (BLOCKED): the Supabase organisation is at its free-project cap (2 of 2). Per
the standing instruction, no existing project was paused or deleted, so migrations were verified
against PGlite (real PostgreSQL semantics in WASM, including triggers, policies, roles and
`auth.uid()` stubbing) instead of a hosted project. What this does **not** cover: PostgREST/PostgREST
row-filtering behaviour, Supabase Auth invitations, and GoTrue session issuance.

## 19. Security findings and residual risks

1. **No live environment testing.** Highest residual risk. RLS policies and service queries are
   verified against PGlite and by type, but not against a hosted Supabase instance.
2. **Session revocation is application-level.** Effective for every ERP request; a token is not
   invalidated at the auth server. Documented, not hidden.
3. **Scoped permissions are stored but not yet load-bearing** — no Phase 2 objects exist to scope
   against. `has_permission()` is GLOBAL-only to avoid false positives in the meantime.
4. **SOD is configuration + evaluation only**; it cannot block a transaction because there are no
   transactions yet.
5. **Empty policy tables are intentional.** An empty `approval_authorities` or
   `segregation_of_duties_rules` table means "policy not yet approved", and the UI says so; anyone
   reading a green governance dashboard should read those zeros that way.
6. **Delegation authority is not yet enforced at approval time** — there is no approval time.
7. **One pre-existing lint warning** remains in `components/tables/data-table.tsx`; it is an
   upstream React Compiler advisory, and suppressing it would hide information rather than fix it.

No passwords, tokens or session material are logged or stored anywhere in Phase 1 code (enforced by
redaction tests and by never accepting such fields).

## 20. Acceptance checklist and next steps

**Accepted:**

- [x] Employee register with central numbering, directory, detail, 7 tabs, history, emergency contacts
- [x] Department hierarchy with cycle protection, positions, org chart
- [x] Account provisioning and 6-state lifecycle, separated from employment status
- [x] Application-level session revocation
- [x] 75 `module.resource.action` permissions, 16 configurable roles, permission matrix, scopes
- [x] Self-elevation prevention across status, roles and permissions
- [x] Approval authority configuration with no invented limits
- [x] Delegation with limit ceiling, expiry, revocation and cycle prevention
- [x] Configurable SOD with BLOCK / WARN / REQUIRE_OVERRIDE and overrides
- [x] Enhanced audit with detail view, redaction and CSV export
- [x] Access reviews; governance dashboard with real metrics and alerts
- [x] Permission-aware Administration and Governance navigation
- [x] RLS on every new table; migrations 0001–0029 verified from empty
- [x] `lint`, `typecheck`, `test`, `test:e2e`, `build` all pass with no suppressed errors

**Outstanding (in priority order):**

1. Apply `0001`–`0029` to a Supabase project once a slot is available, then re-run the database
   suite against the hosted instance and walk the authenticated journeys (§2 items marked
   *implemented but not verified*).
2. Re-verify the CSV export and audit detail view with real rows.
3. Publish management-approved approval limits and SOD rules — data entry, not code.
4. Phase 2 (Master Data) **not started**, awaiting explicit approval.

**Recommendation:** provision the Supabase project and run the hosted verification pass before
Phase 2 begins, so the Phase 1 screens are demonstrated against real data rather than only
verified structurally.
