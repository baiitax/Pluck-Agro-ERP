# Phase 3 report — Procurement & Supplier Operations

**Date:** 17 November 2026
**Scope:** Pluck Agro ERP — Phase 3 (Phase 3 specification v1.0)
**Repository:** `pluck-agro-erp/`
**Baseline:** the verified Phase 0 / 1 / 2 codebase (44 routes, 131 unit tests, 82 database tests, 106 end-to-end checks)

Status vocabulary used throughout — the same five words as the Phase 1 and Phase 2 reports, and
nothing outside them:

| Status | Meaning |
|---|---|
| **VERIFIED IMPLEMENTED** | Code exists, is reachable, and was exercised by an automated check that passed in this workspace. |
| **IMPLEMENTED BUT NOT VERIFIED** | Code exists and compiles, but exercising it needs a live Supabase project, which is not available for this work (see §17). |
| **PARTIALLY IMPLEMENTED** | Deliberately bounded subset, with the missing part named. |
| **NOT IMPLEMENTED** | Absent, by scope decision or because it belongs to a later phase. |
| **BLOCKED** | Cannot be completed in this environment for an environmental reason. |

---

## 1. Executive summary

Phase 3 delivers the procurement cycle end to end: a requisition that asks for goods, quotations that
price it, a comparison that records *why* a supplier was chosen, a purchase order that commits money,
amendments that change an issued order without rewriting it, goods receipts that record what physically
arrived, posting that turns accepted quantities into a durable inventory handoff event, supplier
advances whose balance is derived rather than typed, a supplier ledger that separates a commitment from
a debt, and a reporting / audit / permission surface over all of it.

The decisions that carry the most weight:

- **Nothing is invented.** No approval threshold, no excess tolerance, no exchange rate, no quotation,
  no supplier, no price. Every threshold is a row an administrator configures; where no row exists the
  action is refused rather than defaulted. The seeded settings are the conservative reading
  (tolerance 0 %, approvals required).
- **Approvals reuse the Phase 1 authority model.** Phase 1 shipped *authority configuration* — no
  request/decision tables. Phase 3 therefore adds the decision trail (`procurement_approvals`) and
  reads `approval_authorities`, `approval_delegations` and `segregation_of_duties_rules` from Phase 1
  rather than building a second authority model. An approval succeeds only when an active authority
  row covers the amount in the document's currency.
- **An issued order is immutable.** Content changes go through an amendment: proposal, optional
  approval, then application. Applying one bumps `version` and writes a new immutable version
  snapshot; the previous version stays readable. A quantity cannot be reduced below what has already
  been received without an explicit, separately-authorised confirmation.
- **A receipt is not stock.** Posting a receipt re-derives the outstanding position under a row lock,
  writes a posting record and a single outbox event, and nothing else. The event
  (`procurement.goods_receipt.posted`, idempotency key `grn-posted:<receipt_id>`) is the handoff that
  Phase 4 inventory will consume. Until then the UI says the stock is *queued*, not created.
- **Money and quantities are exact.** All amounts, rates and quantities are PostgreSQL `NUMERIC`;
  totals are computed by triggers and by database functions, never in the browser. `numeric` values
  cross the wire as strings and are parsed once, on the server.
- **A commitment is not a debt.** The supplier position shows ordered value, received value, invoiced
  amount, paid amount and confirmable payable as separate columns. The payable is `null` — rendered as
  "no invoice recorded" — until Finance records an invoice reference.
- **Sensitive data is separated and masked.** Advance payment details live in their own table behind
  `procurement.supplier_advance_payment.view`; the service returns only the last four digits of a
  supplier account. Every payment confirmation is audited at `warning` severity.

**Gate results in this workspace**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | 0 errors, 1 pre-existing React-Compiler advisory (`components/tables/data-table.tsx`) |
| `npx vitest run --project unit` | **155 passed** (11 files; 131 before this phase, 24 new procurement cases) |
| `npx vitest run --project database` | **129 passed** (5 files, real migrations on PGlite; 47 new procurement cases) |
| `npx playwright test` | **164 passed** (desktop + mobile; 58 new Phase 3 checks) |
| `npx next build` | success, **98 routes** (26 of them procurement) |

Migration chain `0001` → `0057` applies cleanly in one pass: **96 tables, 27 views, 182 permissions,
16 roles**. `types/database.types.ts` is generated from the migrations (`scripts/generate-database-types.py`),
never hand-edited.

---

## 2. Schema delivered

Sixteen migrations, in dependency order:

| Migration | Contents |
|---|---|
| `0042_procurement_foundation.sql` | `procurement_numbering`, `procurement_settings`, `procurement_status_transitions`, `procurement_status_history`, `procurement_supplier_exceptions`; period-aware reference generator (`PA-REQ/PO/AMD/PST/REC/GRN-<year>-<seq>`) under a row lock |
| `0043_requisitions.sql` | `purchase_requisitions`, `purchase_requisition_items`, `purchase_requisition_allocations`, fulfilment view |
| `0044_quotations.sql` | `supplier_quotation_requests(+_suppliers)`, `supplier_quotations(+_items)`, `supplier_quotation_comparisons(+_quotes)`, `supplier_quotation_selections` |
| `0045_purchase_orders.sql` | `purchase_orders`, `purchase_order_items`, `purchase_order_requisition_links`, `purchase_order_versions`, immutability + issue-snapshot guards |
| `0046_goods_receipts.sql` | `goods_receipts(+_items, _inspections, _postings)`, split/excess/duplicate-delivery-note constraints, `post_goods_receipt`, outbox event |
| `0047_supplier_advances_ledger.sql` | `supplier_advances(+_applications, _payment_details)`, `supplier_transaction_references`, `supplier_reconciliations(+_items)`, `supplier_balances`, `supplier_ledger`, balance trigger |
| `0048_procurement_support.sql` | `procurement_documents`, `procurement_comments`, `procurement_approvals`, `notifications`, `procurement_legacy_imports(+_rows)`, `procurement_integration_outbox` |
| `0049_procurement_reports.sql` | first 10 report views + operational views (`purchase_order_summary`, `purchase_order_receipt_status`, `supplier_balances`, `supplier_ledger`) |
| `0050_procurement_rls.sql` | RLS on every procurement table, grants, `private.has_any_permission` |
| `0051/0052` | generated permission and role-grant seeds (48 `procurement.*` codes) |
| `0053_purchase_order_amendments.sql` | `purchase_order_amendments(+_items)`, `apply_purchase_order_amendment` semantics |
| `0054_procurement_approvals_execution.sql` | `procurement_decide`, `procurement_authority_covers`, `procurement_notify_approvers`, helper functions |
| `0055_procurement_report_views.sql` | 9 further report views, `report_*` grants |
| `0056_procurement_create_functions.sql` | 5 atomic create functions (requisition, quotation, purchase order, goods receipt, amendment) + `0057` 3 draft-update functions |

38 new tables (37 procurement plus the module-agnostic `notifications`) and 26 new views — 19
`report_*` views plus 7 operational/reporting views (`purchase_order_summary`,
`purchase_order_receipt_status`, `purchase_requisition_fulfilment`, `supplier_balances`,
`supplier_ledger`, `supplier_quotation_comparison_view`, `procurement_data_quality`) — all
`security_invoker`. The chain now holds 96 tables and 27 views; the 27th is Phase 2's
`master_data_quality_issues`.

---

## 3. Requisitions — IMPLEMENTED BUT NOT VERIFIED (live journey) / VERIFIED IMPLEMENTED (lifecycle and rules)

Lifecycle `draft → submitted → under_review → approved | rejected → processing → partially_fulfilled →
fulfilled`, plus `cancelled`; every edge is a row in `procurement_status_transitions` with a required
permission, enforced by `private.guard_procurement_status()`.

Verified at database level: creation with lines in one atomic call and product-name snapshotting, a
refusal to submit with no lines, a refusal of an undeclared status change, a refusal of content edits
once the requisition leaves `draft`, and requester/department visibility through RLS. Routes:
register (`/procurement/requisitions`), create, detail (lines, fulfilment, allocations, decision form,
status trail, approvals, documents), and an edit route that refuses to render a form for a
non-editable status rather than saving and failing.

## 4. Quotations and comparison — IMPLEMENTED BUT NOT VERIFIED (live journey) / VERIFIED IMPLEMENTED (selection rules)

Quotations carry their own terms and charge snapshots, so a later change to master data cannot
restate what a supplier offered. Totals are trigger-computed. A comparison may hold several
quotations but only one currency — the service refuses a mixed-currency comparison rather than
converting at a rate nobody approved.

A selection is never derived from price. Verified: a selection requires a justification, records the
compared quotation ids, is refused for a quotation that was not part of the comparison, and cannot be
re-made (one selection per comparison). Routes: register, create, detail, comparisons index, new
comparison, comparison detail with the decision panel.

## 5. Purchase orders and amendments — IMPLEMENTED BUT NOT VERIFIED (live journey) / VERIFIED IMPLEMENTED (totals, freeze, versions, amendments)

Verified: document totals in `NUMERIC` (not float), refusal for an unverified supplier without an
approved exception, refusal of approval by a user with no permission, no authority coverage or
self-approval, issue that freezes the order and writes an immutable version, write-protection on
version snapshots, amendment application that bumps the version and keeps both snapshots, refusal to
reduce a quantity below what has already been received (without confirmation), and refusal to apply
an amendment raised against an older version.

The amendment form offers quantity, unit price and delivery date, and picks terms and destination from
the real registers rather than asking an operator to type a UUID. `procurement_create_amendment`
derives the typed `quantity`/`unit_price` column from the operator's typed value and refuses a
non-numeric value at capture time, so a mistake is caught when it is made rather than at apply time.

Routes: register, create (with "start from a selection"), detail (lines, deliveries, receipt status,
amendments, versions, history, approvals, documents, action bar).

## 6. Goods receipts and posting — IMPLEMENTED BUT NOT VERIFIED (live journey) / VERIFIED IMPLEMENTED (posting invariants)

Posting is one-time and guarded by an idempotency key fixed per receipt
(`grn-posted:<receipt_id>`), so a double click or a retried request returns the original posting
reference instead of writing a second delivery. Re-derivation under a row lock means a stale receipt
cannot double-consume an order balance.

Verified: a partial delivery with an accepted/rejected/quarantined split, exactly one durable outbox
event per posted receipt, refusal of a second posting, several receipts completing an order, prevention
of over-receipt (including the stale-receipt case), refusal to post an unapproved receipt, refusal of a
split that does not add up, and refusal of a duplicate supplier delivery note.

The excess-delivery path is not a setting anyone can flip blindly: authorising an excess requires
`procurement.goods_receipt.approve`, and the control says so.

Routes: register, "record a receipt" (order picker → delivery + lines), detail (split lines,
inspection record and history, posting record, outbox event state, review decision, status/approval
trails, documents).

## 7. Supplier advances and applications — IMPLEMENTED BUT NOT VERIFIED (live journey) / VERIFIED IMPLEMENTED (derived balance)

`outstanding_amount` is maintained by a before-trigger from the advance amount and its **confirmed**
applications; nothing in the UI can type it. Verified: an advance tracks its confirmed applications
and outstanding balance, pending applications do *not* reduce the balance, the supplier position does
not present a purchase order as a payable, a payable appears only when an invoice reference is
recorded, and the supplier ledger is chronological and links back to each source document.

Payment details are in a separate table behind `procurement.supplier_advance_payment.view`; RLS
returns no row at all to a caller without it, and the service masks account numbers to the last four
digits before they reach a component. Verified: payment details are hidden from a user without the
permission.

Routes: register, record (supplier, amount, method, optional order), detail (balance panel, payment
panel gated on permission, applications with confirm action, apply form bounded by the outstanding
balance, status/approval trails, documents).

## 8. Supplier position and reconciliation — IMPLEMENTED BUT NOT VERIFIED (live journey) / VERIFIED IMPLEMENTED (view)

`report_supplier_balance_position` exposes ordered, received, invoiced, paid, advance balance,
confirmed payable and unreconciled difference per supplier and currency; `payable_is_basis_known` is
false when no invoice exists, and the UI renders "no invoice recorded" instead of zero. A
reconciliation records a position for a period and adjusts no document. Routes: supplier accounts
index, supplier statement (position, advances, orders, reconciliations, supplier documents, activity,
"what is deliberately absent").

## 9. Reports — VERIFIED IMPLEMENTED (views and grants) / IMPLEMENTED BUT NOT VERIFIED (live rendering)

Nineteen `report_*` views, all `security_invoker`, each with explicit `grant select`. Verified: all
nineteen exist and are `security_invoker`, and each amount sits beside the currency it is denominated
in (per-currency CTEs rather than a cross-currency sum). The report runner filters dates on the
report's own date column, offers a currency filter only where a currency column exists, and caps rows
at 500. Each catalogue entry states its own limitation, and the detail page repeats it above the table.

Routes: `/procurement/reports` (catalogue + data-quality indicators), `/procurement/reports/[reportId]`
(filters, typed rendering, explicit "results are capped" note).

## 10. Approvals, audit and documents — VERIFIED IMPLEMENTED (append-only trails) / IMPLEMENTED BUT NOT VERIFIED (live screens)

`procurement_approvals` and `procurement_status_history` are append-only; verified that both refuse
an update. The approval trail page shows the amount at decision, the approver's authority maximum and
any separation-of-duties override on the row it affected, because an override changes how a decision
should be read.

Documents are metadata-only. No storage bucket exists, so the register states `metadata_only` and no
download control is offered — the UI says the file lives outside the system rather than presenting a
link that cannot work. Verified at database level: `report_procurement_documents` reports the storage
state honestly and no storage path is exposed as a public URL.

## 11. Permissions and RLS — VERIFIED IMPLEMENTED

48 `procurement.*` permission codes, generated from `lib/permissions/definitions.ts` into seeds by
`scripts/generate-seed-sql.mjs` (never hand-edited), with 182 total codes and 16 roles in the chain.
Verified: every procurement table has RLS enabled, the sensitive payment-details table refuses a
caller without its permission, requisition visibility is limited to requester/department/procurement
staff, and a locked-out user sees no procurement rows at all. Suggested role mappings are grants of
record, not assumptions about how the company staffs itself.

## 12. Legacy readiness — IMPLEMENTED BUT NOT VERIFIED (live screen) / NOT CONNECTED (by instruction)

`procurement_legacy_imports` and `procurement_legacy_import_rows` record what an assessment found,
with a per-row match status (matched / unmatched / ambiguous / duplicate / orphan / ignored) and a
confidence figure. There is **no connection to the legacy database**, no automatic mapping, and no
merge of supplier or product records by name. The screen states that an empty page means "not
assessed", which is not the same as ready.

## 13. User interface — IMPLEMENTED BUT NOT VERIFIED (authenticated rendering)

26 routes under `/procurement`, plus a workspace shell whose section list is filtered by the caller's
own permissions before it renders. Every page re-checks its permission, every service checks it again,
and RLS enforces the same rule in PostgreSQL — the navigation is a convenience, not the control.
Empty, permission-denied and not-found states are distinct and worded honestly (an empty filtered list
says the filter ran on the server). No page computes stock, balances or totals in the browser.

## 14. Tests added

| Suite | Cases | What it pins down |
|---|---|---|
| `tests/unit/procurement-calc.test.ts` | 24 | Decimal-safe line/total arithmetic, receipt split balance, outstanding-quantity tolerance, status vocabulary parity with the migrations |
| `tests/database/procurement.test.ts` | 47 | Lifecycles and guards, numbering from configuration, quotation totals and selection rules, PO authority/SoD/coverage refusals, freeze and version immutability, amendment application and its refusals, receipt posting/over-receipt/idempotency/outbox, advance balance derivation, supplier position honesty, sensitive-data isolation, atomic create functions, 19 report views `security_invoker`, data-quality indicators |
| `tests/e2e/phase3-procurement.spec.ts` | 58 | Every Phase 3 route and deep link gated before a query runs or an id is trusted; no procurement document, amount, treasury or banking detail rendered to an anonymous visitor; a report route produces no report without a session |

Totals: unit **155**, database **129**, end-to-end **164**, build **98 routes**.

---

## 15. Acceptance matrix

Each row states a Phase 3 requirement and the evidence behind its status.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| P3-001 | Requisition lifecycle with configurable, permission-controlled transitions | VERIFIED IMPLEMENTED | `0042` transition table + guard trigger; 4 database tests |
| P3-002 | Requisition lines, allocations to orders, fulfilment tracked as quantity | VERIFIED IMPLEMENTED | `0043`, `purchase_requisition_fulfilment`, database test |
| P3-003 | Requesters see their own and their department's requisitions only | VERIFIED IMPLEMENTED | `0050` RLS policy, database test |
| P3-004 | Quotations with lines, charges and trigger-computed totals | VERIFIED IMPLEMENTED | `0044`, database test |
| P3-005 | Comparison across suppliers, single currency, never auto-converted | VERIFIED IMPLEMENTED | service refusal + comparison view |
| P3-006 | Supplier selection requires a justification and records compared quotations | VERIFIED IMPLEMENTED | 3 database tests |
| P3-007 | Purchase order with snapped supplier, unit, price and terms | VERIFIED IMPLEMENTED | `0045`, atomic create function, database test |
| P3-008 | Totals exact in `NUMERIC`, never floating point | VERIFIED IMPLEMENTED | 24 unit cases, database test |
| P3-009 | Approval only with an active authority covering the amount | VERIFIED IMPLEMENTED | `procurement_authority_covers`, refusal test |
| P3-010 | Self-approval blocked; SoD rules read from Phase 1, no new model | VERIFIED IMPLEMENTED | self-approval refusal test; `segregation_of_duties_rules` read |
| P3-011 | Issued order frozen; content changes only through an amendment | VERIFIED IMPLEMENTED | immutability guard + freeze test |
| P3-012 | Amendment: reason → optional approval → apply → new version, old version retained | VERIFIED IMPLEMENTED | `0053`, 3 database tests |
| P3-013 | Quantity cannot be cut below received quantity without explicit authorisation | VERIFIED IMPLEMENTED | refusal test |
| P3-014 | Goods receipt records received/accepted/rejected/quarantined with a required split | VERIFIED IMPLEMENTED | `0046` constraint + refusal test |
| P3-015 | Over-receipt refused, including under a stale read | VERIFIED IMPLEMENTED | over-receipt test |
| P3-016 | Posting is one-time and idempotent | VERIFIED IMPLEMENTED | idempotency key + double-post refusal test |
| P3-017 | Posting emits exactly one durable handoff event; nothing else | VERIFIED IMPLEMENTED | outbox test (`grn-posted:<receipt_id>`) |
| P3-018 | Duplicate supplier delivery note refused | VERIFIED IMPLEMENTED | unique index + test |
| P3-019 | Advance outstanding balance derived from confirmed applications | VERIFIED IMPLEMENTED | trigger + 2 database tests |
| P3-020 | Pending applications do not reduce the balance | VERIFIED IMPLEMENTED | test |
| P3-021 | Supplier position separates commitment from payable | VERIFIED IMPLEMENTED | `report_supplier_balance_position`, 2 tests |
| P3-022 | Supplier ledger chronological and linked to source documents | VERIFIED IMPLEMENTED | `supplier_ledger`, test |
| P3-023 | Reconciliation records a period position without adjusting documents | IMPLEMENTED BUT NOT VERIFIED | `supplier_reconciliations`, service; no live run |
| P3-024 | Payment details isolated, masked, access audited | VERIFIED IMPLEMENTED | RLS denial test, `slice(-4)` mask, `warning` audit |
| P3-025 | 19 database-backed report views, `security_invoker`, per-currency amounts | VERIFIED IMPLEMENTED | 2 database tests |
| P3-026 | Data-quality indicators computed from real rows | VERIFIED IMPLEMENTED | `report_*` + indicator test |
| P3-027 | Status and approval trails append-only | VERIFIED IMPLEMENTED | update refusal test |
| P3-028 | 48 granular `procurement.*` permissions, generated seeds, RLS everywhere | VERIFIED IMPLEMENTED | generator parity test, RLS sweep test |
| P3-029 | 26 procurement routes with honest empty / denied / not-found states | IMPLEMENTED BUT NOT VERIFIED | build output, route files |
| P3-030 | Authenticated journeys exercised in a browser | IMPLEMENTED BUT NOT VERIFIED | needs a live Supabase project (§17) |
| P3-031 | Document binary storage | BLOCKED | no storage bucket provisioned; metadata-only, stated in UI |
| P3-032 | Scheduled jobs (quotation expiry, overdue deliveries) | NOT IMPLEMENTED | no scheduler in this deployment; expiry and overdue are derived at read time from dates |
| P3-033 | Legacy database connection / automatic opening balances | NOT IMPLEMENTED | no connection exists, by standing instruction; readiness records only |
| P3-034 | Automatic supplier or product merging | NOT IMPLEMENTED | deliberately absent — a merge needs referential reconciliation and separate authorisation |
| P3-035 | Inventory, stock balances, valuation, production | NOT IMPLEMENTED | out of Phase 3 scope; the handoff event is emitted and nothing consumes it |

---

## 16. Defects found and fixed during this phase

Recorded because they were real, not because they are interesting:

1. Create RPCs raised `permission denied for schema auth` — switched to `public.current_profile_id()`;
   `auth.uid()` is not callable from these security-invoker functions.
2. Applying an amendment produced no new version snapshot — `0045` now snapshots on a `version` change
   as well as on issue.
3. Receipt and amendment test failures were role-session problems, not logic: the suite must call
   `asApprover()` before a GRN approval, `asStorekeeper()` before a second receipt post and
   `asBuyer()` before an amendment insert.
4. `0055` referenced a non-existent `v.created_by_employee` — joined `profiles → employees` instead.
5. `0055` raised `cannot change name of view column` — views are dropped and recreated, not replaced
   in place when their column list changes.
6. `report_approval_decisions` needed an explicit `grant select … to authenticated`.
7. `report_supplier_procurement` summed across currencies — rewritten with per-currency CTEs.
8. The amendment create function stored `new_value` but never the typed `quantity`/`unit_price` column
   the apply function reads, so a quantity change would have been silently discarded. The function now
   derives the typed column from the operator's value and refuses a non-numeric one at capture.
9. The amendment panel offered payment-term, delivery-term and destination changes that expected a
   pasted UUID. Those are now selects over the real registers.
10. `Pagination` needed `baseHref` + `params`; `ActionButton` needed to be generic; the PO create page
    needed an exported `PurchaseOrderSelectionSource` type to escape a `never` narrowing.

---

## 17. What was not verified, and why

No Supabase project is available for this work: the standing instruction is never to pause or delete
an existing project to make room, and the authenticated journeys need a seeded project. Everything
that requires a live authenticated session is therefore **implemented but not verified**. Concretely:

- raising a requisition, recording quotations, comparing them and recording a selection through the UI;
- approving, issuing, amending and closing a purchase order as the configured approvers;
- recording, inspecting, approving and posting a delivery as stores and procurement;
- confirming an advance payment as treasury and applying the balance as Finance;
- preparing a reconciliation and recording supplier documents;
- running each of the nineteen reports as the roles that may see them;
- responsive behaviour of the new screens at mobile width in a real authenticated session.

The database behaviour these depend on **is** verified, against the real migration chain applied to
PGlite: constraints, guards, transitions, authority and SoD refusals, immutability, posting invariants,
idempotency, balance derivation, RLS denial and view definitions. The end-to-end suite proves that no
route leaks before a session exists. What remains unproven is the join between a real session and a
real database — which is exactly where a seeded project is needed.

**Second gap, stated plainly:** the excess-delivery path and the reconciliation path are implemented
and their database rules are enforced, but neither has been exercised against a live row set. They are
marked accordingly rather than reported as verified.

---

## 18. Outstanding items, stated plainly

1. **Authenticated verification** of every service, action and screen against a live Supabase project —
   the single largest gap, caused by the absence of a project, not by missing code.
2. **Seeded end-to-end journeys** across the whole cycle (requisition → quotation → comparison →
   order → amendment → receipt → posting → advance → reconciliation).
3. **Document binary storage** — metadata is recorded; no bucket exists, so upload is BLOCKED.
4. **Scheduled jobs** — quotation expiry and overdue deliveries are derived at read time; there is no
   scheduler in this deployment, and no state is written by a background process.
5. **Supplier performance scoring** — not implemented. The statement screen says so rather than
   showing a score nobody defined.
6. **Inventory consumption of the handoff event** — the event is emitted and durable; the consumer
   belongs to Phase 4 and no part of it is claimed here.

---

## 19. Phase 4 relationship

The Phase 3 spec instructs that Phase 3 acceptance be completed before Phase 4 begins. Phase 3 code,
schema and the five quality gates are complete in this workspace. The two items that cannot be closed
here — authenticated verification and the seeded end-to-end journeys — need a live project. Phase 4
work has not been started: no inventory migration, movement ledger, warehouse hierarchy change,
production plan or stock balance exists in this repository.
