# Phase 6 specification — received, recorded, not started

**Date received:** 17 November 2026
**Status:** NOT STARTED. No Phase 6 migration, route, service or permission exists in this repository.

## Why nothing was built

The specification itself states the prerequisites in this order:

> Phase 4 — Factory Operations & Inventory Control
> Phase 5 — Quality Management, Laboratory Testing, Product Specifications, Inspection, Batch Traceability &
> Quality Release

and the standing instruction for this engagement is that **Phase 4 must be closed before Phase 5 begins, and
Phase 5 before Phase 6**. Phase 4 closed in this session (see `docs/phase-4-report.md`). **Phase 5 has not been
built**, so Phase 6's prerequisites are not satisfiable yet.

This is not a delay for its own sake. The specification requires Phase 6 to consume things that only Phase 5
produces, and building around their absence would mean inventing them:

| Phase 6 requirement | Depends on | Present today |
| --- | --- | --- |
| §9.3 "verify the applicable Phase 5 quality disposition… only quality-released inventory can be treated as eligible" | Phase 5 release decisions per lot/batch | **No.** Lots carry `pending_inspection` restrictions (Phase 4) but nothing releases them by quality disposition |
| §14.1/§14.3 claims "must connect to Phase 5 NCR and CAPA workflows" | NCR/CAPA objects | **No** |
| §14.4 returns "apply Phase 5 quality disposition" | Phase 5 disposition | **No** |
| §12.2 quality documents: Certificate of Analysis, specification, inspection report | Phase 5 CoA generation | **No** |
| §23.5 acceptance scenario C (quality restriction blocks a reservation) | Phase 5 hold semantics | **Partially** — Phase 4 restrictions do block reservation; the *quality* workflow that sets and clears them does not exist |

What Phase 4 does already provide, and what Phase 6 will consume unchanged: `inventory_availability`
(on hand − restricted − reserved), `inventory_reserve_stock` / `inventory_release_reservation`,
`inventory_apply_restriction` / `inventory_release_restriction`, the append-only movement ledger, and lot
provenance including `production_batch_id`.

## What this record preserves

The specification's own boundaries are recorded here so that later work cannot quietly widen them, because
several exclusions are easy to "helpfully" cross:

- **No general ledger, receivables, payment reconciliation or FX trading.** Phase 6 prepares events for Finance
  and must not post accounting entries or claim a customer has paid.
- **No invented regulatory documents.** The system may prepare a commercial invoice, pro forma and packing
  list; it must not claim to have obtained a phytosanitary certificate, certificate of origin or customs
  clearance without documentary evidence.
- **No fabricated shipment tracking.** With no verified provider connected, the UI shows the last recorded
  milestone and states that tracking is manually maintained.
- **No invented identifiers.** Container numbers, seal numbers and B/L references come from shipping documents,
  never from a generator.
- **No duplicate masters.** Customer comes from Phase 2; stock from the Phase 4 ledger; quality from Phase 5;
  approvals and audit from Phase 1.
- **Prices, discount limits, approval thresholds and credit terms are not to be invented** — they are
  configuration the company states.

## Acceptance checklist (P6-001 … P6-041)

Held verbatim from the specification for use when Phase 6 starts: customer master integration; enquiry
management; opportunity pipeline; quotation creation, multi-line, approval, versioning; customer PO
registration, verification, duplicate protection; sales order creation, approval, amendments; commercial
contracts; commercial pricing; inventory availability integration; quality release verification; reservation
integration; partial fulfilment; dispatch planning; picking; packing; dispatch approval; atomic inventory
deduction; container management; shipment management; milestone tracking; export document register; commercial
invoice; packing list; document versioning and verification; delivery confirmation; delivery discrepancies;
claims and returns; Finance integration events; notifications and audit; permission and RLS enforcement;
reporting; responsive UI; typecheck/lint/build; automated tests with evidence.

## Sequence to resume

1. Build **Phase 5** (QMS) on the Phase 4 objects: specifications, sampling, laboratory results, CoA,
   inspections, NCR/CAPA, batch traceability, and quality release — the release function being the thing that
   releases a Phase 4 `pending_inspection` restriction after a disposition.
2. Close Phase 5 with its own gates and report.
3. Then implement Phase 6 in the specification's ten stages, starting with an architecture assessment of
   Phases 0–5 as that specification requires.

No Phase 6 tick may be claimed before its evidence exists. In particular, the Phase 6 report must not mark
P6-017 or P6-018 as verified until a real Phase 5 release decision is what allows a reservation to succeed.
