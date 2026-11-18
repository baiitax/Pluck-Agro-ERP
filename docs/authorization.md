# Authorization

## 1. Model

RBAC with data-driven roles and a fixed permission catalogue in `module.action` form.
75 permissions across dashboard, administration, governance and every planned business module.
16 system role templates ship as seeds; administrators may add roles later without schema
changes.

Permission evaluation resolves the **union** of permissions from all active, non-expired role
assignments of an active profile.

## 2. Catalogue

`lib/permissions/definitions.ts` is the application source of truth. It also documents the role
templates, for example:

| Role | Notable permissions |
|---|---|
| `super_administrator` | everything (only role with full access; enforced by a unit test) |
| `system_administrator` | users, roles, settings, audit — **no** business approvals, no `finance.post` |
| `managing_director` | view-all + procurement/production/sales/dispatch/expense approvals |
| `finance_manager` | `finance.post`, `treasury.manage`, `expenses.approve` |
| `auditor` | every `*.view` permission only |

Seed SQL is generated from this file, and `tests/unit/permissions.test.ts` fails if the
database seed and the catalogue disagree.

## 3. Three enforcement layers

1. **Navigation** — `AppShell` hides items the principal cannot use. Cosmetic only.
2. **Application** — `requirePermission(code)` in every page and every Server Action. Pages
   return a `PermissionGuard` state; actions throw `FORBIDDEN` and map to a safe message.
3. **Database** — RLS policies call `private.has_permission(...)`. Even a hand-crafted
   PostgREST request with a valid JWT cannot read or write rows the policy denies.

Layer 1 is never trusted. Layer 2 is never the only defence. Layer 3 is the final authority.

## 4. Anti-escalation controls

| Attack | Control |
|---|---|
| Self-assign a role | App check, RLS `with check (user_id <> auth.uid())`, and a BEFORE trigger |
| Revoke your own last role | Blocked in `revokeRole` (must ask another administrator) |
| Deactivate your own account | Blocked in `setAccountActive` |
| Edit `is_active`/`employee_id` on your own profile | `guard_profile_privileged_columns` trigger |
| Edit permission definitions | `roles.manage` required; verified allowed/denied in RLS tests |
| Tamper with audit history | No grants + append-only trigger; verified denied even for super admin |

## 5. Authorization decision record

| Rule | App service | Database policy | Test |
|---|---|---|---|
| Only `employees.view` sees the register | `requirePermission` in page | `employees_select` | `rls.test.ts` |
| Only `users.manage` changes roles | `manage-access.ts` | `user_roles_*` | `rls.test.ts` |
| Audit readable only with `audit.view` | `getAuditEvents` page guard | `audit_logs_select` | `rls.test.ts` |
| Audit never writable by app users | server-only service | no grants + trigger | `rls.test.ts` |
| Inactive profile sees nothing | `resolveCurrentPrincipal` | `is_active_profile()` in every policy | `rls.test.ts` |
| Settings hidden unless `settings.view` | page guard | `system_settings_select` | `rls.test.ts` |

## 6. Approvals and scopes (future)

`approval_limits` provides the value-based authority model (user or role, module,
transaction type, currency, min/max). Phase 0 does not implement routing, thresholds or
escalation; those arrive with the workflow engine and will be enforced transactionally.
Department/location scoping is also deferred to that phase.
