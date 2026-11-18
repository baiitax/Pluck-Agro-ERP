# Phase 3 — implementation-readiness assessment

Date: 17 November 2026
Scope: Procurement & Supplier Operations (Phase 3 specification v1.0)
Method: direct inspection of the repository at `pluck-agro-erp` (migrations `0001`–`0041`, `app/`,
`services/`, `lib/`, `components/`, `tests/`), not inference from the specifications.

---

## 1. What the specification assumes vs. what the repository contains

| Specification assumption | Repository reality | Consequence for Phase 3 |
| --- | --- | --- |
| Phase 1 provides an approval **workflow engine** | Phase 1 ships approval **authority configuration** only: `approval_authorities` (employee/role, module, transaction type, currency, min/max, scope, validity window), `approval_delegations`, `segregation_of_duties_rules`, `sod_overrides`, `approval_limits`. No request/decision tables exist. | Phase 3 must execute approvals itself. It therefore adds `procurement_approvals` (decision trail) and reads authority, delegation and SOD rules from the Phase 1 tables rather than duplicating them. No second authority model is created. |
| Phase 1 provides a notification system | **No notification table or service exists.** `app/(dashboard)/notifications/page.tsx` is a placeholder that states pending-approval notifications are not implemented. | A minimal, module-agnostic `notifications` store is created in Phase 3 and written to by procurement events. It is intentionally generic (recipient, module, entity, href), so a later system-wide notification module extends it instead of replacing it. Documented as a Phase 3 addition. |
| Phase 0/1 provide document storage | No storage bucket, no upload route. `supplier_documents` / `customer_documents` store **metadata only** and their UI states "File storage is not enabled in this environment." | Phase 3 stores procurement document **metadata** with the same shape (`storage_bucket`, `storage_path`, no public URLs) and a validated type/size contract. Binary upload remains **BLOCKED** on bucket provisioning and is reported as such. |
| Master data exists and is authoritative | Verified: `suppliers`, `products`, `units_of_measure`, `warehouses`, `warehouse_locations`, `currencies`, `exchange_rates`, `payment_terms`, `delivery_terms`, `tax_categories`, all with RLS and lifecycle guards. | Procurement references them by UUID only. Nothing is duplicated. |
| Configurable reference numbering exists | `public.master_data_entities` + `private.next_master_reference()` implement prefix/padding/last_value under a row lock. | Reused conceptually, extended in `0042` with `procurement_numbering` because the required format `PA-PO-2026-000001` embeds a **period** (year) and needs a yearly reset, which the master-data counter does not express. |
| Configurable lifecycle transitions exist | `master_data_status_transitions` + `private.guard_master_status()` enforce declared edges with per-edge permission and reason. | Same pattern reproduced for procurement in `procurement_status_transitions` + `private.guard_procurement_status()`, because the master guard writes to `master_data_change_history` and asserts a `master_data.*` vocabulary. |
| Permissions are generated, never hand-edited | `scripts/generate-seed-sql.mjs` transpiles `lib/permissions/definitions.ts` into SQL seeds; `tests/unit/permissions.test.ts` asserts parity. 139 codes today. | Phase 3 adds codes to `definitions.ts` and regenerates seeds. The generator currently splits Phase 1 vs `master_data.*` only, so it is **extended** to a third set for `procurement.*` (applied after `0042` widens the action vocabulary). |
| Migrations are the source of truth for types | `scripts/derive-types-from-migrations.py` splices generated table types into `types/database.types.ts`. | Re-run after the new migrations. |

## 2. Confirmed blockers found before writing code

1. **No notification infrastructure** — resolved by adding a generic `notifications` table (see above).
2. **No document storage bucket** — procurement documents are metadata-only; explicit `BLOCKED` status for binary upload.
3. **No approval request engine** — Phase 3 implements the request/decision trail and *reads* Phase 1 authority configuration. Any approval limit remains an administrator-entered row; no threshold is invented.
4. **No `pg_cron`/scheduler** — overdue-delivery and quotation-expiry states are **derived at read time** from dates, not written by a background job. This is stated in the UI and in the report.

## 3. Non-collisions checked

* Existing procurement permission codes (`procurement.purchase_order.view|create|approve`,
  `procurement.goods_receipt.view|approve`) already exist and are granted to roles. Phase 3 keeps
  those codes and their existing grants, and adds new actions around them.
* Existing tables named `procurement_*`: none. No name collision in `public`.
* `procurement` appears today only as a navigation placeholder route and permission module.
* `approval_limits` (Phase 0) and `approval_authorities` (Phase 1) both exist. Phase 3 reads
  **`approval_authorities`** (the richer, scoped, validity-dated model) and ignores the legacy
  `approval_limits` table, which Phase 0 documented as "data model only".

## 4. Decisions taken to avoid inventing policy

| Question | Decision |
| --- | --- |
| Approval thresholds | Not hard-coded. An approval succeeds only if an active `approval_authorities` row for the actor (employee or role) covers the transaction amount in the document currency. If no row exists, the approval is refused. |
| Self-approval | Blocked by default when an active `segregation_of_duties_rules` row with `enforcement_level = 'BLOCK'` matches, or when a `sod_overrides` row is absent for that employee. When no SOD rule is configured, the platform allows it and records the fact that no rule applied — it does not invent a prohibition beyond the configured one. Additionally, an explicit hard rule is applied: the creator of a document cannot approve it (this is the one SOD rule the specification states directly, §F). |
| Excess delivery tolerance | Not hard-coded. `procurement_settings.excess_receipt_tolerance_percent` defaults to **0** (no tolerance) and is editable by an administrator with justification. |
| Quotation selection | Never automatic. A selection always records a justification and the compared quotation ids. |
| PO number format | `PA-PO-<year>-<sequence>` seeded as configuration, editable. |
| Currency/FX | PO stores a rate snapshot (`exchange_rate`, `exchange_rate_id`, `rate_type`) captured at issue; later rate changes never rewrite it. No rate is seeded. |

## 5. Sequencing

`0042` foundation → `0043` requisitions → `0044` quotations → `0045` purchase orders →
`0046` goods receipts → `0047` advances & reconciliation → `0048` support (documents, comments,
approvals trail, notifications) → `0049` reporting views → `0050` RLS & privileges →
`0051/0052` generated permission/role seeds. Application code follows the same order, with a
PGlite database test proving each layer before the next begins.
