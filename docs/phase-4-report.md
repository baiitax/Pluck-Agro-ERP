# Phase 4 — Factory Operations & Inventory Control: implementation report

**Date:** 17 November 2026
**Scope delivered:** inventory ledger, lots, movements, restrictions, reservations, transfers, counts, adjustments, production configuration, plans, batches, execution, reporting, and the inventory + production interface.
**Migrations:** `0058`–`0073` (16 files).

---

## 1. Executive summary

Phase 4 is implemented and its behaviours are verified at the database level by an executed suite. The
inventory ledger is append-only and derived, production consumes and produces through that same ledger, and
restrictions, reservations and availability are computed per read rather than stored as a second truth.

Two things are deliberately not present, and the interface says so where a user would otherwise expect them:
**no stock valuation** (no costing method has been chosen by the company) and **no seeded production
configuration** (stages, declared inputs and yield bands describe a real factory and only the company can
state them).

| Item | Result |
| --- | --- |
| Migrations `0058`–`0073` | Apply clean on PostgreSQL (PGlite) from `0001` |
| Schema after Phase 4 | 121 tables, 41 views, 217 permissions, 887 grants, 16 roles |
| Database tests | **135 / 135 passed** (was 131 before this phase's permanent suite) |
| Unit tests | **168 / 168 passed** |
| End-to-end tests | **224 / 224 passed** |
| ESLint | 0 errors, 1 pre-existing advisory |
| TypeScript | clean (`tsc --noEmit`) |
| Production build | succeeded, **129 routes** |

Everything in that table was executed in this session; the commands are listed in §10.

---

## 2. What was built

### 2.1 Inventory domain (`0058`–`0064`)

| Object | Purpose |
| --- | --- |
| `inventory_lots` | A physical, traceable quantity with provenance (supplier, GRN, production batch, transfer, opening balance), dates and grade. |
| `inventory_movements` | **The** stock ledger. Append-only, one row per posted event, `quantity > 0` with an explicit `direction`. |
| `inventory_lot_balances`, `inventory_availability` | Views. A lot's balance is the sum of its movements; availability is `on hand − restricted − reserved`. |
| `inventory_restrictions` | Holds, quarantines, recalls, count freezes and inspection holds, with partial release. |
| `inventory_reservations` | Claims on available stock, module-agnostic (`reserved_for_module/type/id/reference`). Never move stock. |
| `inventory_transfers` (+ items) | Warehouse-to-warehouse movement via `transfer_out`/`transfer_in`, with an in-transit view. |
| `inventory_stock_counts`, `inventory_adjustments` | Freeze the system quantity, record the physical count, post an approved variance as a real movement. |
| `inventory_status_transitions` | The 0058 lifecycle table — every legal edge, the permission it needs and whether it needs a reason. |
| `inventory_numbering` | Reference series: `PA-LOT`, `PA-MOV`, `PA-TRF`, `PA-RSV`, `PA-CNT`, `PA-ADJ`, `PA-RST`, `PA-PLN`, `PA-BAT`. |

There is **no stock column anywhere.** A quantity exists only as the sum of the movements that produced it,
so a reconciliation question is answered by reading, not by trusting a cached figure.

### 2.2 Production domain (`0067`–`0070`)

| Object | Purpose |
| --- | --- |
| `production_stages` | Named processing steps. **Seeded empty.** |
| `production_product_processes` | A product's route through those stages. Descriptive only; never creates a material requirement. |
| `production_product_inputs` | Declared input per stated `basis_quantity` of output. The only source of plan requirements. |
| `production_yield_rules` | Versioned acceptance bands with an effective period. Never overwritten. |
| `production_plans` (+ materials) | An approved intention to produce. Holds no stock and posts no movement. |
| `production_batches` (+ materials, outputs, logs) | One run. Issued/output/waste totals are recomputed from posted movements by trigger, never typed. |

Execution functions (`0070`): `production_start_batch`, `production_issue_material`,
`production_record_output`, `production_close_batch`, `production_log_batch`, plus
`production_plan_apply_declared_inputs` and `production_plan_reserve_material` in `0068`.

### 2.3 Reporting (`0071`, `0072`)

Ten views, all `security_invoker = true`, all derived per read: `inventory_stock_summary`,
`inventory_movement_register`, `inventory_expiring_lots`, `inventory_restriction_register`,
`inventory_reservation_register`, `inventory_availability`, `production_batch_summary`,
`production_plan_progress`, `production_material_consumption`, `production_yield_summary`.
`0072` appended `received_date`, `manufacture_date` and `grade` to `inventory_availability` so the lot page
can show age and grade beside the quantities.

### 2.4 Interface

Inventory: overview, stock, lots (list/new/detail), movements, transfers (list/new/detail), counts
(list/new/detail), adjustments (list/new/detail), restrictions, reservations, reports.
Production: overview, plans (list/new/detail), batches (list/new/detail), configuration, reports.
Shared primitives (`ActionForm`, `WorkspaceNav`, `MetricCard`, `EmptyState`, `FilterBar`, `Pagination`) were
lifted into `components/shared` in this phase; the procurement originals became re-exports.

---

## 3. Defects found and fixed during verification

### 3.1 A dispatched transfer could never be received (`0073`)

`0061` freezes a transfer's lines once the transfer leaves `draft`/`submitted`/`rejected`. But
`inventory_receive_transfer` writes `destination_lot_id` and `quantity_received` back onto those lines while
the transfer is `dispatched` — so the guard rejected the receipt's own update. **Every transfer could be
dispatched and none could ever be received**, leaving stock permanently in transit.

`0073` narrows the rule instead of removing it: while a transfer is in transit only the receipt columns may
change, and the line's identity — transfer, line number, lot, product, unit, quantity, notes — must be
byte-identical. Once received, the lines freeze again.

This was found by `tests/database/inventory.test.ts`, which is why that suite now exists permanently.

### 3.2 A `"use server"` module cannot re-export

An attempt to give production its own `actions.ts` that re-exported the inventory actions failed the build
with *"the module has no exports at all"*: a `"use server"` file may only declare async functions, and
`export { x } from "..."` is a re-export. `app/(dashboard)/production/actions.ts` now carries no directive and
is documented as an alias. The implementations remain in `inventory/actions.ts`, because production and
inventory are one ledger.

### 3.3 Test-fixture corrections (not product defects)

Recorded so they are not rediscovered: `product_categories.code` must match `^[a-z][a-z0-9_]{1,39}$`;
`inventory_numbering` keys transfers as `inventory_transfer`, not `stock_transfer`; the restriction *type*
for a quality issue is `hold` with `reason_code = quality_hold`; `production_plan_progress` and
`production_batch_summary` expose `id`, not `plan_id`/`batch_id`; `inventory_in_transit` exposes
`in_transit_quantity`.

---

## 4. Design decisions now locked

1. **No stock column.** The ledger is the only quantity. Anything else would be a second truth to reconcile.
2. **Append-only ledger**, corrections by `reversal` movement rows, never by edit.
3. **Availability is computed**: on hand − restricted − reserved, per read, from the same definition the RPCs enforce.
4. **Reservations never move stock**; only issue, output, transfer, count post and adjustment post do.
5. **Restrictions are the quality seam.** Production output is receipted stock and is held
   `pending_inspection` at posting, so it is on hand and not available until released.
6. **Counts freeze `system_quantity`** with a generated `variance_quantity`; the approved variance posts a movement.
7. **Transfers create a new destination lot** inheriting supplier, expiry and grade; a short receipt leaves the difference visibly in transit.
8. **GRN handoff is idempotent** via `grn-stock:<receipt_id>`; retry cannot double-post.
9. **Configuration is versioned, not overwritten.** An approved plan keeps the requirement it was approved with even if the routing is later changed (proved by test).
10. **No yield band ⇒ close requires a written reason.** Yield is computed only when input and output share a unit; otherwise `mixed_units` and no percentage is stated.
11. **No valuation report.** `inventory_movements.recorded_value` is shown per row with its currency; summing requires a costing method the company has not chosen.

---

## 5. Reservation as the Phase 5/6 seam

`inventory_reserve_stock`, `inventory_release_reservation`, `inventory_apply_restriction` and
`inventory_release_restriction` are the only supported entry points. A caller that fails must record
`restriction_state = pending | confirmed | failed` rather than assume success. This is unchanged from
`docs/phase-4-readiness.md` and is what Phase 5 (quality release) and Phase 6 (customer reservations) build on.

---

## 6. Permissions

41 new codes across `inventory.*` and `production.*` (217 total), seeded by generated migrations `0065`/`0066`
with 149 grants. Notable separation: `inventory.stock.post` (moves stock) is distinct from
`inventory.stock.view`; `production.batch.execute` (issue/output/log) is distinct from
`production.batch.close`; `production.product.manage` (configuration) is held by neither production role.

---

## 7. Verification evidence

### 7.1 Commands actually run

```
npm install
npx tsc --noEmit                                           # clean
npm run lint                                               # 0 errors, 1 advisory (pre-existing)
npx vitest run --project unit                              # 168 passed
npx vitest run --project database                          # 135 passed
npm run build                                              # success, 129 routes
npx playwright test                                        # 224 passed
```

### 7.2 New permanent tests

| File | Covers |
| --- | --- |
| `tests/database/inventory.test.ts` (6 tests) | Transfers dispatch→receive end to end including destination-lot provenance and short-dispatch refusal; availability/restriction/reservation/movement/expiry views; absence of a valuation view; a full production run (declared inputs scaled, batch start gate, over-issue refusal, output creating a held lot, reason-required close, recorded yield 40 %, and every reporting view agreeing); configuration versioning after approval. |
| `tests/unit/inventory.test.ts` (13 tests) | Status vocabularies and labels against the SQL constraints; form schemas for stages, routing, declared inputs, yield bands, issues, outputs, plans, transfers, lots and adjustments. |
| `tests/e2e/phase4-factory.spec.ts` (30 tests × 2 viewports) | All 21 inventory and production routes gate anonymously; 6 deep links are gated before the identifier is used; no stock, hold, yield or lot detail is rendered to an anonymous visitor. |

The throwaway probe files `tests/database/tmp59.test.ts` and `tmp60.test.ts` were deleted once the permanent
suite covered them.

---

## 8. Known limitations

1. **No authenticated run of the *application* against a deployed Supabase project.** The database side of
   that gap was closed on 17 November 2026: the full migration chain was applied to a live Supabase Postgres
   17.12 instance and the inventory/production RLS policies were exercised there as the real `authenticated`
   role with JWT claims — see `docs/live-database-migration.md`. What remains unverified is the Next.js app
   signing in and driving those pages end to end, which needs the project's API keys and a seeded
   administrator.
2. **Browser tests required locally extracted system libraries.** The sandbox has no root and no `libnss3`, so
   the Playwright browsers were made runnable by unpacking `libnspr4`/`libnss3`/ATK/AT-SPI/xkbcommon into
   `~/.browser-libs` and exporting `LD_LIBRARY_PATH`. The suite passes under that arrangement; a CI image with
   the standard Playwright dependencies does not need it.
3. **Nothing is seeded for production configuration**, by design: yield bands, grading limits and process-loss
   percentages are still reserved for Pluck Agro.
4. **No valuation, no costing method.** Deliberate; see §4.11.
5. **`app/(dashboard)/production/actions.ts` is an alias**, not an implementation. Adding a production action
   means adding it to `inventory/actions.ts` and re-exporting it.

---

## 9. Production readiness

| Area | Status |
| --- | --- |
| Schema integrity, constraints, lifecycle guards | **VERIFIED IMPLEMENTED** (executed database suite) |
| Ledger arithmetic and availability definition | **VERIFIED IMPLEMENTED** |
| Transfer dispatch/receipt | **VERIFIED IMPLEMENTED** (after the `0073` fix) |
| Production run: plan → batch → output → close | **VERIFIED IMPLEMENTED** |
| Reporting views | **VERIFIED IMPLEMENTED** (quantities only; no valuation, by design) |
| Inventory & production UI (21 routes) | **IMPLEMENTED BUT NOT VERIFIED** — typechecks, lints, builds, renders behind auth; no authenticated click-through against a live backend |
| RLS for Phase 4 tables | **VERIFIED IMPLEMENTED** — exercised on live Supabase as `authenticated` with JWT claims (`docs/live-database-migration.md`) |
| Authenticated end-to-end scenario (receive → hold → plan → run → close → report) | **NOT IMPLEMENTED** as an automated test; requires a deployed Supabase project |

---

## 10. Files added or changed in this phase

**Migrations:** `0058`–`0064` (inventory), `0065`/`0066` (generated permission seeds), `0067`–`0070`
(production), `0071`/`0072` (reporting), `0073` (transfer receipt guard).

**Services:** `services/inventory/{shared,stock,transfers,counts,dashboard,reports}.ts`,
`services/production/{plans,batches}.ts`.

**Library:** `lib/inventory/statuses.ts`, `lib/validation/inventory.schemas.ts`,
`lib/permissions/definitions.ts`, `scripts/generate-database-types.py`, `types/database.types.ts`.

**Routes:** `app/(dashboard)/inventory/**` (14 files + `actions.ts`), `app/(dashboard)/production/**`
(11 files + `actions.ts` alias).

**Components:** `components/inventory/lot-lines-editor.tsx`, `components/shared/{action-form,workspace-nav}.tsx`.

**Tests:** `tests/database/inventory.test.ts`, `tests/unit/inventory.test.ts`, `tests/e2e/phase4-factory.spec.ts`;
`tests/database/procurement.test.ts` updated for the inventory handoff.

**Docs:** `docs/phase-4-readiness.md` (written before any DDL), this report.

---

## 11. What Phase 5 inherits

Phase 5 (QMS) can now be built on real inventory and production objects: quarantine and partial release work
against the actual ledger, a batch's output lot carries `production_batch_id` provenance, and the row
identifiers P5-018…P5-022 needed now exist. The dashboard's quarantine quantities and full traceability
(P5-027) become satisfiable — but only once Phase 5 is implemented; nothing in this report claims they already
are.
