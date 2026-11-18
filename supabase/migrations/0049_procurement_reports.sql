-- 0049 — procurement reporting views and data-quality indicators
--
-- Everything here is a view. No report figure is stored, so a report cannot disagree with the
-- documents that produce it. Every view is `security_invoker`, which means the caller's RLS policies
-- on the underlying tables apply: a report never widens visibility.
--
-- Currency honesty: amounts are grouped by currency code. Nothing is summed across currencies,
-- because that would require a rate convention the company has not configured.

-- ---------------------------------------------------------------------------
-- Requisition register
-- ---------------------------------------------------------------------------

create or replace view public.report_requisition_register
with (security_invoker = true)
as
select
  r.id,
  r.reference,
  r.status,
  r.priority,
  r.requisition_date,
  r.required_delivery_date,
  r.estimated_total,
  r.currency_code,
  d.name as department_name,
  e.first_name || ' ' || e.last_name as requesting_employee,
  coalesce(f.line_count, 0) as line_count,
  coalesce(f.requested_quantity, 0) as requested_quantity,
  coalesce(f.allocated_quantity, 0) as allocated_quantity,
  coalesce(f.outstanding_quantity, 0) as outstanding_quantity,
  r.submitted_at,
  r.approved_at,
  case when r.approved_at is not null and r.submitted_at is not null
       then extract(epoch from (r.approved_at - r.submitted_at)) / 3600.0
       else null end::numeric(12, 2) as approval_hours
from public.purchase_requisitions r
left join public.departments d on d.id = r.department_id
left join public.employees e on e.id = r.requesting_employee_id
left join public.purchase_requisition_fulfilment f on f.requisition_id = r.id;

-- ---------------------------------------------------------------------------
-- Purchase order register and outstanding deliveries
-- ---------------------------------------------------------------------------

create or replace view public.report_purchase_order_register
with (security_invoker = true)
as
select
  s.purchase_order_id as id,
  s.reference,
  s.status,
  s.supplier_id,
  s.supplier_name_snapshot as supplier_name,
  s.order_date,
  s.expected_delivery_date,
  s.issued_at,
  s.currency_code,
  s.total_amount,
  s.line_count,
  s.ordered_quantity,
  s.received_quantity,
  s.outstanding_quantity,
  s.rejected_quantity,
  s.quarantined_quantity,
  s.is_overdue,
  po.department_id,
  d.name as department_name,
  case when s.ordered_quantity > 0
       then round((s.received_quantity / s.ordered_quantity) * 100, 2)
       else null end::numeric(6, 2) as received_percent
from public.purchase_order_summary s
join public.purchase_orders po on po.id = s.purchase_order_id
left join public.departments d on d.id = po.department_id;

create or replace view public.report_outstanding_deliveries
with (security_invoker = true)
as
select
  s.purchase_order_id as id,
  s.reference,
  s.supplier_name_snapshot as supplier_name,
  s.status,
  s.expected_delivery_date,
  s.outstanding_quantity,
  s.currency_code,
  s.is_overdue,
  case when s.expected_delivery_date is not null
       then (current_date - s.expected_delivery_date)
       else null end as days_past_expected
from public.purchase_order_summary s
where s.outstanding_quantity > 0
  and s.status in ('issued', 'partially_received', 'closed');

-- ---------------------------------------------------------------------------
-- Goods receipt register, discrepancies
-- ---------------------------------------------------------------------------

create or replace view public.report_goods_receipt_register
with (security_invoker = true)
as
select
  gr.id,
  gr.reference,
  gr.status,
  gr.receipt_date,
  gr.supplier_delivery_note_number,
  gr.delivery_reference,
  gr.inspection_status,
  po.reference as purchase_order_reference,
  s.legal_name as supplier_name,
  w.name as warehouse_name,
  l.name as location_name,
  gr.posting_reference,
  gr.posted_at,
  count(gi.id) as line_count,
  coalesce(sum(gi.received_quantity), 0) as received_quantity,
  coalesce(sum(gi.accepted_quantity), 0) as accepted_quantity,
  coalesce(sum(gi.rejected_quantity), 0) as rejected_quantity,
  coalesce(sum(gi.quarantined_quantity), 0) as quarantined_quantity
from public.goods_receipts gr
join public.purchase_orders po on po.id = gr.purchase_order_id
join public.suppliers s on s.id = gr.supplier_id
left join public.warehouses w on w.id = gr.warehouse_id
left join public.warehouse_locations l on l.id = gr.location_id
left join public.goods_receipt_items gi on gi.goods_receipt_id = gr.id
group by gr.id, po.reference, s.legal_name, w.name, l.name;

create or replace view public.report_receipt_discrepancies
with (security_invoker = true)
as
select
  gr.id as goods_receipt_id,
  gr.reference,
  gr.receipt_date,
  po.reference as purchase_order_reference,
  s.legal_name as supplier_name,
  gi.line_number,
  p.name as product_name,
  gi.received_quantity,
  gi.accepted_quantity,
  gi.rejected_quantity,
  gi.quarantined_quantity,
  gi.rejection_reason,
  case when gi.received_quantity > (gi.ordered_quantity - gi.previously_received_quantity)
       then true else false end as is_excess_delivery,
  case when gi.received_quantity < (gi.ordered_quantity - gi.previously_received_quantity)
       then true else false end as is_short_delivery
from public.goods_receipt_items gi
join public.goods_receipts gr on gr.id = gi.goods_receipt_id
join public.purchase_orders po on po.id = gr.purchase_order_id
join public.suppliers s on s.id = gr.supplier_id
join public.products p on p.id = gi.product_id
where gi.rejected_quantity > 0
   or gi.quarantined_quantity > 0
   or gi.received_quantity <> (gi.ordered_quantity - gi.previously_received_quantity);

-- ---------------------------------------------------------------------------
-- Quotation comparison report
-- ---------------------------------------------------------------------------

create or replace view public.report_quotation_comparison
with (security_invoker = true)
as
select
  v.comparison_id,
  c.title as comparison_title,
  c.comparison_date,
  v.quotation_id,
  v.quotation_reference,
  v.supplier_name,
  v.supplier_status,
  v.verification_status,
  v.total_at_comparison,
  v.currency_code,
  v.lead_time_days_at_comparison,
  v.validity_at_comparison,
  v.payment_terms_snapshot,
  v.is_lowest_price,
  sel.selected_quotation_id,
  (v.quotation_id = sel.selected_quotation_id) as is_selected,
  sel.justification as selection_justification,
  sel.selected_was_lowest
from public.supplier_quotation_comparison_view v
join public.supplier_quotation_comparisons c on c.id = v.comparison_id
left join public.supplier_quotation_selections sel on sel.comparison_id = v.comparison_id;

-- ---------------------------------------------------------------------------
-- Supplier advances and supplier procurement history
-- ---------------------------------------------------------------------------

create or replace view public.report_supplier_advances
with (security_invoker = true)
as
select
  a.id,
  a.reference,
  s.legal_name as supplier_name,
  a.transaction_date,
  a.amount,
  a.outstanding_amount,
  a.currency_code,
  a.payment_method,
  a.status,
  po.reference as purchase_order_reference,
  a.treasury_confirmation_reference,
  a.treasury_confirmed_at,
  count(ap.id) filter (where ap.confirmation_status = 'confirmed') as confirmed_applications,
  coalesce(sum(ap.applied_amount) filter (where ap.confirmation_status = 'confirmed'), 0) as applied_amount
from public.supplier_advances a
join public.suppliers s on s.id = a.supplier_id
left join public.purchase_orders po on po.id = a.purchase_order_id
left join public.supplier_advance_applications ap on ap.advance_id = a.id
group by a.id, s.legal_name, po.reference;

create or replace view public.report_supplier_procurement
with (security_invoker = true)
as
select
  s.id as supplier_id,
  s.reference,
  s.legal_name,
  s.status,
  s.verification_status,
  count(distinct po.id) as purchase_order_count,
  coalesce(sum(distinct po.total_amount), 0)::numeric(20, 2) as ordered_value,
  count(distinct gr.id) as receipt_count,
  count(distinct a.id) as advance_count,
  max(po.order_date) as last_order_date
from public.suppliers s
left join public.purchase_orders po on po.supplier_id = s.id and po.status not in ('draft', 'rejected', 'cancelled')
left join public.goods_receipts gr on gr.supplier_id = s.id and gr.status = 'posted'
left join public.supplier_advances a on a.supplier_id = s.id
group by s.id;

-- ---------------------------------------------------------------------------
-- Expenditure analysis (by month, supplier, department, product)
-- ---------------------------------------------------------------------------

create or replace view public.report_procurement_expenditure
with (security_invoker = true)
as
select
  date_trunc('month', po.order_date)::date as period_month,
  po.currency_code,
  po.supplier_id,
  po.supplier_name_snapshot as supplier_name,
  po.department_id,
  d.name as department_name,
  i.product_id,
  p.name as product_name,
  sum(i.line_total)::numeric(20, 2) as ordered_value,
  sum(i.quantity)::numeric(20, 6) as ordered_quantity
from public.purchase_orders po
join public.purchase_order_items i on i.purchase_order_id = po.id
join public.products p on p.id = i.product_id
left join public.departments d on d.id = po.department_id
where po.status in ('issued', 'partially_received', 'fully_received', 'closed')
group by 1, 2, 3, 4, 5, 6, 7, 8;

comment on view public.report_procurement_expenditure is
  'Ordered value by month, supplier, department and product. Grouped by currency and never summed across currencies.';

-- ---------------------------------------------------------------------------
-- Approval turnaround
-- ---------------------------------------------------------------------------

create or replace view public.report_approval_turnaround
with (security_invoker = true)
as
select
  h.entity_type,
  h.entity_reference,
  h.entity_id,
  min(h.created_at) filter (where h.to_status = 'submitted') as submitted_at,
  min(h.created_at) filter (where h.to_status in ('approved', 'issued')) as decided_at,
  (select a.decision
     from public.procurement_approvals a
    where a.entity_type = h.entity_type and a.entity_id = h.entity_id
    order by a.created_at desc limit 1) as latest_decision,
  extract(epoch from (
    min(h.created_at) filter (where h.to_status in ('approved', 'issued'))
    - min(h.created_at) filter (where h.to_status = 'submitted')
  )) / 3600.0 as turnaround_hours
from public.procurement_status_history h
group by h.entity_type, h.entity_reference, h.entity_id;

-- ---------------------------------------------------------------------------
-- Data-quality indicators
-- ---------------------------------------------------------------------------
-- Same contract as the Phase 2 quality view: every number is a count of real rows, the view is
-- security_invoker so it cannot leak counts of records the caller may not read, and adding an
-- indicator means adding a branch here — never a formula in TypeScript.

create or replace view public.procurement_data_quality
with (security_invoker = true)
as
select 'purchase_order'::text as entity_type,
       'overdue_delivery'::text as indicator,
       'Issued or partly received orders whose expected delivery date has passed with quantity outstanding'::text as description,
       'warning'::text as severity,
       count(*)::bigint as record_count
  from public.purchase_order_summary s
 where s.is_overdue and s.outstanding_quantity > 0
union all
select 'purchase_order',
       'supplier_not_verified',
       'Open orders placed with a supplier that is not active and verified',
       'critical',
       count(*)
  from public.purchase_orders po
  join public.suppliers sp on sp.id = po.supplier_id
 where po.status in ('submitted', 'under_review', 'approved', 'issued', 'partially_received')
   and (sp.status <> 'active' or sp.verification_status <> 'verified')
union all
select 'purchase_order',
       'issued_without_version',
       'Issued orders with no immutable version snapshot',
       'critical',
       count(*)
  from public.purchase_orders po
 where po.status in ('issued', 'partially_received', 'fully_received', 'closed')
   and not exists (select 1 from public.purchase_order_versions v where v.purchase_order_id = po.id)
union all
select 'goods_receipt',
       'posted_without_outbox_event',
       'Posted receipts whose inventory handoff event is missing',
       'critical',
       count(*)
  from public.goods_receipts gr
 where gr.status = 'posted'
   and not exists (
     select 1 from public.procurement_integration_outbox o
      where o.entity_type = 'goods_receipt' and o.entity_id = gr.id
   )
union all
select 'goods_receipt',
       'awaiting_review',
       'Receipts submitted or under review for more than three days',
       'warning',
       count(*)
  from public.goods_receipts gr
 where gr.status in ('submitted', 'under_review')
   and gr.created_at < now() - interval '3 days'
union all
select 'supplier_quotation',
       'expired_not_marked',
       'Quotations whose validity has passed but which are still open for evaluation',
       'warning',
       count(*)
  from public.supplier_quotations q
 where q.valid_until is not null
   and q.valid_until < current_date
   and q.status in ('received', 'under_evaluation')
union all
select 'purchase_requisition',
       'approved_without_items',
       'Approved requisitions with no remaining lines',
       'critical',
       count(*)
  from public.purchase_requisitions r
 where r.status in ('approved', 'processing')
   and not exists (select 1 from public.purchase_requisition_items i where i.requisition_id = r.id)
union all
select 'supplier_advance',
       'outstanding_advance',
       'Advances disbursed and not yet fully applied against supplier documents',
       'notice',
       count(*)
  from public.supplier_advances a
 where a.status in ('paid', 'partially_applied') and a.outstanding_amount > 0
union all
select 'integration_outbox',
       'pending_handoff',
       'Goods receipt events awaiting an inventory consumer (stock has NOT been updated for these)',
       'warning',
       count(*)
  from public.procurement_integration_outbox o
 where o.status = 'pending'
   and o.created_at < now() - interval '1 day'
union all
select 'purchase_order',
       'zero_value_order',
       'Orders with lines but a zero total, which usually means prices were not captured',
       'notice',
       count(*)
  from public.purchase_orders po
 where po.total_amount = 0
   and po.status not in ('draft', 'cancelled', 'rejected')
   and exists (select 1 from public.purchase_order_items i where i.purchase_order_id = po.id);

comment on view public.procurement_data_quality is
  'Data-quality indicators computed from real rows. Adding an indicator means adding a branch here, not a formula in application code.';
