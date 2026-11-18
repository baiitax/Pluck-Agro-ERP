# Testing

## 1. Strategy

| Layer | Tool | Scope | Location |
|---|---|---|---|
| Unit | Vitest | env validation, permission catalogue + seed parity, Zod schemas, governance logic (account transitions, SOD evaluation, delegation rules, authority limits, review periods), organisation tree, rate limiter, formatting | `tests/unit` |
| Database / RLS | Vitest + PGlite (real PostgreSQL in WASM) | migrations, constraints, triggers, policies, privilege escalation, Phase 1 governance invariants, master-data lifecycles, conversions, sensitive-table isolation, import idempotency, quality indicators | `tests/database` |
| End-to-end | Playwright (Chromium desktop + Pixel 7) | unauthenticated journeys, redirects, responsive login, health endpoint, Phase 1 and Phase 2 route protection, no leakage of banking/credit data to anonymous visitors | `tests/e2e` |

Why PGlite: it runs the **real migration SQL** against PostgreSQL semantics (RLS, policies,
triggers, `SECURITY DEFINER`) without Docker or a hosted project, so database security is
verified on every run rather than assumed.

## 2. Commands

```bash
npm test              # both Vitest projects (unit + database) — 292 tests
npm run test:unit     # unit only — 210 tests
npm run test:database # migrations + RLS + governance + master data — 82 tests
npm run test:e2e      # playwright (builds nothing; starts `npm run start` on :3200) — 106 executions
```

`npm run test:e2e` requires a prior `npm run build` and Playwright browsers
(`npx playwright install chromium`).

## 3. What the database tests prove

- All 41 migrations (`0001`–`0041`) apply cleanly to an empty PostgreSQL database (59 public
  tables, 139 permissions, 16 roles, 617 grants).
- Every application table has RLS enabled; expected foreign keys exist.
- Seeds are idempotent and produce exactly 16 roles / 75 permissions / 325 role grants; the
  generated seed files match the TypeScript catalogue exactly (asserted by a unit test).
- Constraint enforcement: duplicate employee number, invalid employment status, invalid
  approval-limit holder/range, expiry-before-assignment.
- Audit rows cannot be updated or deleted — not even by a super administrator, and not by
  application users at all.
- `anon` cannot read employees or audit logs.
- An inactive profile gets zero rows everywhere, including with a privileged role.
- An expired role assignment grants nothing beyond the caller's own employee row.
- Users with `employees.view` see the register; users without it see only their own row.
- Self-assignment of roles, self-deactivation, permission tampering and settings tampering are
  all rejected by policy or trigger.
- A super administrator can assign roles to another user but not to themselves.

### Phase 1 governance invariants (`tests/database/phase1-governance.test.ts`)

Department cycles and deactivation guards; department-change history capture; central employee
numbering; legal and illegal account-status transitions; one active profile per employee; system
role protection; 3-segment permission codes; auditor view-only grants; only `super_administrator`
holds every permission; authority principal exclusivity; delegation authority requirement, limit
ceiling, cycle rejection and pending default; empty SOD seed with duplicate-action rejection and
override justification length; audit `event_id` uniqueness and severity values;
`private.redact_audit_payload`; audit write denial; access-review period format and uniqueness;
session-revocation stamp protection; RLS on every Phase 1 table.

## 4. Honest gaps (see `docs/phase-1-acceptance.md`)

- No live-Supabase integration test suite in this environment (no project slot available), so
  Supabase Auth itself and PostgREST-level policy behaviour are **verified by design and by
  database tests, not end-to-end against a hosted project**.
- Authenticated Playwright journeys (sign in, provisioning, role administration, governance
  screens, audit export) require a configured project and seeded test users; Phase 1 specs currently
  assert that every new route fails closed without a session.
- No component-level rendering tests (React Testing Library was intentionally not added to keep
  the dependency surface small; UI behaviour is covered by Playwright).

## 4. What the Phase 2 database tests prove

- Master-data business references are assigned by trigger, sequentially, from the configured prefix.
- A declared status transition succeeds; an undeclared one is rejected by name.
- A reason is required for destructive transitions, and a reason left over from an earlier change
  is not accepted as evidence for a new one.
- Every status change lands in `master_data_change_history`.
- A cross-category conversion is refused unless it names a product, and duplicate conversion rules
  for the same pair and start date are refused.
- Conversion factors are stored as `NUMERIC`, not floating point.
- A product's base unit can be changed while it is a draft and is refused afterwards.
- Banking rows are invisible to a user without `master_data.supplier_banking.view` and visible to
  one with it; credit profiles are invisible to an `auditor`.
- The same import batch cannot be inserted twice, and rejected rows stay attached to their job.
- The quality view is `security_invoker`, and an indicator moves by exactly one when a real gap is
  introduced and back when it is filled.

