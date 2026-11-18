# Phase 1 — Identity, Organizational Management & Enterprise Governance

Technical reference for the identity, organisation, access-control, authority, delegation,
segregation-of-duties, audit and access-review capabilities delivered in Phase 1.

Companion documents: [`phase-1-acceptance.md`](./phase-1-acceptance.md) (verification report with
per-requirement status), [`authorization.md`](./authorization.md) (Phase 0 RBAC primer),
[`database-schema.md`](./database-schema.md).

---

## 1. The five separate concepts

Phase 1 deliberately refuses to collapse identity into a single "role" field. Every access
decision is assembled from five independent records:

| Concept | Table | Answers |
|---|---|---|
| Employment | `employees` | Is this person employed, and in what capacity? |
| Position | `employee_positions` | What job, in which department, reporting to whom? |
| Account | `auth.users` + `profiles` | Can this person authenticate, and in what account state? |
| Permission | `role_permissions` → `permissions` | What is this person technically allowed to do? |
| Authority | `approval_authorities` | Up to what value may this person approve? |

Holding `procurement.purchase_order.approve` is **not** authority to approve ₦5m. Authority is a
separate, dated, value-bounded record. Phase 1 configures authority; it does not execute approval
workflows.

Employment status (7 values) and account status (6 values) are separate columns on separate
tables. An employee can be `suspended` while their account is `locked`, or `retired` while their
account is `deactivated` — the UI shows both, and the sign-in gate checks both.

## 2. Account lifecycle

```
invited ──▶ pending_setup ──▶ active ──▶ suspended ──▶ active
   │              │              │            │
   │              │              ├──▶ locked ─┘
   └──────────────┴──▶ deactivated ──▶ active (reactivation only)
```

- Transitions are validated in PostgreSQL (`private.validate_account_status_transition()`), so a
  direct SQL update cannot bypass the lifecycle either.
- `profiles.is_active` is **derived** from `account_status` by `private.sync_account_status()`.
  Application code must never write `is_active` directly; the trigger overwrites it.
- Every transition writes an `account_activity` row (human-readable history, shown on the account
  detail page) and an `audit_logs` row (governance record). Password material is never recorded.
- Permission per transition: `invited`/`pending_setup` → `access.accounts.invite`,
  `active` → `access.accounts.activate`, `suspended`/`locked` → `access.accounts.suspend`,
  `deactivated` → `access.accounts.deactivate`.
- A user can never change their own status (`services/accounts/manage-account.ts`).

## 3. Provisioning

`provisionAccount()` (`services/accounts/manage-account.ts`):

1. Requires `access.accounts.invite`.
2. Requires a central employee record; one *active* account per employee (partial unique index
   `profiles_employee_unique_active_idx`).
3. Requires at least one role, and refuses to grant a role whose permission set is not a subset of
   the actor's own — except for `super_administrator`.
4. Sends a Supabase invitation (no password is generated, stored, logged or returned anywhere).
5. Creates `profiles` with `account_status = 'invited'`, writes `account_activity`, writes audit at
   `notice` severity.

If any later step fails, the created auth user is deleted so a retry does not leave an orphan
identity. The compensating delete is logged; a failed compensation surfaces as an error rather
than a silent half-provisioned account.

`resendInvitation()` re-issues the invitation and bumps an invitation counter; stale invitations
(> 7 days, never accepted) are surfaced as a governance alert.

## 4. Session revocation

Supabase Auth (the SDK version pinned in this repository) exposes no "revoke all sessions for this
user" admin endpoint. Rather than pretend, the ERP keeps its own revocation stamp
(`0029_account_session_revocation.sql`):

- `profiles.sessions_valid_after` — a session whose `last_sign_in_at` predates this instant is
  rejected.
- `profiles.sessions_revoked_at` / `sessions_revoked_by` — who revoked, when.
- `resolveCurrentPrincipal()` enforces the stamp on **every** request and returns the reason
  `sessions_revoked`, which the UI renders as a plain-language sign-in error.
- `private.guard_profile_privileged_columns()` restores the stamp on any self-service update, so a
  user cannot clear their own revocation.

Suspending or deactivating an account also blocks it immediately, because the sign-in gate checks
account status before anything else.

## 5. RBAC

- **Permission codes** are `module.resource.action` (3 segments). 20 actions, 7 scopes
  (`GLOBAL`, `DEPARTMENT`, `LOCATION`, `WAREHOUSE`, `ENTITY`, `SELF`, `TEAM`).
- **75 permissions** and **16 role templates** are generated from
  `lib/permissions/definitions.ts` into migrations `0025`–`0027` by
  `scripts/generate-seed-sql.mjs`. Those three files are generated artefacts — never hand-edited.
- **325 grants** across the 16 templates. `super_administrator` holds all 75 and is provably the
  only role that does. `auditor` only holds permissions ending in `.view`.
- Roles are fully configurable: create, rename, re-describe, change category, clone, deactivate,
  delete. System roles (`is_system = true`) may not be renamed or deleted
  (`private.protect_system_role()`), and a role with active assignments may not be deleted
  (`private.protect_assigned_role()`).
- The permission matrix (`/administration/permissions`) shows every code grouped by
  module → resource with the roles that hold it; `/administration/roles/[id]` edits grants per role
  with scope selection.

### Scoped grants

`role_permissions.scope_type` stores the scope, and `private.has_scoped_permission(code, dept)`
checks department-scoped grants. `private.has_permission(code)` is deliberately **GLOBAL-only**, so
a scoped grant can never silently satisfy a global check. Phase 1 stores scopes; department-scoped
enforcement becomes load-bearing when Phase 2 objects (purchase orders, stock) exist.

## 6. Self-elevation and privilege protection

All of the following are blocked server-side, audited, and covered by tests:

- No user may change their own account status.
- No user may assign or revoke a role on their own account.
- No user may edit the permission set of a role they themselves hold (super administrator excepted).
- No user may grant a permission or role they do not hold themselves.
- The last active `super_administrator` cannot be suspended or deactivated.
- Users without `access.assignments.manage` cannot write `employee_id`, `account_status`,
  `is_active` or the session-revocation columns on their own profile (RLS-guarded columns).

## 7. Approval authority

`approval_authorities` (configurable, dated, value-bounded):

- Principal is **either** an employee **or** a role — never both (`num_nonnulls = 1`).
- `module` + `transaction_type` + `currency_code` + `minimum_amount` + `maximum_amount` +
  `authority_level` + scope + validity window.
- **No limits are seeded.** `approval_authorities` ships empty by design; Pluck Agro management
  must enter each limit. The UI shows an explicit empty state saying so.
- Amounts are validated (`maximum ≥ minimum ≥ 0`, `effective_until ≥ effective_from`) in Zod and in
  PostgreSQL.
- Phase 1 provides configuration and validation only: no approval workflow consumes these rows yet,
  and nothing in the UI claims otherwise.

## 8. Delegation

`approval_delegations` transfers a bounded slice of authority for a fixed window. It never
transfers permissions or administrative access.

Enforced by `private.validate_delegation_limit()` plus `services/governance/delegations.ts`:

1. Delegator ≠ delegate.
2. `delegated_limit > 0`.
3. `effective_until ≥ effective_from`.
4. The delegator must hold an **active** authority for the same module/transaction type; otherwise
   "nothing can be delegated".
5. `delegated_limit` may not exceed the delegator's own maximum for that module/transaction.
6. No cycles in the delegation graph (`private.prevent_delegation_cycle()` walks the chain).
7. Delegations start `pending_approval`; they only become live on approval, and only while inside
   their window. Expiry is derived, never written by a cron job.
8. Revocation requires a reason and is recorded with who/when.

`lib/governance/delegation.ts` exposes the same rules as pure functions, unit-tested without a
database, so the UI can pre-validate the same constraints.

## 9. Segregation of duties

`segregation_of_duties_rules` + `sod_overrides`:

- Rules are **configurable policy**, not hard-coded company policy. The table ships **empty**: no
  conflict is asserted as Pluck Agro policy until management approves it.
- A rule names `module`, `transaction_type`, `first_action`, `conflicting_action` and an enforcement
  level: `BLOCK`, `WARN` or `REQUIRE_OVERRIDE`.
- `lib/governance/sod.ts` evaluates a set of held actions against active rules and returns
  `allow` / `warn` / `require_override` / `block`. `REQUIRE_OVERRIDE` becomes a block unless a live
  `sod_overrides` row exists for that employee and rule (justification ≥ 10 characters, optional
  expiry); an override downgrades the decision to a warning and is audited at `critical` severity.
- Phase 1 wires evaluation into the governance screens (previewing a role's action set) and the
  service layer. It is not yet wired into transaction workflows, because those workflows do not
  exist.

## 10. Audit trail

`audit_logs` Phase 1 shape: `event_id` (unique, generated), `event_category`, `severity`
(`info` | `notice` | `warning` | `critical`), `actor_user_id`, `actor_employee_id`, `module`,
`action`, `entity_type`, `entity_id`, `description`, `old_values`, `new_values`, `metadata`,
`request_id`, `ip_address`, `user_agent`, `created_at`.

- Append-only: triggers reject `UPDATE` and `DELETE`.
- Written only by server-side trusted code through `recordAuditEvent()`; a failed write **throws**
  (fail-closed) rather than silently dropping the record.
- `redactPayload()` (application) and `private.redact_audit_payload()` (database) replace values
  under keys matching `password|token|secret|credential|authorization|api_key|service_role|salt|hash`
  with `«redacted»`. Passwords and tokens are never accepted as input in the first place.
- `/audit-logs` filters by module, category, severity, actor, request id, entity, date range and
  free text; `/audit-logs/[id]` renders old/new values side by side with redacted fields called out.
- `/api/audit-logs/export` streams CSV (columns: `event_id, created_at, severity, event_category,
  module, action, actor_user_id, actor_employee_id, entity_type, entity_id, description,
  request_id, ip_address`), capped at 5 000 rows, requires `governance.audit.export`, prefixes
  spreadsheet-formula cells with `'`, and names the file `pluck-agro-audit-YYYY-MM-DD.csv`.

## 11. Access reviews

`access_review_records`: one row per (review period, user), period format `YYYY-Qn` (or `YYYY-MM`).

- The page shows the current period's coverage, unreviewed accounts, and prior decisions.
- Recording a `revoke` decision **does not** change access. The reviewer must then perform the
  revocation through the account or role screens; the review record is evidence, not enforcement.
  This is stated on the page itself so nobody assumes otherwise.

## 12. Governance dashboard

`/governance` renders metrics computed from the database on every request
(`services/governance/get-governance-metrics.ts`): workforce totals and gaps, account counts by
status, never-signed-in and stale-invitation counts, role/permission counts, expiring assignments,
authority and delegation counts (live, pending, expiring), SOD rule/override counts, review
coverage for the current period, audit volume by category and severity, plus alert cards for
concrete anomalies (accounts without roles, employees without departments, expiring delegations,
critical events). Nothing is estimated or seeded; where a metric needs Phase 2 data it is simply
absent.

## 13. Organization structure

- `departments`: self-referencing hierarchy with a cycle guard
  (`Department hierarchy cannot contain a cycle`), cost-centre format validation, and a
  deactivation guard that refuses while active employees or active sub-departments remain.
- `employee_positions`: the job catalogue (title, code, department, grade, reports-to).
- `employees` gained Phase 1 fields: `employee_number` (central `PA-EMP-######` allocation via
  `next_employee_number()`), middle name, employment type/status, category, work location,
  supervisor, `date_joined`, `employment_end_date`, notes.
- `employee_department_history`: written automatically by
  `private.record_employee_org_change()` whenever department, position or supervisor changes; one
  open interval per employee (partial unique index).
- `employee_emergency_contacts`: name, relationship, phone, email, priority, primary flag.
- `/administration/org-chart` renders the department tree with heads and headcounts;
  `/administration/employees/[id]` has seven tabs (Overview, Employment, Organization, Account,
  Emergency contacts, Authority, History).

## 14. Permission-aware navigation

`config/navigation.config.ts` declares every entry with the permission that reveals it. Phase 1
sections:

- **Administration:** Employees, Departments, Positions, Org chart, Users & access, Roles,
  Permission matrix.
- **Governance:** Governance dashboard, Approval authorities, Delegations, Segregation of duties,
  Access reviews, Audit trail.

Every operational module entry remains present but marked `planned`, and its page states
"Planned / not implemented" — no screen fakes a capability.

## 15. Local operation

```bash
npm run lint && npm run typecheck && npm test        # unit + database
npm run test:e2e                                     # unauthenticated journeys
npm run build
node scripts/generate-seed-sql.mjs                   # regenerate 0025–0027 after editing the catalogue
```

Migrations `0001`–`0029` apply cleanly to a fresh database; `0025`–`0027` are idempotent and may be
re-applied. `0012`–`0014` are superseded Phase 0 seeds and must not be re-run.
