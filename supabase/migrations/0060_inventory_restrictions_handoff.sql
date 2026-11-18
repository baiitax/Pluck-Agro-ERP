-- 0060 — availability restrictions and the goods-receipt handoff
--
-- Two things live here, and they are the seam between Phase 3, Phase 4 and Phase 5.
--
-- 1. `inventory_restrictions` is Phase 4's availability contract. A restriction removes quantity from
--    what may be reserved or issued, without touching the ledger: the stock still exists, it just
--    cannot be used. Quality holds and quarantine (Phase 5) create rows here. This is why a quality
--    hold is not a text label — it is a row that a derived availability figure subtracts.
--
--    A restriction is never deleted. Releasing one records who released what quantity, when and why,
--    so the period during which stock was unavailable stays auditable. Partial release is supported
--    because Phase 5 requires it.
--
-- 2. The consumer for `procurement.goods_receipt.posted`. Phase 3 emits the event durably with status
--    `pending` and no consumer; this migration gives it one. Consuming is idempotent per receipt line,
--    so a retry cannot double-post stock. Accepted quantity becomes a lot; quarantined quantity becomes
--    a lot that is immediately restricted and is never auto-released; rejected quantity does NOT become
--    stock, because the company has not accepted it.

-- ---------------------------------------------------------------------------
-- 1. Settings the handoff depends on
-- ---------------------------------------------------------------------------

insert into public.inventory_settings (key, value_text, value_numeric, value_boolean, description)
values
  ('received_stock_requires_inspection', null, null, true,
   'When true, stock received against a goods receipt is created RESTRICTED pending inspection, so a received quantity is never automatically available for issue or reservation. Default true, because receiving is not inspection.'),
  ('received_stock_restriction_reason', 'pending_inspection', null, null,
   'Reason code applied to newly received stock while it awaits inspection. Phase 5 replaces this placeholder restriction with a real quality disposition.'),
  ('quarantined_receipt_reason', 'supplier_quarantine', null, null,
   'Reason code applied to quantity the receiver quarantined at the gate. A restriction with this code is never released automatically.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Availability restrictions
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_restrictions (
  id uuid primary key default gen_random_uuid(),
  restriction_reference text not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,

  restriction_type text not null default 'hold',
  reason_code text not null,
  reason text,

  quantity numeric(20, 6) not null,
  released_quantity numeric(20, 6) not null default 0,

  -- Which module asked for the restriction, and which record owns it. Phase 5 will use
  -- source_module = 'quality' with its quality_holds id.
  source_module text not null,
  source_type text not null,
  source_id uuid,

  -- Idempotency: applying the same restriction twice returns the existing row rather than doubling it.
  idempotency_key text not null unique,

  status text not null default 'active',
  status_reason text,
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null on update cascade,
  expires_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_restrictions_reference_unique unique (restriction_reference),
  constraint inventory_restrictions_quantity_positive check (quantity > 0),
  constraint inventory_restrictions_released_range
    check (released_quantity >= 0 and released_quantity <= quantity),
  constraint inventory_restrictions_type_check
    check (restriction_type in ('hold', 'quarantine', 'recall', 'count_freeze', 'pending_inspection')),
  constraint inventory_restrictions_status_check
    check (status in ('active', 'partially_released', 'released', 'cancelled')),
  constraint inventory_restrictions_status_shape
    check ((status = 'released' and released_quantity = quantity)
        or (status = 'partially_released' and released_quantity > 0 and released_quantity < quantity)
        or (status = 'active' and released_quantity = 0)
        or (status = 'cancelled')),
  constraint inventory_restrictions_reason_present check (length(btrim(reason_code)) > 0)
);

create index if not exists inventory_restrictions_lot_idx
  on public.inventory_restrictions (lot_id, status);
create index if not exists inventory_restrictions_source_idx
  on public.inventory_restrictions (source_module, source_type, source_id);
create index if not exists inventory_restrictions_active_idx
  on public.inventory_restrictions (status, created_at desc);

comment on table public.inventory_restrictions is
  'Quantity removed from availability without changing the ledger: quality holds, quarantine and similar. Never deleted; releasing records what was released. Phase 5 quality holds live here.';

drop trigger if exists inventory_restrictions_set_updated_at on public.inventory_restrictions;
create trigger inventory_restrictions_set_updated_at
  before update on public.inventory_restrictions
  for each row execute function private.set_updated_at();

create or replace function private.set_inventory_restriction_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.restriction_reference is null or btrim(new.restriction_reference) = '' then
    new.restriction_reference := private.next_inventory_reference('inventory_restriction');
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_restrictions_set_reference on public.inventory_restrictions;
create trigger inventory_restrictions_set_reference
  before insert on public.inventory_restrictions
  for each row execute function private.set_inventory_restriction_reference();

drop trigger if exists inventory_restrictions_status_guard on public.inventory_restrictions;
create trigger inventory_restrictions_status_guard
  before update on public.inventory_restrictions
  for each row execute function private.guard_inventory_status('inventory_restriction', 'restriction_reference');

-- ---------------------------------------------------------------------------
-- 3. Derived availability
-- ---------------------------------------------------------------------------
-- `private.inventory_lot_available` is the single definition of "how much of this lot may be used".
-- 0062 replaces it to also subtract live reservations; it is written as its own function precisely so
-- that later widening happens in one place rather than in every caller.

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
  ), 0);
$$;

revoke all on function private.inventory_lot_available(uuid) from public;
grant execute on function private.inventory_lot_available(uuid) to authenticated, service_role;

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
  b.on_hand_quantity - coalesce(r.restricted_quantity, 0) as available_quantity,
  coalesce(r.active_restriction_count, 0) as active_restriction_count
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
) r on r.lot_id = b.lot_id;

comment on view public.inventory_availability is
  'On hand less live restrictions. 0062 extends this to also subtract reservations. `available_quantity` is the only figure a reservation or issue may act on.';

-- ---------------------------------------------------------------------------
-- 4. Applying and releasing a restriction
-- ---------------------------------------------------------------------------

/**
 * Restricts quantity in a lot.
 *
 * Idempotent on `p_idempotency_key`: a second call with the same key returns the existing row instead of
 * restricting twice, which is what makes the Phase 5 hold integration safe to retry.
 *
 * Refuses to restrict more than is currently available. That refusal is the point: a hold larger than the
 * stock would otherwise "succeed" and leave the availability arithmetic nonsensical.
 */
create or replace function public.inventory_apply_restriction(
  p_lot_id uuid,
  p_quantity numeric,
  p_reason_code text,
  p_source_module text,
  p_source_type text,
  p_source_id uuid default null,
  p_idempotency_key text default null,
  p_reason text default null,
  p_restriction_type text default 'hold',
  p_expires_at timestamptz default null
)
returns public.inventory_restrictions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  lot public.inventory_lots;
  existing public.inventory_restrictions;
  available numeric;
  created public.inventory_restrictions;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A restriction quantity must be greater than zero' using errcode = 'check_violation';
  end if;

  if p_idempotency_key is not null then
    select * into existing from public.inventory_restrictions where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return existing;
    end if;
  end if;

  -- Lock the lot so two concurrent restrictions cannot both consume the same available quantity.
  select * into lot from public.inventory_lots where id = p_lot_id for update;
  if lot.id is null then
    raise exception 'That lot does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;

  available := private.inventory_lot_available(p_lot_id);
  if p_quantity > available then
    raise exception 'Cannot restrict % %: only % is available in lot %',
      p_quantity, lot.unit_id, available, lot.lot_reference
      using errcode = 'check_violation';
  end if;

  insert into public.inventory_restrictions
    (lot_id, product_id, unit_id, warehouse_id, restriction_type, reason_code, reason,
     quantity, source_module, source_type, source_id, idempotency_key, expires_at, created_by)
  values
    (lot.id, lot.product_id, lot.unit_id, lot.warehouse_id, p_restriction_type, p_reason_code, p_reason,
     p_quantity, p_source_module, p_source_type, p_source_id, p_idempotency_key, p_expires_at, auth.uid())
  returning * into created;

  return created;
end;
$$;

/**
 * Releases part or all of a restriction.
 *
 * Partial release is first-class because Phase 5 allows releasing the inspected quantity of a lot while
 * the remainder stays held. The status is derived from the arithmetic rather than passed in, so a caller
 * cannot mark a restriction `released` while quantity remains restricted.
 */
create or replace function public.inventory_release_restriction(
  p_restriction_id uuid,
  p_quantity numeric,
  p_reason text
)
returns public.inventory_restrictions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  restriction public.inventory_restrictions;
  remaining numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A release quantity must be greater than zero' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Releasing a restriction requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into restriction from public.inventory_restrictions where id = p_restriction_id for update;
  if restriction.id is null then
    raise exception 'That restriction does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if restriction.status not in ('active', 'partially_released') then
    raise exception 'Restriction % is %, so there is nothing to release',
      restriction.restriction_reference, restriction.status
      using errcode = 'check_violation';
  end if;

  remaining := restriction.quantity - restriction.released_quantity;
  if p_quantity > remaining then
    raise exception 'Cannot release % from restriction %: only % remains restricted',
      p_quantity, restriction.restriction_reference, remaining
      using errcode = 'check_violation';
  end if;

  update public.inventory_restrictions
     set released_quantity = released_quantity + p_quantity,
         status = case when released_quantity + p_quantity = quantity then 'released' else 'partially_released' end,
         status_reason = p_reason,
         released_at = case when released_quantity + p_quantity = quantity then now() else released_at end,
         released_by = auth.uid(),
         updated_at = now()
   where id = p_restriction_id
  returning * into restriction;

  return restriction;
end;
$$;

comment on function public.inventory_apply_restriction(uuid, numeric, text, text, text, uuid, text, text, text, timestamptz) is
  'Restricts available quantity in a lot. Idempotent on the supplied key. Phase 5 quality holds call this; a hold that could not be applied must be recorded as pending, never as applied.';
comment on function public.inventory_release_restriction(uuid, numeric, text) is
  'Releases part or all of a restriction with a mandatory reason. Derives the resulting status from the arithmetic.';

-- ---------------------------------------------------------------------------
-- 5. The goods-receipt handoff consumer
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_handoff_events (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid,
  event_type text not null,
  source_module text not null,
  source_type text not null,
  source_id uuid not null,
  idempotency_key text not null unique,
  status text not null default 'processed',
  lots_created int not null default 0,
  movements_posted int not null default 0,
  restrictions_applied int not null default 0,
  quantity_received numeric(20, 6) not null default 0,
  quantity_restricted numeric(20, 6) not null default 0,
  quantity_rejected numeric(20, 6) not null default 0,
  notes text,
  processed_at timestamptz not null default now(),
  processed_by uuid references public.profiles (id) on delete set null on update cascade,
  constraint inventory_handoff_events_status_check
    check (status in ('processed', 'skipped', 'failed'))
);

create index if not exists inventory_handoff_events_source_idx
  on public.inventory_handoff_events (source_module, source_type, source_id);

comment on table public.inventory_handoff_events is
  'Record of each integration event the inventory module has consumed. Proves what was processed and how much stock it produced, so a retry is visibly a no-op.';

/**
 * Consumes `procurement.goods_receipt.posted` for one receipt.
 *
 * Idempotent twice over: the handoff record is unique per event key, and each lot/movement it writes
 * carries its own key derived from the receipt line. Calling it again after success does nothing.
 *
 * What each quantity becomes, and why:
 *   accepted    → a lot, a `receipt_in` movement, and a restriction pending inspection
 *   quarantined → a lot and a `receipt_in` movement, restricted under the supplier-quarantine code and
 *                 never released automatically
 *   rejected    → nothing. The company has not accepted these goods; if they are physically present and
 *                 later returned to the supplier, that is a separate documented movement, not stock we
 *                 can issue.
 *
 * Returns a summary row. The outbox event is marked `consumed`, which is the evidence Phase 3's receipt
 * screen shows.
 */
create or replace function public.inventory_consume_goods_receipt(p_goods_receipt_id uuid)
returns public.inventory_handoff_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  receipt public.goods_receipts;
  line record;
  event_key text := 'grn-stock:' || p_goods_receipt_id::text;
  handoff public.inventory_handoff_events;
  outbox_row public.procurement_integration_outbox;
  new_lot public.inventory_lots;
  lot_ref text;
  require_inspection boolean := private.inventory_setting_boolean('received_stock_requires_inspection');
  inspection_reason text := coalesce(
    (select value_text from public.inventory_settings where key = 'received_stock_restriction_reason'),
    'pending_inspection');
  quarantine_reason text := coalesce(
    (select value_text from public.inventory_settings where key = 'quarantined_receipt_reason'),
    'supplier_quarantine');
  lots_made int := 0;
  movements_made int := 0;
  restrictions_made int := 0;
  received_total numeric(20, 6) := 0;
  restricted_total numeric(20, 6) := 0;
  rejected_total numeric(20, 6) := 0;
begin
  select * into handoff from public.inventory_handoff_events where idempotency_key = event_key;
  if handoff.id is not null then
    return handoff;
  end if;

  select * into receipt from public.goods_receipts where id = p_goods_receipt_id;
  if receipt.id is null then
    raise exception 'Goods receipt % does not exist', p_goods_receipt_id using errcode = 'check_violation';
  end if;
  if receipt.status <> 'posted' then
    raise exception 'Goods receipt % is %, so it has no stock to hand off', receipt.reference, receipt.status
      using errcode = 'check_violation';
  end if;

  for line in
    select i.*, po_item.unit_price
      from public.goods_receipt_items i
      left join public.purchase_order_items po_item on po_item.id = i.purchase_order_item_id
     where i.goods_receipt_id = p_goods_receipt_id
     order by i.line_number
  loop
    received_total := received_total + line.received_quantity;
    rejected_total := rejected_total + line.rejected_quantity;

    -- Accepted quantity: stock the company has taken ownership of, restricted until inspected.
    if line.accepted_quantity > 0 then
      lot_ref := private.next_inventory_reference('inventory_lot');
      insert into public.inventory_lots
        (lot_reference, product_id, unit_id, warehouse_id, location_id, source_type, source_id,
         source_reference, supplier_id, goods_receipt_id, received_date)
      values
        (lot_ref, line.product_id, line.unit_id, receipt.warehouse_id, receipt.location_id,
         'goods_receipt', receipt.id, receipt.reference, receipt.supplier_id, receipt.id, receipt.receipt_date)
      returning * into new_lot;
      lots_made := lots_made + 1;

      insert into public.inventory_movements
        (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
         idempotency_key, source_module, source_type, source_id, source_reference, unit_cost,
         movement_date, posted_by, notes)
      values
        (new_lot.id, line.product_id, line.unit_id, receipt.warehouse_id, receipt.location_id,
         'receipt_in', 'in', line.accepted_quantity,
         'grn-mov:' || receipt.id::text || ':' || line.id::text,
         'procurement', 'goods_receipt_item', line.id, receipt.reference, line.unit_price,
         receipt.receipt_date, auth.uid(),
         'Accepted quantity from ' || receipt.reference)
      ;
      movements_made := movements_made + 1;

      if require_inspection then
        perform public.inventory_apply_restriction(
          new_lot.id, line.accepted_quantity, inspection_reason, 'inventory', 'goods_receipt_item', line.id,
          'grn-restrict:' || line.id::text, 'Awaiting quality inspection after receipt ' || receipt.reference,
          'pending_inspection', null);
        restrictions_made := restrictions_made + 1;
        restricted_total := restricted_total + line.accepted_quantity;
      end if;
    end if;

    -- Quarantined at the gate: it is on site, so it is stock, but it must never be issued.
    if line.quarantined_quantity > 0 then
      lot_ref := private.next_inventory_reference('inventory_lot');
      insert into public.inventory_lots
        (lot_reference, product_id, unit_id, warehouse_id, location_id, source_type, source_id,
         source_reference, supplier_id, goods_receipt_id, received_date, notes)
      values
        (lot_ref, line.product_id, line.unit_id, receipt.warehouse_id, receipt.location_id,
         'goods_receipt', receipt.id, receipt.reference, receipt.supplier_id, receipt.id, receipt.receipt_date,
         'Quarantined at receipt ' || receipt.reference)
      returning * into new_lot;
      lots_made := lots_made + 1;

      insert into public.inventory_movements
        (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
         idempotency_key, source_module, source_type, source_id, source_reference, unit_cost,
         movement_date, posted_by, notes)
      values
        (new_lot.id, line.product_id, line.unit_id, receipt.warehouse_id, receipt.location_id,
         'receipt_in', 'in', line.quarantined_quantity,
         'grn-mov:' || receipt.id::text || ':' || line.id::text || ':q',
         'procurement', 'goods_receipt_item', line.id, receipt.reference, line.unit_price,
         receipt.receipt_date, auth.uid(),
         'Quarantined quantity from ' || receipt.reference)
      ;
      movements_made := movements_made + 1;

      perform public.inventory_apply_restriction(
        new_lot.id, line.quarantined_quantity, quarantine_reason, 'inventory', 'goods_receipt_item', line.id,
        'grn-quarantine:' || line.id::text, 'Quarantined at receipt ' || receipt.reference,
        'quarantine', null);
      restrictions_made := restrictions_made + 1;
      restricted_total := restricted_total + line.quarantined_quantity;
    end if;
  end loop;

  insert into public.inventory_handoff_events
    (outbox_id, event_type, source_module, source_type, source_id, idempotency_key, status,
     lots_created, movements_posted, restrictions_applied,
     quantity_received, quantity_restricted, quantity_rejected, processed_by, notes)
  values
    (null, 'procurement.goods_receipt.posted', 'procurement', 'goods_receipt', receipt.id, event_key, 'processed',
     lots_made, movements_made, restrictions_made,
     received_total, restricted_total, rejected_total, auth.uid(),
     'Stock created from posted receipt ' || receipt.reference)
  returning * into handoff;

  -- Mark the Phase 3 outbox event consumed. Doing this here, in the same transaction as the stock it
  -- produced, is what makes "the handoff happened" a fact rather than an intention.
  update public.procurement_integration_outbox
     set status = 'consumed',
         dispatched_at = coalesce(dispatched_at, now())
   where entity_type = 'goods_receipt'
     and entity_id = receipt.id
     and event_type = 'procurement.goods_receipt.posted'
  returning * into outbox_row;

  if outbox_row.id is not null then
    update public.inventory_handoff_events set outbox_id = outbox_row.id where id = handoff.id
    returning * into handoff;
  end if;

  return handoff;
end;
$$;

/**
 * Consumes every pending goods-receipt handoff, oldest first.
 *
 * This is the function a scheduled dispatcher would call. It exists as a database function rather than an
 * application loop so that "all pending events were consumed" is one transaction with one answer.
 * Returns the number of receipts processed.
 */
create or replace function public.inventory_consume_pending_receipts(p_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_row record;
  processed int := 0;
begin
  for event_row in
    select distinct o.entity_id
      from public.procurement_integration_outbox o
     where o.status = 'pending'
       and o.event_type = 'procurement.goods_receipt.posted'
     order by o.entity_id
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  loop
    perform public.inventory_consume_goods_receipt(event_row.entity_id);
    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

comment on function public.inventory_consume_goods_receipt(uuid) is
  'Turns a posted goods receipt into lots, movements and restrictions. Idempotent; marks the Phase 3 outbox event consumed.';

grant execute on function public.inventory_apply_restriction(uuid, numeric, text, text, text, uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.inventory_release_restriction(uuid, numeric, text) to authenticated;
grant execute on function public.inventory_consume_goods_receipt(uuid) to authenticated;
grant execute on function public.inventory_consume_pending_receipts(int) to authenticated;
