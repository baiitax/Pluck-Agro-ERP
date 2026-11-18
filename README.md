# Pluck Agro ERP

Integrated enterprise resource planning platform for **Pluck Agro Allied**.

This repository contains **Phase 0 — Technical Foundation** and **Phase 1 — Identity,
Organizational Management & Enterprise Governance**.

Phase 1 adds the central employee register, department/position hierarchy and organisation chart,
secure server-side account provisioning with a six-state lifecycle and session revocation,
configurable role-based access control (75 granular permissions, 16 role templates), approval
authority **configuration**, delegation, segregation-of-duties policy, an enhanced audit trail with
export, access reviews and a governance dashboard built from live database metrics.

> **Status honesty:** operational modules are **not implemented**. Their routes exist and are
> labelled "Planned / Not implemented" in the UI. No financial or operational KPI on any screen
> is sample data — the dashboard only shows values derived from live checks and your own
> account.

---

## What Phases 0 and 1 deliver

| Area | Delivered |
|---|---|
| Application | Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4 |
| Database | Supabase PostgreSQL migrations `0001`–`0029`: 19 tables, triggers, constraints, FKs, RLS, generated seeds |
| Authentication | Supabase Auth (email/password), session refresh via Next.js 16 `proxy.ts`, password recovery, application-level session revocation |
| Identity | Employment status (7 values) kept separate from account status (6 values); auth session **plus** active profile **plus** employee record |
| Authorization | 75 `module.resource.action` permissions, 16 configurable role templates, 325 grants, scopes, server-side checks + PostgreSQL RLS, self-elevation prevention |
| Organisation | Department hierarchy with cycle protection, positions, organisation chart, employee department history, emergency contacts, central `PA-EMP-######` numbering |
| Governance | Approval authority configuration, delegation (limit ceiling, expiry, revocation, no cycles), configurable segregation of duties (BLOCK/WARN/REQUIRE_OVERRIDE), access reviews, live governance dashboard |
| Audit | Append-only `audit_logs` with event id, category, severity, actor employee, old/new values, request id, payload redaction, detail view and CSV export |
| Administration | Employees, departments, positions, org chart, users & access, roles, permission matrix, governance, audit trail, settings |
| UI | Enterprise app shell (sidebar, header, responsive drawer), permission-aware navigation, design tokens, reusable components |
| Master data | Supplier, customer and product registers; units of measure with decimal-safe, effective-dated conversions; sites, warehouses and storage locations; currencies, exchange rates, payment terms, Incoterms and tax categories; configurable `PA-SUP`/`PA-CUS`/`PA-PRD`/`PA-WH` numbering; per-row change history |
| Data governance | Duplicate candidate detection with a human review workspace (no auto-merge), staged CSV import centre with idempotency, data-quality indicators computed from live rows, banking and credit data isolated behind their own permissions |
| Quality | 210 unit tests, 82 database/RLS tests, 106 end-to-end executions, lint + typecheck + build |

Reports: [`docs/phase-0-acceptance.md`](./docs/phase-0-acceptance.md) ·
[`docs/phase-1-acceptance.md`](./docs/phase-1-acceptance.md) ·
[`docs/phase-2-report.md`](./docs/phase-2-report.md) ·
design references [`docs/phase-1-governance.md`](./docs/phase-1-governance.md),
[`docs/master-data.md`](./docs/master-data.md).

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local      # fill in your Supabase project values

# 3. Apply database migrations
npx supabase link --project-ref <your-project-ref>
npx supabase db push

# 4. Provision the first administrator (no default credentials ship with the repo)
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run admin:bootstrap -- --email you@pluckagro.com --password 'ChangeMe-Str0ng!' --name "Managing Director"

# 5. Run
npm run dev                     # http://localhost:3000
```

Detailed setup, deployment and security notes: [`docs/`](./docs).

## Quality gates

```bash
npm run lint        # ESLint (Next.js core-web-vitals + TypeScript rules)
npm run typecheck   # tsc --noEmit, strict mode
npm test            # unit + database tests (Vitest)
npm run test:unit   # unit tests only
npm run test:database # migrations + RLS + governance tests against PGlite
npm run test:e2e    # Playwright (unauthenticated journeys)
npm run build       # production build
```

## Screenshots

| View | File |
|---|---|
| Sign-in (desktop) | `docs/screenshots/login-desktop.png` |
| Sign-in (mobile) | `docs/screenshots/login-mobile.png` |

Captured from the running application; the only view reachable without a configured Supabase
project (see the outstanding issues in `docs/phase-0-acceptance.md`).

## Repository map

```text
app/                 Next.js routes: (auth) and (dashboard) groups, api/health
components/          UI primitives, layout shell, tables, forms, feedback
config/              App config, navigation (permission-aware), permission re-exports
lib/                 env validation, Supabase clients, permissions catalogue, validation, errors
services/            Server-only use cases: auth, authorization, employees, users, audit, system
supabase/            Versioned SQL migrations (0001–0029) + local-only fixtures
tests/               unit/, database/ (PGlite), e2e/ (Playwright)
docs/                Architecture, schema, auth, authorization, design system, ops, acceptance
scripts/             Seed generator, DB type generation, admin bootstrap
```

## Architectural rules (non-negotiable)

1. The browser is untrusted. Permissions are re-checked on the server for every operation.
2. RLS is enabled on every exposed table; policies deny by default.
3. The service-role key is server-only and never imported into client code.
4. Business logic never lives in React components.
5. Posted business transactions will be immutable and corrected by reversal, not deletion.
6. No invented business rules, thresholds, formulas or sample financial figures.
7. Employment status, account status, position, permissions and approval authority stay separate
   facts. Holding an `approve` permission is never treated as authority to approve a value.
8. Approval limits and segregation-of-duties rules ship empty: policy is entered by management, never
   guessed by the system.
