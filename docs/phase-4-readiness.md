# Phase 4 — implementation-readiness assessment

Date: 17 November 2026
Scope: Factory Operations, Production Management & Inventory Control (Phase 4 specification v1.0)
Method: direct inspection of the repository at `pluck-agro-erp` — migrations `0001`–`0057`,
`app/`, `services/`, `lib/`, `components/`, `tests/` and `package.json`. Not inference from the
specification, and not the assumption that a previous phase's document proves its code exists.

This document exists because the Phase 4 and Phase 5 specifications both require that Phase 0–4 be
inspected before any table is created, and because §15.1 of the Phase 5 specification forbids
duplicating inventory state. Nothing here is DDL; it is the ground truth the DDL is written against.

---

## 1. What exists today, verified

| Area | State | Evidence |
|---|---|---|
| Migration chain | `0001`–`0057` applies in one pass | `tests/database/migrations.test.ts`; 96 tables, 27 views, 182 permissions, 16 roles |
| Warehouse / storage hierarchy | exists, Phase 2 | `warehouses` (`warehouse_type` covers raw_material, finished_goods, production, packaging, waste, general_storage, transit, external_storage), `warehouse_locations` (self-referencing hierarchy), both RLS-guarded with master-data lifecycle triggers |
| Products, units, UOM conversion | exists, Phase 2 | `products`, `units_of_measure`, effective-dated conversion rules, decimal-safe engine in `lib/uom/decimal.ts` |
| Suppliers | exists, Phase 2 | `suppliers`, categories, banking in a separate table |
| Employees / departments | exists, Phase 1 | used for "who received / who posted / who approved" |
| Approval authority configuration | exists, Phase 1 | `approval_authorities`, `approval_delegations`, `segregation_of_duties_rules`; consumed by Phase 3 rather than duplicated |
| Approval decision trail | exists, Phase 3 | `procurement_approvals`, `procurement_decide()` |
| Audit | exists, Phase 1 | `audit_logs`, append-only trigger, `services/audit/record-audit-event.ts`; event-category check constraint per phase |
| Notifications | exists, Phase 3 | `notifications` (module-agnostic, deliberately generic) |
| Document metadata | exists, Phase 3 | `procurement_documents`; **no storage bucket** |
| Reference numbering | exists, Phases 2 and 3 | `master_data_entities` / `private.next_master_reference`, `procurement_numbering` / `private.next_procurement_reference` (period-aware) |
| Lifecycle guards | exists, Phases 2 and 3 | `master_data_status_transitions`, `procurement_status_transitions` + guard triggers |
| GRN posting → handoff event | exists, Phase 3 | `post_goods_receipt()` writes `goods_receipt_postings` + one `procurement_integration_outbox` row, key `grn-posted:<receipt_id>`, **status `pending`, consumed by nobody** |

## 2. What does **not** exist

| Expected by Phase 4 (and by Phase 5 §15.1) | Reality |
|---|---|
| `inventory_movements` append-only ledger | **absent** |
| Derived stock balances | **absent** |
| Reservation engine | **absent** |
| Stock transfers, stock counts, adjustments | **absent** |
| Valuation layer | **absent** |
| Production plans / batches (`PA-BAT-YYYY-NNNNNN`) | **absent** — no `production_*` table exists |
| Material issues, daily logs, outputs, by-products, waste | **absent** |
| Yield / mass-balance rules | **absent** |
| Consumer for `procurement.goods_receipt.posted` | **absent** — the event is durable and unread |
| `inventory.*` / `production.*` permission depth | two `inventory.*` and three `production.*` codes only, no lifecycle verbs |
| Inventory / production routes | `ModulePlaceholder` stubs (`app/(dashboard)/inventory/page.tsx`, `production/page.tsx`) |
| PDF generation | **no library installed**; nothing in the repository renders a PDF |

## 3. Consequences for Phase 5

Phase 5 §8.2 requires that a quality hold **actually prevents** stock being used, reserved or
dispatched, and forbids implementing a hold as a text label. §16.2 requires the hold integration to be
verified, with an explicit pending-restriction state when the inventory side has not confirmed. Neither
requirement can be met while no availability engine exists.

Therefore the build order is: Phase 4 availability engine → Phase 5 hold / quarantine / release on top
of it. The seven Phase 5 acceptance rows that depend on it (P5-018 … P5-022, plus the quarantine
totals on the dashboard and the inventory leg of full traceability) stay BLOCKED until that engine is
real — they are not "implemented" by writing a status column.

## 4. Design decisions taken (and what was deliberately not decided)

**Decided, because they are engineering facts rather than company policy:**

1. **The ledger is the only source of quantity.** `inventory_movements` is append-only: no UPDATE, no
   DELETE, enforced by trigger. Every balance, availability figure and reservation check is derived
   from posted movements. No table anywhere stores a mutable "on hand" number.
2. **A correction is a compensating movement, never an edit.** A wrong receipt is reversed by a
   posted reversal row that references the original, so the history of what the system believed is
   preserved.
3. **Movements are idempotent.** Every movement carries an `idempotency_key` with a unique index, so a
   retried consumer (including the GRN handoff) cannot double-post stock.
4. **Double-entry transfers.** A transfer writes two movement rows (`transfer_out`, `transfer_in`)
   linked to one transfer document, so a per-warehouse balance is a plain sum and stock in transit is
   observable rather than implied.
5. **Availability is a derived view, not a column.** `available = posted balance − active
   reservations − active restrictions`. Restrictions are Phase 4's availability contract: Phase 5
   inserts quality holds and quarantine rows through it, which is how a hold becomes real.
6. **Recorded cost is a fact, not a method.** A movement may carry the unit cost stated on its source
   document (a GRN line price, a production cost sheet). The system computes *recorded value* from
   those facts and states plainly that this is not FIFO, weighted-average or specific-identification
   valuation. Choosing a method is Finance's decision, and no method is implemented or implied.
7. **Production batches are documents with a lifecycle**, like every other transactional object in
   this system, and their numbers come from configuration (`inventory_numbering`), not from `count(*)`.
8. **The gum-arabic flow is configuration.** Product stages and their permitted transitions are rows
   an operator edits, not a hard-coded Raw Gum → Clean Gum GR-I/GR-II → Powder Gum chain.

**Not decided, on purpose — these need Pluck Agro, not an agent:**

| Question | Why it is not mine to answer |
|---|---|
| Valuation method (FIFO / weighted average / specific identification) | Finance policy; the spec explicitly leaves it to Finance |
| Yield formula per product and process | Depends on verified process data; a fabricated formula would be trusted and then be wrong |
| GR-I / GR-II grading definitions and moisture/purity/impurity limits | Commercial and technical definitions owned by quality and management |
| Tsaki and process-loss percentages | Site-specific operational measurements |
| Whether a batch may be operationally complete while quality-pending | The seeded default is **yes, and it is not released** — but the release gate itself is Phase 5 |
| Authoritative opening balances | Cannot be asserted without an approved source; the legacy database is never connected |

## 5. Integration seam with Phase 5, stated as a contract

Phase 4 will expose, and Phase 5 will consume:

- `inventory_apply_restriction(lot_id, quantity, reason_code, source_module, source_id, idempotency_key)`
  → returns the restriction id, or raises if the quantity is not available. **Idempotent.**
- `inventory_release_restriction(restriction_id, released_quantity, reason, ...)` → partial release is
  supported, because Phase 5 requires it (P5-021).
- Both write to `inventory_restrictions`, which the availability view subtracts.
- If the call fails, the caller must record its own pending state. Phase 5's hold table therefore gets
  a `restriction_state` of `pending` / `confirmed` / `failed` — a hold that could not be applied is
  never shown as having restricted stock.

This is why the seven Phase 5 rows are BLOCKED rather than faked: the seam has to exist first.

## 6. Sequencing

`0058` foundation (vocabulary, numbering, settings, lifecycles) → `0059` lots and the movement ledger
→ `0060` availability, restrictions and the GRN handoff consumer → `0061` transfers → `0062`
reservations → `0063` stock counts and approval-controlled adjustments → `0064` RLS and privileges →
`0065` generated permission seeds → `0066` production plans and batches → `0067` material issues,
daily logs, outputs and by-products → `0068` yield and mass-balance rules → `0069` report views →
`0070` atomic create/post functions.

Each migration is applied to PGlite by the database test suite before the next is written, so the chain
is proven incrementally rather than at the end. Application code follows, with the same five quality
gates as Phases 1–3.
