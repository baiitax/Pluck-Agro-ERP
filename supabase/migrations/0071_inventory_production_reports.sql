-- 0071 — inventory and production reporting views
--
-- Every view here is `security_invoker = true`: the caller's own row-level security applies, so a view can
-- never be a way around a policy. Every figure is derived from posted movements or from the documents
-- themselves — nothing is cached, and no view stores a balance.
--
-- One deliberate omission: there is no valuation report. The system records the cost stated by each source
-- document, but choosing a valuation method (FIFO, weighted average, standard cost) is a company decision
-- that has not been made, so no view presents a stock value as if one had been.

-- ---------------------------------------------------------------------------
-- 1. Stock on hand by product and warehouse
-- ---------------------------------------------------------------------------

create or replace view public.inventory_stock_summary
with (security_invoker = true)
as
select
  a.product_id,
  a.product_code,
  a.product_name,
  a.unit_id,
  a.unit_code,
  a.warehouse_id,
  a.warehouse_name,
  count(*) filter (where a.on_hand_quantity <> 0) as lot_count,
  sum(a.on_hand_quantity) as on_hand_quantity,
  sum(a.restricted_quantity) as restricted_quantity,
  sum(a.reserved_quantity) as reserved_quantity,
  sum(a.available_quantity) as available_quantity,
  min(a.expiry_date) filter (where a.on_hand_quantity > 0) as earliest_expiry_date
from public.inventory_availability a
group by a.product_id, a.product_code, a.product_name, a.unit_id, a.unit_code,
         a.warehouse_id, a.warehouse_name;

comment on view public.inventory_stock_summary is
  'On hand / restricted / reserved / available per product and warehouse, summed from the same availability definition the RPCs enforce.';

-- ---------------------------------------------------------------------------
-- 2. Movement register
-- ---------------------------------------------------------------------------

create or replace view public.inventory_movement_register
with (security_invoker = true)
as
select
  m.id,
  m.movement_reference,
  m.movement_date,
  m.posted_at,
  m.movement_type,
  m.direction,
  m.quantity,
  m.product_id,
  p.code as product_code,
  p.name as product_name,
  m.unit_id,
  u.code as unit_code,
  m.warehouse_id,
  w.name as warehouse_name,
  m.lot_id,
  l.lot_reference,
  m.source_module,
  m.source_type,
  m.source_id,
  m.source_reference,
  m.reverses_movement_id,
  m.reason,
  m.posted_by,
  pr.display_name as posted_by_name
from public.inventory_movements m
join public.products p on p.id = m.product_id
join public.units_of_measure u on u.id = m.unit_id
join public.warehouses w on w.id = m.warehouse_id
join public.inventory_lots l on l.id = m.lot_id
left join public.profiles pr on pr.id = m.posted_by;

comment on view public.inventory_movement_register is
  'The ledger as an auditor reads it: every movement with its source document and the person who posted it.';

-- ---------------------------------------------------------------------------
-- 3. Expiry exposure
-- ---------------------------------------------------------------------------

create or replace view public.inventory_expiring_lots
with (security_invoker = true)
as
select
  a.lot_id,
  a.lot_reference,
  a.product_id,
  a.product_code,
  a.product_name,
  a.warehouse_id,
  a.warehouse_name,
  a.on_hand_quantity,
  a.available_quantity,
  a.expiry_date,
  (a.expiry_date - current_date) as days_to_expiry,
  case
    when a.expiry_date < current_date then 'expired'
    when a.expiry_date - current_date <= 30 then 'within_30_days'
    when a.expiry_date - current_date <= 90 then 'within_90_days'
    else 'later'
  end as expiry_band
from public.inventory_availability a
where a.expiry_date is not null
  and a.on_hand_quantity > 0;

comment on view public.inventory_expiring_lots is
  'Lots with stock and a stated expiry, banded for the storekeeper. A null expiry is simply absent rather than guessed.';

-- ---------------------------------------------------------------------------
-- 4. Restrictions and reservations in force
-- ---------------------------------------------------------------------------

create or replace view public.inventory_restriction_register
with (security_invoker = true)
as
select
  r.id,
  r.restriction_reference,
  r.lot_id,
  l.lot_reference,
  r.product_id,
  p.code as product_code,
  p.name as product_name,
  r.quantity,
  r.released_quantity,
  (r.quantity - r.released_quantity) as outstanding_quantity,
  r.restriction_type,
  r.reason_code,
  r.reason,
  r.status,
  r.source_module,
  r.source_type,
  r.source_id,
  r.expires_at,
  r.created_at,
  r.released_at
from public.inventory_restrictions r
join public.inventory_lots l on l.id = r.lot_id
join public.products p on p.id = r.product_id;

create or replace view public.inventory_reservation_register
with (security_invoker = true)
as
select
  v.id,
  v.reference,
  v.lot_id,
  l.lot_reference,
  v.product_id,
  p.code as product_code,
  p.name as product_name,
  v.warehouse_id,
  w.name as warehouse_name,
  v.quantity,
  v.released_quantity,
  (v.quantity - v.released_quantity) as outstanding_quantity,
  v.status,
  v.reserved_for_module,
  v.reserved_for_type,
  v.reserved_for_id,
  v.reserved_for_reference,
  v.expires_at,
  v.created_at
from public.inventory_reservations v
join public.inventory_lots l on l.id = v.lot_id
join public.products p on p.id = v.product_id
join public.warehouses w on w.id = v.warehouse_id;

comment on view public.inventory_restriction_register is
  'Holds, quarantines and inspection restrictions with the quantity still outstanding, so a reader never has to subtract by hand.';
comment on view public.inventory_reservation_register is
  'Claims on available stock with what is still outstanding, including which module made the claim.';

-- ---------------------------------------------------------------------------
-- 5. Production
-- ---------------------------------------------------------------------------

create or replace view public.production_batch_summary
with (security_invoker = true)
as
select
  b.id,
  b.reference,
  b.status,
  b.batch_date,
  b.plan_id,
  pl.reference as plan_reference,
  b.product_id,
  p.code as product_code,
  p.name as product_name,
  b.unit_id,
  u.code as unit_code,
  b.warehouse_id,
  w.name as warehouse_name,
  b.planned_quantity,
  b.issued_quantity,
  b.output_quantity,
  b.waste_quantity,
  b.recorded_yield_percent,
  b.recorded_yield_basis,
  b.within_declared_band,
  b.started_at,
  b.completed_at,
  b.closed_at
from public.production_batches b
join public.products p on p.id = b.product_id
join public.units_of_measure u on u.id = b.unit_id
join public.warehouses w on w.id = b.warehouse_id
left join public.production_plans pl on pl.id = b.plan_id;

create or replace view public.production_plan_progress
with (security_invoker = true)
as
select
  pl.id,
  pl.reference,
  pl.status,
  pl.planned_date,
  pl.product_id,
  p.code as product_code,
  p.name as product_name,
  pl.unit_id,
  u.code as unit_code,
  pl.planned_quantity,
  pl.produced_quantity,
  pl.batch_count,
  greatest(pl.planned_quantity - pl.produced_quantity, 0) as outstanding_quantity,
  case
    when pl.planned_quantity > 0 then round((pl.produced_quantity / pl.planned_quantity) * 100, 2)
    else null
  end as progress_percent,
  (
    select count(*) from public.production_batches b
     where b.plan_id = pl.id and b.status in ('in_progress', 'completed')
  ) as open_batch_count
from public.production_plans pl
join public.products p on p.id = pl.product_id
join public.units_of_measure u on u.id = pl.unit_id;

create or replace view public.production_material_consumption
with (security_invoker = true)
as
select
  m.batch_id,
  b.reference as batch_reference,
  b.batch_date,
  m.product_id,
  p.code as product_code,
  p.name as product_name,
  m.unit_id,
  u.code as unit_code,
  sum(m.quantity) as consumed_quantity,
  count(*) as issue_count,
  count(distinct m.lot_id) as lot_count
from public.production_batch_materials m
join public.production_batches b on b.id = m.batch_id
join public.products p on p.id = m.product_id
join public.units_of_measure u on u.id = m.unit_id
group by m.batch_id, b.reference, b.batch_date, m.product_id, p.code, p.name, m.unit_id, u.code;

create or replace view public.production_yield_summary
with (security_invoker = true)
as
select
  b.product_id,
  p.code as product_code,
  p.name as product_name,
  date_trunc('month', b.batch_date)::date as period_month,
  count(*) as closed_batch_count,
  sum(b.issued_quantity) as total_issued_quantity,
  sum(b.output_quantity) as total_output_quantity,
  sum(b.waste_quantity) as total_waste_quantity,
  avg(b.recorded_yield_percent) filter (where b.recorded_yield_basis = 'same_unit') as average_recorded_yield_percent,
  min(b.recorded_yield_percent) filter (where b.recorded_yield_basis = 'same_unit') as lowest_recorded_yield_percent,
  max(b.recorded_yield_percent) filter (where b.recorded_yield_basis = 'same_unit') as highest_recorded_yield_percent,
  count(*) filter (where b.within_declared_band is false) as batches_outside_declared_band,
  count(*) filter (where b.recorded_yield_basis = 'mixed_units') as batches_without_comparable_yield
from public.production_batches b
join public.products p on p.id = b.product_id
where b.status = 'closed'
group by b.product_id, p.code, p.name, date_trunc('month', b.batch_date)::date;

comment on view public.production_yield_summary is
  'Yield as observed on closed batches, per product and month. Figures come from recorded quantities only; no expected yield is assumed. Batches whose input and output units differ are counted separately instead of being averaged into a misleading number.';

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

grant select on
  public.inventory_stock_summary,
  public.inventory_movement_register,
  public.inventory_expiring_lots,
  public.inventory_restriction_register,
  public.inventory_reservation_register,
  public.production_batch_summary,
  public.production_plan_progress,
  public.production_material_consumption,
  public.production_yield_summary
  to authenticated;
