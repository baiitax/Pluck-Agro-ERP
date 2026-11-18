-- 0055 — the remaining procurement report views
--
-- 0049 delivered ten report views. This migration completes the set the specification asks for
-- (19 database-backed reports) so that every figure on the reports screen is a query result rather
-- than something the application computes or, worse, invents.
--
-- Same rules as 0049: views only, no stored aggregates, `security_invoker` throughout, and amounts
-- always carry their currency code so nothing is silently summed across currencies.
--
-- Limitation stated once here and repeated in the report definitions the interface shows: these
-- views describe what procurement recorded. They are not financial statements. `ordered_value` is a
-- commitment, `received_value` is goods at agreed price, and a payable only exists once Finance has
-- invoiced and it is recorded as a supplier transaction reference.

-- ---------------------------------------------------------------------------
-- 11. Purchase order amendments
-- ---------------------------------------------------------------------------

create or replace view public.report_purchase_order_amendments
with (security_invoker = true)
as
select
  a.id,
  a.reference,
  a.purchase_order_id,
  po.reference as purchase_order_reference,
  po.supplier_name_snapshot as supplier_name,
  a.status,
  a.reason,
  a.base_version,
  a.resulting_version,
  a.previous_total,
  a.new_total,
  (a.new_total - a.previous_total)::numeric(20, 2) as total_change,
  po.currency_code,
  a.requested_at,
  a.approved_at,
  a.applied_at,
  e.first_name || ' ' || e.last_name as requested_by_name,
  (select count(*) from public.purchase_order_amendment_items i where i.amendment_id = a.id) as change_count
from public.purchase_order_amendments a
join public.purchase_orders po on po.id = a.purchase_order_id
left join public.employees e on e.id = a.requested_employee_id;

comment on view public.report_purchase_order_amendments is
  'Every amendment with the total before and after it. `total_change` is what the supplier was asked to accept, not an approved commitment until the amendment is applied.';

-- ---------------------------------------------------------------------------
-- 12. Requisition → order traceability
-- ---------------------------------------------------------------------------

create or replace view public.report_requisition_traceability
with (security_invoker = true)
as
select
  r.id as requisition_id,
  r.reference as requisition_reference,
  r.status as requisition_status,
  ri.line_number,
  ri.id as requisition_item_id,
  ri.product_id,
  p.name as product_name,
  ri.quantity as requested_quantity,
  ri.unit_id,
  u.code as unit_code,
  po.id as purchase_order_id,
  po.reference as purchase_order_reference,
  po.status as purchase_order_status,
  alloc.allocated_quantity,
  (ri.quantity - coalesce(totals.allocated, 0))::numeric(20, 6) as unallocated_quantity
from public.purchase_requisitions r
join public.purchase_requisition_items ri on ri.requisition_id = r.id
left join public.products p on p.id = ri.product_id
left join public.units_of_measure u on u.id = ri.unit_id
left join public.purchase_requisition_allocations alloc on alloc.requisition_item_id = ri.id
left join public.purchase_order_items poi on poi.id = alloc.purchase_order_item_id
left join public.purchase_orders po on po.id = poi.purchase_order_id
left join lateral (
  select sum(a.allocated_quantity) as allocated
    from public.purchase_requisition_allocations a
   where a.requisition_item_id = ri.id
) totals on true;

comment on view public.report_requisition_traceability is
  'One row per requisition line and the purchase order line it was allocated to. A requisition line may appear on several orders; a blank purchase order means the quantity has not been ordered yet.';

-- ---------------------------------------------------------------------------
-- 13. Supplier advance applications
-- ---------------------------------------------------------------------------

create or replace view public.report_supplier_advance_applications
with (security_invoker = true)
as
select
  ap.id,
  ap.advance_id,
  ad.reference as advance_reference,
  ad.supplier_name_snapshot as supplier_name,
  ad.currency_code,
  ap.target_type,
  ap.target_reference,
  ap.applied_amount,
  ap.confirmation_status,
  ap.applied_at,
  ap.confirmed_at,
  ad.amount as advance_amount,
  ad.outstanding_amount as advance_outstanding,
  case when ap.confirmation_status = 'confirmed' then true else false end as reduces_balance
from public.supplier_advance_applications ap
join public.supplier_advances ad on ad.id = ap.advance_id;

comment on view public.report_supplier_advance_applications is
  'Every application of an advance, marked with whether it reduces the outstanding balance. Only confirmed applications do; a pending application is a claim, not a settlement.';

-- ---------------------------------------------------------------------------
-- 14. Supplier procurement position
-- ---------------------------------------------------------------------------

create or replace view public.report_supplier_balance_position
with (security_invoker = true)
as
select
  b.supplier_id,
  b.reference,
  b.legal_name,
  b.supplier_status,
  b.currency_code,
  b.ordered_amount,
  b.received_value,
  b.invoiced_amount,
  b.paid_amount,
  b.advance_balance,
  b.confirmed_payable,
  b.unreconciled_difference,
  case when b.confirmed_payable is null then false else true end as payable_is_basis_known
from public.supplier_balances b;

comment on view public.report_supplier_balance_position is
  'Purchase commitments beside the payable. The payable is null when no supplier invoice has been recorded, because procurement cannot state a debt Finance has not raised.';

-- ---------------------------------------------------------------------------
-- 15. Approval decisions
-- ---------------------------------------------------------------------------

create or replace view public.report_approval_decisions
with (security_invoker = true)
as
select
  a.id,
  a.entity_type,
  a.entity_id,
  a.entity_reference,
  a.stage,
  a.decision,
  a.amount_at_decision,
  a.currency_code,
  a.authority_id,
  a.sod_rule_id,
  a.comment,
  a.created_at,
  e.first_name || ' ' || e.last_name as decided_by_name,
  auth_tx.transaction_type as authority_transaction_type,
  auth_tx.maximum_amount as authority_maximum
from public.procurement_approvals a
left join public.employees e on e.id = a.actor_employee_id
left join public.approval_authorities auth_tx on auth_tx.id = a.authority_id;

comment on view public.report_approval_decisions is
  'Every procurement decision with the authority it was taken under. A null authority means no configured authority covered the amount at the time, which the decide function refuses anyway — present here for historical rows imported from elsewhere.';

-- ---------------------------------------------------------------------------
-- 16. Goods receipt inspections
-- ---------------------------------------------------------------------------

create or replace view public.report_goods_receipt_inspections
with (security_invoker = true)
as
select
  i.id,
  i.goods_receipt_id,
  gr.reference as goods_receipt_reference,
  gr.receipt_date,
  gr.purchase_order_id,
  po.reference as purchase_order_reference,
  i.goods_receipt_item_id,
  gi.line_number,
  i.inspection_type,
  i.result,
  i.quantity_inspected,
  i.findings,
  i.inspected_at,
  e.first_name || ' ' || e.last_name as inspected_by_name
from public.goods_receipt_inspections i
join public.goods_receipts gr on gr.id = i.goods_receipt_id
join public.purchase_orders po on po.id = gr.purchase_order_id
left join public.goods_receipt_items gi on gi.id = i.goods_receipt_item_id
left join public.employees e on e.id = i.inspected_by;

comment on view public.report_goods_receipt_inspections is
  'Inspection findings recorded against a delivery. An inspection is evidence; it does not by itself change accepted, rejected or quarantined quantities.';

-- ---------------------------------------------------------------------------
-- 17. Procurement documents
-- ---------------------------------------------------------------------------

create or replace view public.report_procurement_documents
with (security_invoker = true)
as
select
  d.id,
  d.entity_type,
  d.entity_id,
  d.entity_reference,
  d.document_type,
  d.title,
  d.file_name,
  d.mime_type,
  d.file_size_bytes,
  d.is_confidential,
  d.uploaded_at,
  e.first_name || ' ' || e.last_name as uploaded_by_name,
  case when d.storage_path is null then 'metadata_only' else 'stored' end as storage_state
from public.procurement_documents d
left join public.employees e on e.id = d.uploaded_by;

comment on view public.report_procurement_documents is
  'Document metadata for procurement transactions. `metadata_only` means the file itself lives outside the system: no storage bucket is configured, and the register says so rather than pretending the file is retrievable.';

-- ---------------------------------------------------------------------------
-- 18. Purchase order version history
-- ---------------------------------------------------------------------------

create or replace view public.report_purchase_order_versions
with (security_invoker = true)
as
select
  v.id,
  v.purchase_order_id,
  po.reference as purchase_order_reference,
  v.version,
  v.reference,
  v.status_at_snapshot,
  v.total_amount,
  v.currency_code,
  v.reason,
  v.created_at,
  e.first_name || ' ' || e.last_name as created_by_name
from public.purchase_order_versions v
join public.purchase_orders po on po.id = v.purchase_order_id
left join public.profiles pr on pr.id = v.created_by
left join public.employees e on e.id = pr.employee_id;

comment on view public.report_purchase_order_versions is
  'The immutable versions of each order. Version 1 is the issued document; later versions are the order after an applied amendment.';

-- ---------------------------------------------------------------------------
-- 19. Status history
-- ---------------------------------------------------------------------------

create or replace view public.report_procurement_status_history
with (security_invoker = true)
as
select
  h.id,
  h.entity_type,
  h.entity_id,
  h.entity_reference,
  h.from_status,
  h.to_status,
  h.reason,
  h.created_at,
  e.first_name || ' ' || e.last_name as actor_name
from public.procurement_status_history h
left join public.employees e on e.id = h.actor_employee_id;

comment on view public.report_procurement_status_history is
  'The append-only status trail for every procurement document. Nothing here can be edited after the fact.';

-- ---------------------------------------------------------------------------
-- Corrected supplier procurement report
-- ---------------------------------------------------------------------------
--
-- 0049 built this report with `sum(distinct po.total_amount)`, which silently drops a second order
-- that happens to total the same as another, and it summed across currencies. Both are wrong for a
-- procurement report, so the view is replaced here: one row per supplier and currency, with real
-- aggregates. A supplier with no orders shows a null currency rather than an invented one.

-- The column order changes, so the view is dropped and rebuilt rather than replaced in place.
drop view if exists public.report_supplier_procurement;

create view public.report_supplier_procurement
with (security_invoker = true)
as
with orders as (
  select po.supplier_id,
         po.currency_code,
         count(*) as purchase_order_count,
         sum(po.total_amount)::numeric(20, 2) as ordered_value,
         max(po.order_date) as last_order_date
    from public.purchase_orders po
   where po.status not in ('draft', 'rejected', 'cancelled')
   group by po.supplier_id, po.currency_code
),
receipts as (
  select gr.supplier_id, count(*) as receipt_count
    from public.goods_receipts gr
   where gr.status = 'posted'
   group by gr.supplier_id
),
advances as (
  select ad.supplier_id, count(*) as advance_count
    from public.supplier_advances ad
   group by ad.supplier_id
)
select
  s.id as supplier_id,
  s.reference,
  s.legal_name,
  s.status,
  s.verification_status,
  o.currency_code,
  coalesce(o.purchase_order_count, 0) as purchase_order_count,
  coalesce(o.ordered_value, 0)::numeric(20, 2) as ordered_value,
  coalesce(r.receipt_count, 0) as receipt_count,
  coalesce(a.advance_count, 0) as advance_count,
  o.last_order_date
from public.suppliers s
left join orders o on o.supplier_id = s.id
left join receipts r on r.supplier_id = s.id
left join advances a on a.supplier_id = s.id;

comment on view public.report_supplier_procurement is
  'Supplier procurement activity, one row per supplier and currency. Counts are real counts and values are summed within a single currency.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Views are `security_invoker`, so a grant here does not widen data visibility: the caller still
-- needs the underlying SELECT policies on the tables the view reads.

grant select on
  public.report_purchase_order_amendments,
  public.report_requisition_traceability,
  public.report_supplier_advance_applications,
  public.report_supplier_balance_position,
  public.report_approval_decisions,
  public.report_goods_receipt_inspections,
  public.report_procurement_documents,
  public.report_purchase_order_versions,
  public.report_procurement_status_history,
  public.report_supplier_procurement
to authenticated;
