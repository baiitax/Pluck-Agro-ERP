# Live database migration — `pqpwdldqovjylomdnyft`

**Date:** 17 November 2026
**Target:** PostgreSQL 17.12, Supabase, `aws-1-eu-west-1.pooler.supabase.com:5432` (session-mode pooler)
**Source of truth:** `supabase/migrations/0001`–`0073` in this repository.

---

## 1. What was run

All 73 migration files were applied, in order, each inside its own transaction, using a small Node runner
(`pg` client over TLS). Each successful file was recorded in `supabase_migrations.schema_migrations`
(`version`, `name`, `inserted_at`), the same table the Supabase CLI uses, so a later `supabase db push` will
not attempt to re-apply them.

The target schema was **empty before this run** (0 tables in `public`); Supabase's own `auth`, `storage` and
extensions schemas were present and were not modified.

| Result | Value |
| --- | --- |
| Migration files applied | **73 / 73** (0001 → 0073), zero failures |
| Wall time | ~48 s total (≈0.6 s per file) |
| Tables in `public` | **121** |
| Views in `public` | **41** |
| Tables with RLS enabled | **121 / 121** (none left disabled) |
| Policies | **258** |
| Permissions / grants / roles | **217 / 887 / 16** |
| Inventory + production permission codes | 41 |

These match the locally verified figures exactly, so the deployed schema is the same schema the PGlite suite
has been testing.

## 2. Behaviour verified on the live instance

Nothing below is inferred from object counts. Each check ran against the live database and was rolled back
afterwards, so the production schema was exercised without leaving test data behind.

### 2.1 Operational smoke test — 12/12 passed

| Check | Result |
| --- | --- |
| Master data created (category, product, site, warehouses) | PASS |
| Opening balance posts; balance derives from the ledger | PASS — `PA-LOT-2026-000001` on hand 100 |
| Ledger is append-only | PASS — update refused: *"inventory_movements is append-only: post a compensating movement instead of updating…"* |
| Negative stock refused | PASS — *"Insufficient stock in lot: 100.000000 …"* |
| Availability = 100 − 30 held − 20 reserved | PASS — available 50 |
| Transfer dispatches **and receives** | PASS — destination lot created, 90 / 10 split, `received` |
| Declared inputs scale arithmetically | PASS — 50 planned × (2 per 1) = 100 required |
| Output creates a lot held pending inspection | PASS — on hand 40, available **0** |
| Close without a reason refused (no yield band declared) | PASS |
| Close records the observed yield | PASS — `closed`, 40.000 %, basis `same_unit` |
| `inventory_ledger_integrity` | PASS — every check returns 0 |
| Reporting views derive from posted rows | PASS — yield view issued 100 / output 40 / avg 40 %; stock view on hand 130 |

The transfer dispatch→receive step is the `0073` repair working on a real Postgres 17 instance, which is worth
noting because the defect it fixes silently blocked every transfer receipt.

### 2.2 Row-level security — 9/9 passed

Run as the real `authenticated` role with `request.jwt.claims` set, i.e. the way PostgREST calls the database,
not as the migration superuser.

| Check | Result |
| --- | --- |
| `anon` cannot read `inventory_lots` | PASS — 0 rows |
| A signed-in user with **no profile** sees nothing | PASS — 0 rows, `has_permission` false |
| Storekeeper sees stock, does not hold `production.batch.close` | PASS — 1 lot visible, permission split correct |
| Storekeeper cannot `UPDATE` a lot (lacks `inventory.stock.manage`) | PASS — update matched 0 rows, row untouched |
| Sales officer can read lots but not update them | PASS — 1 visible, 0 updated |
| No role can `DELETE` a ledger movement | PASS — 0 rows deleted, ledger intact |
| Finance officer cannot see inventory (no `inventory.stock.view`) | PASS — 0 rows |
| Reporting views inherit the caller's RLS (`security_invoker`) | PASS — finance 0 rows, storekeeper 1 row |
| `private` helper schema is not enumerable by `authenticated` | PASS |

This closes, for the inventory and production surfaces, the gap recorded as *"RLS for Phase 4 tables —
PARTIALLY VERIFIED (table-level tests only)"* in `docs/phase-4-report.md`. It is genuine policy evaluation
against the deployed database, not a simulation.

## 3. What this does **not** cover

1. **The application has not signed in.** The Next.js app needs `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Those are project API keys, available in
   the Supabase dashboard (Settings → API). This project (`pqpwdldqovjylomdnyft`) is not visible to the
   Supabase connector used here, so they could not be read automatically. `.env.local` still holds
   placeholders and sign-in will fail until they are supplied.
2. **No user exists yet.** `auth.users`, `profiles`, `employees` and `user_roles` are all empty (0 rows). The
   16 roles and 217 permissions are seeded, but nobody holds one. The first administrator must be created
   before anything can be done in the UI.
3. **No master data.** Products, sites, warehouses, customers, suppliers and units-of-measure reference rows
   are empty (units of measure are seeded by the migrations; products, sites and warehouses are not). Phase 2
   master data and Phase 4 opening balances are company data and were deliberately not invented.
4. **Only `authenticated`/`anon` were exercised over the pooler.** Realtime, Storage buckets and the REST
   layer were not tested.

## 4. Credential handling

The database password was supplied in conversation and used only in a temporary file under `/tmp` that is not
part of the workspace and not snapshotted. It was **not** written to `.env.local`, any migration, or any
committed file.

Because it has been transmitted in plain text in a chat, it should be **rotated** in the Supabase dashboard
(Settings → Database → Reset database password) once the setup work is finished.
