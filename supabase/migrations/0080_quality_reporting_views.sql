-- 0080 — quality reporting views
--
-- Every view is `security_invoker = true`, so the caller's own row-level security applies and a view can never be
-- a way around a policy. Nothing here is cached and nothing here stores a judgement: each figure is derived from
-- the documents, the results and — for anything about availability — Phase 4's own availability view.
--
-- One deliberate omission, the same one Phase 4 made about valuation: there is no "quality score" or supplier
-- rating. A number computed from a weighting nobody agreed would be trusted and then be wrong.

-- ---------------------------------------------------------------------------
-- 1. Specification register
-- ---------------------------------------------------------------------------

create or replace view public.quality_specification_register
with (security_invoker = true)
as
select
  s.id,
  s.reference,
  s.product_id,
  p.code as product_code,
  p.name as product_name,
  s.stage,
  s.version,
  s.status,
  s.effective_from,
  s.effective_to,
  s.approved_at,
  approver.display_name as approved_by_name,
  s.supersedes_id,
  prior.reference as supersedes_reference,
  (select count(*) from public.quality_specification_parameters sp where sp.specification_id = s.id) as parameter_count,
  (select count(*) from public.quality_specification_parameters sp
    where sp.specification_id = s.id and sp.is_mandatory) as mandatory_parameter_count,
  s.created_at
from public.quality_specifications s
join public.products p on p.id = s.product_id
left join public.profiles approver on approver.id = s.approved_by
left join public.quality_specifications prior on prior.id = s.supersedes_id;

comment on view public.quality_specification_register is
  'Approved and draft specification versions with their parameter counts and supersession chain.';

-- ---------------------------------------------------------------------------
-- 2. Inspection register
-- ---------------------------------------------------------------------------

create or replace view public.quality_inspection_register
with (security_invoker = true)
as
select
  i.id,
  i.reference,
  i.status,
  i.result_summary,
  i.stage,
  i.inspection_type,
  i.product_id,
  p.code as product_code,
  p.name as product_name,
  i.lot_id,
  l.lot_reference,
  i.production_batch_id,
  b.reference as batch_reference,
  i.specification_id,
  s.reference as specification_reference,
  s.version as specification_version,
  i.sampled_quantity,
  u.code as sample_unit_code,
  (select count(*) from public.quality_inspection_results r where r.inspection_id = i.id) as result_count,
  (select count(*) from public.quality_inspection_results r
    where r.inspection_id = i.id and r.conformance = 'non_conforming') as non_conforming_count,
  (select count(*) from public.quality_inspection_results r
    where r.inspection_id = i.id and r.conformance = 'not_evaluated') as not_evaluated_count,
  i.inspected_at,
  inspector.display_name as inspected_by_name,
  i.submitted_at,
  i.approved_at,
  approver.display_name as approved_by_name,
  d.id as disposition_id,
  d.reference as disposition_reference,
  d.disposition,
  c.id as certificate_id,
  c.reference as certificate_reference,
  i.created_at,
  i.updated_at
from public.quality_inspections i
join public.products p on p.id = i.product_id
join public.quality_specifications s on s.id = i.specification_id
left join public.inventory_lots l on l.id = i.lot_id
left join public.production_batches b on b.id = i.production_batch_id
left join public.units_of_measure u on u.id = i.sample_unit_id
left join public.profiles inspector on inspector.id = i.inspected_by
left join public.profiles approver on approver.id = i.approved_by
left join public.quality_dispositions d on d.inspection_id = i.id and d.status = 'recorded'
left join public.quality_certificates c on c.inspection_id = i.id and c.status = 'issued';

comment on view public.quality_inspection_register is
  'Inspections with their result counts, disposition and certificate, so the state of a quality decision is readable without joining four tables by hand.';

-- ---------------------------------------------------------------------------
-- 3. Lot quality status — the answer to "may I use this stock?"
-- ---------------------------------------------------------------------------
-- This view does not decide availability; Phase 4 already does, from the restrictions these documents create.
-- What it adds is the reason a reader can understand: which disposition, which hold, which certificate.

create or replace view public.quality_lot_status
with (security_invoker = true)
as
select
  l.id as lot_id,
  l.lot_reference,
  l.product_id,
  p.code as product_code,
  p.name as product_name,
  l.warehouse_id,
  w.name as warehouse_name,
  l.status as lot_status,
  a.on_hand_quantity,
  a.restricted_quantity,
  a.available_quantity,
  a.active_restriction_count,
  latest.id as latest_inspection_id,
  latest.reference as latest_inspection_reference,
  latest.status as latest_inspection_status,
  latest.result_summary,
  spec.reference as specification_reference,
  decision.id as disposition_id,
  decision.reference as disposition_reference,
  decision.disposition,
  decision.decided_at,
  cert.id as certificate_id,
  cert.reference as certificate_reference,
  open_holds.open_hold_count,
  open_holds.held_quantity,
  case
    when decision.disposition = 'release' and coalesce(a.available_quantity, 0) > 0 then 'released'
    when decision.disposition in ('reject', 'quarantine') then 'rejected'
    when decision.disposition in ('hold', 'rework', 'downgrade') then 'held'
    when decision.id is not null then decision.disposition
    when latest.id is not null and latest.status in ('draft', 'in_progress', 'submitted') then 'pending_inspection'
    when coalesce(a.restricted_quantity, 0) > 0 then 'restricted'
    else 'not_inspected'
  end as quality_status
from public.inventory_lots l
join public.products p on p.id = l.product_id
join public.warehouses w on w.id = l.warehouse_id
left join public.inventory_availability a on a.lot_id = l.id
left join lateral (
  select i.*
    from public.quality_inspections i
   where i.lot_id = l.id
   order by i.created_at desc
   limit 1
) latest on true
left join public.quality_specifications spec on spec.id = latest.specification_id
left join lateral (
  select d.*
    from public.quality_dispositions d
   where d.lot_id = l.id and d.status = 'recorded'
   order by d.decided_at desc
   limit 1
) decision on true
left join lateral (
  select c.*
    from public.quality_certificates c
   where c.lot_id = l.id and c.status = 'issued'
   order by c.issued_at desc
   limit 1
) cert on true
left join lateral (
  select count(*) as open_hold_count, sum(h.quantity) as held_quantity
    from public.quality_holds h
   where h.lot_id = l.id and h.released_at is null and h.restriction_state = 'confirmed'
) open_holds on true;

comment on view public.quality_lot_status is
  'Per-lot quality position: latest inspection, latest disposition, open holds and certificate. Availability figures come from Phase 4 and are never recomputed here.';

-- ---------------------------------------------------------------------------
-- 4. Release register
-- ---------------------------------------------------------------------------

create or replace view public.quality_release_register
with (security_invoker = true)
as
select
  d.id,
  d.reference,
  d.disposition,
  d.quantity,
  u.code as unit_code,
  d.decided_at,
  decider.display_name as decided_by_name,
  d.reason,
  d.instruction,
  d.status,
  d.lot_id,
  l.lot_reference,
  d.product_id,
  p.code as product_code,
  p.name as product_name,
  i.id as inspection_id,
  i.reference as inspection_reference,
  i.result_summary,
  s.reference as specification_reference,
  c.reference as certificate_reference
from public.quality_dispositions d
join public.inventory_lots l on l.id = d.lot_id
join public.products p on p.id = d.product_id
join public.units_of_measure u on u.id = d.unit_id
join public.quality_inspections i on i.id = d.inspection_id
join public.quality_specifications s on s.id = i.specification_id
left join public.profiles decider on decider.id = d.decided_by
left join public.quality_certificates c on c.disposition_id = d.id and c.status = 'issued';

comment on view public.quality_release_register is
  'Every disposition recorded, with the inspection and specification that justified it. Release decisions are readable here and nowhere else claimed.';

-- ---------------------------------------------------------------------------
-- 5. Holds that are actually holding stock
-- ---------------------------------------------------------------------------

create or replace view public.quality_open_holds
with (security_invoker = true)
as
select
  h.id,
  h.reference,
  h.lot_id,
  l.lot_reference,
  l.product_id,
  p.code as product_code,
  p.name as product_name,
  h.quantity,
  u.code as unit_code,
  h.reason_code,
  h.reason,
  h.restriction_state,
  h.failure_reason,
  h.restriction_id,
  r.status as restriction_status,
  r.quantity - r.released_quantity as restricted_quantity,
  h.inspection_id,
  i.reference as inspection_reference,
  h.created_at,
  creator.display_name as created_by_name
from public.quality_holds h
join public.inventory_lots l on l.id = h.lot_id
join public.products p on p.id = l.product_id
join public.units_of_measure u on u.id = l.unit_id
left join public.inventory_restrictions r on r.id = h.restriction_id
left join public.quality_inspections i on i.id = h.inspection_id
left join public.profiles creator on creator.id = h.created_by
where h.released_at is null;

comment on view public.quality_open_holds is
  'Quality holds with `restriction_state` shown as it is: a hold that failed to restrict anything says so, and its restricted quantity is null rather than a comforting zero.';

-- ---------------------------------------------------------------------------
-- 6. Non-conformance and CAPA registers
-- ---------------------------------------------------------------------------

create or replace view public.quality_ncr_register
with (security_invoker = true)
as
select
  n.id,
  n.reference,
  n.status,
  n.severity,
  n.source,
  n.title,
  n.description,
  n.containment_action,
  n.root_cause,
  n.status_reason,
  n.detected_at,
  detector.display_name as detected_by_name,
  n.lot_id,
  l.lot_reference,
  l.product_id,
  n.inspection_id,
  i.reference as inspection_reference,
  n.production_batch_id,
  b.reference as batch_reference,
  n.supplier_id,
  sup.legal_name as supplier_name,
  n.closed_at,
  (select count(*) from public.quality_capa_actions a where a.ncr_id = n.id) as action_count,
  (select count(*) from public.quality_capa_actions a where a.ncr_id = n.id and a.status in ('open', 'in_progress')) as open_action_count
from public.quality_ncrs n
left join public.inventory_lots l on l.id = n.lot_id
left join public.quality_inspections i on i.id = n.inspection_id
left join public.production_batches b on b.id = n.production_batch_id
left join public.suppliers sup on sup.id = n.supplier_id
left join public.profiles detector on detector.id = n.detected_by;

create or replace view public.quality_capa_register
with (security_invoker = true)
as
select
  a.id,
  a.reference,
  a.action_type,
  a.title,
  a.status,
  a.due_date,
  a.completed_at,
  a.verified_at,
  nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), '') as owner_name,
  a.ncr_id,
  n.reference as ncr_reference,
  n.severity as ncr_severity,
  case
    when a.status in ('open', 'in_progress') and a.due_date is not null and a.due_date < current_date then true
    else false
  end as overdue
from public.quality_capa_actions a
left join public.quality_ncrs n on n.id = a.ncr_id
left join public.employees e on e.id = a.owner_employee_id;

-- ---------------------------------------------------------------------------
-- 7. Certificate register
-- ---------------------------------------------------------------------------

create or replace view public.quality_certificate_register
with (security_invoker = true)
as
select
  c.id,
  c.reference,
  c.status,
  c.version,
  c.issued_at,
  issuer.display_name as issued_by_name,
  c.lot_id,
  l.lot_reference,
  c.product_id,
  p.code as product_code,
  p.name as product_name,
  c.customer_id,
  cust.legal_name as customer_name,
  c.issued_to,
  c.inspection_id,
  i.reference as inspection_reference,
  c.disposition_id,
  d.reference as disposition_reference,
  c.laboratory_name,
  c.accreditation_reference,
  c.supersedes_id,
  prior.reference as supersedes_reference
from public.quality_certificates c
join public.inventory_lots l on l.id = c.lot_id
join public.products p on p.id = c.product_id
join public.quality_inspections i on i.id = c.inspection_id
join public.quality_dispositions d on d.id = c.disposition_id
left join public.customers cust on cust.id = c.customer_id
left join public.profiles issuer on issuer.id = c.issued_by
left join public.quality_certificates prior on prior.id = c.supersedes_id;

-- ---------------------------------------------------------------------------
-- 8. Traceability
-- ---------------------------------------------------------------------------
-- Backward: what went into this lot. Forward: where a lot went. Both are read from the Phase 4 ledger and the
-- production records, so what is shown is what was posted — not a reconstruction from paperwork.

create or replace view public.quality_lot_traceability
with (security_invoker = true)
as
with lot_movements as (
  select
    m.lot_id,
    m.id as movement_id,
    m.movement_reference,
    m.movement_type,
    m.direction,
    m.quantity,
    m.movement_date,
    m.source_module,
    m.source_type,
    m.source_id,
    m.source_reference,
    m.reverses_movement_id
  from public.inventory_movements m
)
select
  l.id as lot_id,
  l.lot_reference,
  l.product_id,
  p.code as product_code,
  p.name as product_name,
  l.received_date,
  l.production_batch_id,
  b.reference as batch_reference,
  -- Upstream: the batch whose output created this lot, and the material issued into that batch.
  (select jsonb_agg(jsonb_build_object(
            'lot_reference', il.lot_reference,
            'quantity', bm.quantity,
            'issued_at', bm.issued_at,
            'product_code', ip.code))
     from public.production_batch_materials bm
     join public.inventory_lots il on il.id = bm.lot_id
     join public.products ip on ip.id = bm.product_id
    where bm.batch_id = l.production_batch_id) as inputs,
  -- Downstream: the batches that consumed this lot.
  (select jsonb_agg(jsonb_build_object(
            'batch_reference', cb.reference,
            'quantity', cm.quantity,
            'issued_at', cm.issued_at))
     from public.production_batch_materials cm
     join public.production_batches cb on cb.id = cm.batch_id
    where cm.lot_id = l.id) as consumed_by_batches,
  -- Downstream: transfers and adjustments that moved this lot.
  (select jsonb_agg(jsonb_build_object(
            'movement_reference', mv.movement_reference,
            'movement_type', mv.movement_type,
            'direction', mv.direction,
            'quantity', mv.quantity,
            'movement_date', mv.movement_date,
            'source_reference', mv.source_reference))
     from lot_movements mv
    where mv.lot_id = l.id) as movements,
  -- Quality evidence attached to the lot.
  (select jsonb_agg(jsonb_build_object(
            'inspection_reference', qi.reference,
            'status', qi.status,
            'result_summary', qi.result_summary,
            'created_at', qi.created_at))
     from public.quality_inspections qi
    where qi.lot_id = l.id) as inspections,
  (select jsonb_agg(jsonb_build_object(
            'disposition_reference', qd.reference,
            'disposition', qd.disposition,
            'decided_at', qd.decided_at))
     from public.quality_dispositions qd
    where qd.lot_id = l.id) as dispositions,
  (select jsonb_agg(jsonb_build_object(
            'certificate_reference', qc.reference,
            'status', qc.status,
            'issued_at', qc.issued_at))
     from public.quality_certificates qc
    where qc.lot_id = l.id) as certificates
from public.inventory_lots l
join public.products p on p.id = l.product_id
left join public.production_batches b on b.id = l.production_batch_id;

comment on view public.quality_lot_traceability is
  'Per-lot traceability: upstream material and batch, downstream consumption and movements, plus the quality evidence. Built from posted records only.';

-- ---------------------------------------------------------------------------
-- 9. Quality dashboard figures
-- ---------------------------------------------------------------------------

create or replace view public.quality_dashboard_summary
with (security_invoker = true)
as
select
  (select count(*) from public.quality_inspections where status in ('draft', 'in_progress')) as inspections_in_progress,
  (select count(*) from public.quality_inspections where status = 'submitted') as inspections_awaiting_approval,
  (select count(*) from public.quality_inspections where status = 'approved' and result_summary = 'non_conforming') as approved_non_conforming,
  (select count(*) from public.quality_holds where released_at is null and restriction_state = 'confirmed') as open_holds,
  (select count(*) from public.quality_holds where released_at is null and restriction_state = 'failed') as failed_holds,
  (select count(*) from public.quality_ncrs where status in ('open', 'investigating')) as open_ncrs,
  (select count(*) from public.quality_capa_actions where status in ('open', 'in_progress')) as open_capa_actions,
  (select count(*) from public.quality_capa_actions
    where status in ('open', 'in_progress') and due_date is not null and due_date < current_date) as overdue_capa_actions,
  (select count(*) from public.quality_certificates where status = 'issued') as certificates_issued,
  (select coalesce(sum(available_quantity), 0) from public.inventory_availability where available_quantity > 0) as total_available_quantity,
  (select coalesce(sum(restricted_quantity), 0) from public.inventory_availability) as total_restricted_quantity;

comment on view public.quality_dashboard_summary is
  'Counts of inspections, holds, NCRs and certificates, plus availability totals taken from the ledger. `failed_holds` is shown deliberately: a hold that did not take effect is a defect, not a rounding error.';
