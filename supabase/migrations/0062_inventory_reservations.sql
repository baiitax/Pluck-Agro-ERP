-- 0062 — stock reservations
--
-- A reservation is a claim on available quantity. It does not move stock: the goods are still there, they
-- are simply promised to something. Phase 5 and Phase 6 both need this — a quality-released lot must be
-- reservable by a sales order without being issued, and a production plan must be able to claim raw
-- material before it starts.
--
-- This migration also completes the availability definition. 0060 defined available = on hand − restricted;
-- from here available = on hand − restricted − reserved. Both deductions are derived on every read from
-- their own tables, so neither can drift from the ledger.

-- ---------------------------------------------------------------------------
-- 1. Reservations
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  quantity numeric(20, 6) not null,
  released_quantity numeric(20, 6) not null default 0,
  status text not null default 'active',
  status_reason text,
  -- Who the stock is being held for. Modules claim stock by reference; they do not edit the ledger.
  reserved_for_module text not null,
  reserved_for_type text not null,
  reserved_for_id uuid,
  reserved_for_reference text,
  expires_at timestamptz,
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null on update cascade,
  idempotency_key text unique,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reservations_reference_unique unique (reference),
  constraint inventory_reservations_quantity_positive check (quantity > 0),
  constraint inventory_reservations_released_range
    check (released_quantity >= 0 and released_quantity <= quantity),
  constraint inventory_reservations_status_check
    check (status in ('active', 'partially_released', 'released', 'expired', 'cancelled'))
);

create index if not exists inventory_reservations_lot_idx on public.inventory_reservations (lot_id, status);
create index if not exists inventory_reservations_target_idx
  on public.inventory_reservations (reserved_for_module, reserved_for_type, reserved_for_id);
create index if not exists inventory_reservations_active_idx
  on public.inventory_reservations (status, expires_at);

comment on table public.inventory_reservations is
  'A claim on available quantity that does not move stock. Expired reservations stop reducing availability on read, and are marked expired by the reporting sweep rather than by a background job this deployment does not have.';

drop trigger if exists inventory_reservations_set_updated_at on public.inventory_reservations;
create trigger inventory_reservations_set_updated_at
  before update on public.inventory_reservations
  for each row execute function private.set_updated_at();

create or replace function private.set_inventory_reservation_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lot public.inventory_lots;
  expiry_days numeric := private.inventory_setting_numeric('reservation_expiry_days');
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := private.next_inventory_reference('inventory_reservation');
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.expires_at is null and expiry_days is not null and expiry_days > 0 then
    new.expires_at := now() + (expiry_days || ' days')::interval;
  end if;

  select * into lot from public.inventory_lots where id = new.lot_id;
  if lot.id is null then
    raise exception 'A reservation must reference an existing lot' using errcode = 'check_violation';
  end if;
  if new.product_id <> lot.product_id or new.unit_id <> lot.unit_id or new.warehouse_id <> lot.warehouse_id then
    raise exception 'A reservation must match its lot product, unit and warehouse'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_reservations_defaults on public.inventory_reservations;
create trigger inventory_reservations_defaults
  before insert on public.inventory_reservations
  for each row execute function private.set_inventory_reservation_defaults();

drop trigger if exists inventory_reservations_status_guard on public.inventory_reservations;
create trigger inventory_reservations_status_guard
  before update on public.inventory_reservations
  for each row execute function private.guard_inventory_status('stock_reservation', 'reference');

-- ---------------------------------------------------------------------------
-- 2. Availability now also subtracts reservations
-- ---------------------------------------------------------------------------
-- Replaced rather than joined into every caller: one definition, one place to change. A reservation whose
-- expiry has passed no longer reduces availability, so stock does not sit unusable because nobody swept a
-- document.

create or replace function private.inventory_lot_available(p_lot_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(case when m.direction = 'in' then m.quantity else -m.quantity end)
      from public.inventory_movements m
     where m.lot_id = p_lot_id
  ), 0)
  - coalesce((
    select sum(r.quantity - r.released_quantity)
      from public.inventory_restrictions r
     where r.lot_id = p_lot_id
       and r.status in ('active', 'partially_released')
       and (r.expires_at is null or r.expires_at > now())
  ), 0)
  - coalesce((
    select sum(v.quantity - v.released_quantity)
      from public.inventory_reservations v
     where v.lot_id = p_lot_id
       and v.status in ('active', 'partially_released')
       and (v.expires_at is null or v.expires_at > now())
  ), 0);
$$;

-- The view's column list changes, so it is dropped and recreated rather than replaced in place: adding a
-- column to a view is fine, but redefining the meaning of an existing one is worth making explicit.
drop view if exists public.inventory_availability;

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
  coalesce(v.active_reservation_count, 0) as active_reservation_count
from public.inventory_lot_balances b
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
  'on_hand − restricted − reserved. `available_quantity` is the only figure a reservation or an issue may act on.';

-- ---------------------------------------------------------------------------
-- 3. Reserving and releasing
-- ---------------------------------------------------------------------------

/**
 * Records a reservation against a lot.
 *
 * Refuses to reserve more than is currently available, and refuses when the lot is closed. Idempotent on
 * the supplied key so a retried claim from another module cannot double-book the same stock.
 */
create or replace function public.inventory_reserve_stock(
  p_lot_id uuid,
  p_quantity numeric,
  p_reserved_for_module text,
  p_reserved_for_type text,
  p_reserved_for_id uuid default null,
  p_reserved_for_reference text default null,
  p_idempotency_key text default null,
  p_notes text default null,
  p_expires_at timestamptz default null
)
returns public.inventory_reservations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  lot public.inventory_lots;
  existing public.inventory_reservations;
  available numeric;
  created public.inventory_reservations;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A reservation quantity must be greater than zero' using errcode = 'check_violation';
  end if;

  if p_idempotency_key is not null then
    select * into existing from public.inventory_reservations where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return existing;
    end if;
  end if;

  select * into lot from public.inventory_lots where id = p_lot_id for update;
  if lot.id is null then
    raise exception 'That lot does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if lot.status <> 'open' then
    raise exception 'Lot % is %, so stock cannot be reserved against it', lot.lot_reference, lot.status
      using errcode = 'check_violation';
  end if;

  available := private.inventory_lot_available(p_lot_id);
  if p_quantity > available then
    raise exception 'Cannot reserve % in lot %: only % is available',
      p_quantity, lot.lot_reference, available
      using errcode = 'check_violation';
  end if;

  insert into public.inventory_reservations
    (lot_id, product_id, unit_id, warehouse_id, quantity, reserved_for_module, reserved_for_type,
     reserved_for_id, reserved_for_reference, idempotency_key, notes, expires_at, created_by)
  values
    (lot.id, lot.product_id, lot.unit_id, lot.warehouse_id, p_quantity, p_reserved_for_module, p_reserved_for_type,
     p_reserved_for_id, p_reserved_for_reference, p_idempotency_key, p_notes, p_expires_at, auth.uid())
  returning * into created;

  return created;
end;
$$;

/**
 * Releases part or all of a reservation.
 *
 * The resulting status is derived from the arithmetic, not supplied by the caller: a reservation cannot be
 * marked released while quantity remains reserved.
 */
create or replace function public.inventory_release_reservation(
  p_reservation_id uuid,
  p_quantity numeric,
  p_reason text
)
returns public.inventory_reservations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  reservation public.inventory_reservations;
  remaining numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A release quantity must be greater than zero' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Releasing a reservation requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into reservation from public.inventory_reservations where id = p_reservation_id for update;
  if reservation.id is null then
    raise exception 'That reservation does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if reservation.status not in ('active', 'partially_released') then
    raise exception 'Reservation % is %, so there is nothing to release',
      reservation.reference, reservation.status
      using errcode = 'check_violation';
  end if;

  remaining := reservation.quantity - reservation.released_quantity;
  if p_quantity > remaining then
    raise exception 'Cannot release % from reservation %: only % remains reserved',
      p_quantity, reservation.reference, remaining
      using errcode = 'check_violation';
  end if;

  update public.inventory_reservations
     set released_quantity = released_quantity + p_quantity,
         status = case when released_quantity + p_quantity = quantity then 'released' else 'partially_released' end,
         status_reason = p_reason,
         released_at = case when released_quantity + p_quantity = quantity then now() else released_at end,
         released_by = auth.uid(),
         updated_at = now()
   where id = p_reservation_id
  returning * into reservation;

  return reservation;
end;
$$;

/**
 * Marks reservations whose expiry has passed as expired.
 *
 * There is no scheduler in this deployment, so this is called by the reporting sweep. Availability does not
 * depend on it: an expired reservation already stops counting, because the availability view filters on
 * `expires_at > now()`. This function exists to make the register honest, not to make the arithmetic work.
 */
create or replace function public.inventory_expire_reservations()
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  expired int;
begin
  update public.inventory_reservations
     set status = 'expired',
         status_reason = 'Reservation passed its expiry without being used',
         updated_at = now()
   where status in ('active', 'partially_released')
     and expires_at is not null
     and expires_at <= now();

  get diagnostics expired = row_count;
  return expired;
end;
$$;

comment on function public.inventory_reserve_stock(uuid, numeric, text, text, uuid, text, text, text, timestamptz) is
  'Claims available quantity in a lot without moving stock. Idempotent on the supplied key.';
comment on function public.inventory_release_reservation(uuid, numeric, text) is
  'Releases part or all of a reservation with a mandatory reason; derives the status from the arithmetic.';

grant execute on function public.inventory_reserve_stock(uuid, numeric, text, text, uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.inventory_release_reservation(uuid, numeric, text) to authenticated;
grant execute on function public.inventory_expire_reservations() to authenticated;
