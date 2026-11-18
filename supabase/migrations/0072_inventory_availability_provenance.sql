-- 0072 — availability view carries the provenance a storekeeper needs
--
-- The lot detail page shows manufacture date, receipt date and grade beside the quantities, because "90 units
-- available" is not a decision anybody can act on without knowing how old it is and what grade it is. Rather
-- than joining `inventory_lots` again in the application (and giving two different pages two different ideas
-- of which fields exist), the columns are added to the availability view.
--
-- The quantity definition is unchanged: on hand − restricted − reserved.
--
-- The columns are appended at the end rather than inserted in the middle: `create or replace view` only
-- permits that, and it is the right constraint — two other views select from this one, and replacing the
-- column list would silently invalidate them.

create or replace view public.inventory_availability
with (security_invoker = true)
as
select
  b.lot_id,
  b.lot_reference,
  b.product_id,
  b.product_code,
  b.product_name,
  b.unit_id,
  b.unit_code,
  b.warehouse_id,
  b.warehouse_name,
  b.location_id,
  b.lot_status,
  b.supplier_id,
  b.goods_receipt_id,
  b.production_batch_id,
  b.expiry_date,
  b.on_hand_quantity,
  coalesce(r.restricted_quantity, 0) as restricted_quantity,
  coalesce(v.reserved_quantity, 0) as reserved_quantity,
  b.on_hand_quantity
    - coalesce(r.restricted_quantity, 0)
    - coalesce(v.reserved_quantity, 0) as available_quantity,
  coalesce(r.active_restriction_count, 0) as active_restriction_count,
  coalesce(v.active_reservation_count, 0) as active_reservation_count,
  b.received_date,
  -- Not on `inventory_lot_balances`, which is about quantities: these two come from the lot itself.
  l.manufacture_date,
  l.grade
from public.inventory_lot_balances b
join public.inventory_lots l on l.id = b.lot_id
left join (
  select
    rr.lot_id,
    sum(rr.quantity - rr.released_quantity) as restricted_quantity,
    count(*) as active_restriction_count
  from public.inventory_restrictions rr
  where rr.status in ('active', 'partially_released')
    and (rr.expires_at is null or rr.expires_at > now())
  group by rr.lot_id
) r on r.lot_id = b.lot_id
left join (
  select
    vv.lot_id,
    sum(vv.quantity - vv.released_quantity) as reserved_quantity,
    count(*) as active_reservation_count
  from public.inventory_reservations vv
  where vv.status in ('active', 'partially_released')
    and (vv.expires_at is null or vv.expires_at > now())
  group by vv.lot_id
) v on v.lot_id = b.lot_id;

comment on view public.inventory_availability is
  'on_hand − restricted − reserved, with the provenance needed to decide whether to use the stock. `available_quantity` is the only figure a reservation or an issue may act on.';
