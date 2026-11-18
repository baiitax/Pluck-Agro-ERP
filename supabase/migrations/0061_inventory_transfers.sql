-- 0061 — stock transfers
--
-- A transfer moves stock between warehouses through a document, never by editing a lot. Dispatch and
-- receipt are separate steps because stock that has left one warehouse and not yet arrived at another is
-- in transit: it exists, it belongs to the company, and it must be visible rather than implied.
--
-- Because a lot belongs to one warehouse (0059), the destination is a NEW lot created at receipt time.
-- The chain therefore stays traceable: the destination lot records the transfer as its source, and the
-- source lot keeps the out-movement that produced it.

-- ---------------------------------------------------------------------------
-- 1. Transfer document
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  from_warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  from_location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,
  to_warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  to_location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,
  status text not null default 'draft',
  status_reason text,
  transfer_reason text,
  requested_by_employee_id uuid references public.employees (id) on delete set null on update cascade,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,
  dispatched_at timestamptz,
  dispatched_by uuid references public.profiles (id) on delete set null on update cascade,
  received_at timestamptz,
  received_by uuid references public.profiles (id) on delete set null on update cascade,
  vehicle_reference text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_transfers_reference_unique unique (reference),
  constraint inventory_transfers_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'dispatched', 'received', 'cancelled')),
  constraint inventory_transfers_distinct_warehouses check (from_warehouse_id <> to_warehouse_id)
);

create index if not exists inventory_transfers_status_idx on public.inventory_transfers (status, created_at desc);
create index if not exists inventory_transfers_from_idx on public.inventory_transfers (from_warehouse_id);
create index if not exists inventory_transfers_to_idx on public.inventory_transfers (to_warehouse_id);

comment on table public.inventory_transfers is
  'Stock transfer between warehouses. Dispatch and receipt are distinct events so in-transit quantity is observable.';

create table if not exists public.inventory_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.inventory_transfers (id) on delete cascade on update cascade,
  line_number int not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  quantity numeric(20, 6) not null,
  quantity_received numeric(20, 6),
  destination_lot_id uuid references public.inventory_lots (id) on delete set null on update cascade,
  notes text,
  created_at timestamptz not null default now(),
  constraint inventory_transfer_items_unique unique (transfer_id, line_number),
  constraint inventory_transfer_items_quantity_positive check (quantity > 0),
  constraint inventory_transfer_items_received_range
    check (quantity_received is null or (quantity_received >= 0 and quantity_received <= quantity))
);

create index if not exists inventory_transfer_items_transfer_idx on public.inventory_transfer_items (transfer_id);
create index if not exists inventory_transfer_items_lot_idx on public.inventory_transfer_items (lot_id);

create or replace function private.set_inventory_transfer_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := private.next_inventory_reference('inventory_transfer');
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_transfers_set_reference on public.inventory_transfers;
create trigger inventory_transfers_set_reference
  before insert on public.inventory_transfers
  for each row execute function private.set_inventory_transfer_reference();

drop trigger if exists inventory_transfers_set_updated_at on public.inventory_transfers;
create trigger inventory_transfers_set_updated_at
  before update on public.inventory_transfers
  for each row execute function private.set_updated_at();

drop trigger if exists inventory_transfers_status_guard on public.inventory_transfers;
create trigger inventory_transfers_status_guard
  before update on public.inventory_transfers
  for each row execute function private.guard_inventory_status('stock_transfer', 'reference');

/** A transfer's content is fixed once it has been approved; a change needs a new transfer. */
create or replace function private.guard_inventory_transfer_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
begin
  select status into parent_status from public.inventory_transfers where id = coalesce(new.transfer_id, old.transfer_id);
  if parent_status is null then
    return coalesce(new, old);
  end if;
  if parent_status not in ('draft', 'submitted', 'rejected') then
    raise exception 'Transfer lines cannot be changed once the transfer is %', parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists inventory_transfer_items_guard on public.inventory_transfer_items;
create trigger inventory_transfer_items_guard
  before insert or update or delete on public.inventory_transfer_items
  for each row execute function private.guard_inventory_transfer_edit();

-- ---------------------------------------------------------------------------
-- 2. Dispatch: move the stock out of the source warehouse
-- ---------------------------------------------------------------------------

/**
 * Dispatches an approved transfer.
 *
 * One `transfer_out` movement per line, posted against the source lot. The quantity must be available
 * (not restricted, not reserved) — the ledger's negative-stock guard catches the physical case, and the
 * availability check here catches the case where the stock exists but is held.
 *
 * Idempotent: a transfer already dispatched returns its existing state rather than moving stock twice.
 */
create or replace function public.inventory_dispatch_transfer(p_transfer_id uuid)
returns public.inventory_transfers
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  transfer public.inventory_transfers;
  line record;
  available numeric;
begin
  select * into transfer from public.inventory_transfers where id = p_transfer_id for update;
  if transfer.id is null then
    raise exception 'That transfer does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if transfer.status = 'dispatched' then
    return transfer;
  end if;
  if transfer.status <> 'approved' then
    raise exception 'Transfer % is %, so it cannot be dispatched', transfer.reference, transfer.status
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.inventory_transfer_items where transfer_id = transfer.id) then
    raise exception 'Transfer % has no lines', transfer.reference using errcode = 'check_violation';
  end if;

  for line in
    select * from public.inventory_transfer_items where transfer_id = transfer.id order by line_number
  loop
    available := private.inventory_lot_available(line.lot_id);
    if line.quantity > available then
      raise exception 'Line %: only % is available in lot % (the rest is reserved or restricted)',
        line.line_number, available, (select lot_reference from public.inventory_lots where id = line.lot_id)
        using errcode = 'check_violation';
    end if;

    insert into public.inventory_movements
      (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
       idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
       movement_date, posted_by, notes)
    values
      (line.lot_id, line.product_id, line.unit_id, transfer.from_warehouse_id, transfer.from_location_id,
       'transfer_out', 'out', line.quantity,
       'transfer-out:' || transfer.id::text || ':' || line.id::text,
       'inventory', 'stock_transfer', transfer.id, transfer.reference, transfer.id,
       current_date, auth.uid(),
       'Dispatch to ' || (select name from public.warehouses where id = transfer.to_warehouse_id))
    ;
  end loop;

  update public.inventory_transfers
     set status = 'dispatched', dispatched_at = now(), dispatched_by = auth.uid(), updated_by = auth.uid()
   where id = transfer.id
  returning * into transfer;

  return transfer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Receipt: create the stock at the destination
-- ---------------------------------------------------------------------------

/**
 * Receives a dispatched transfer at its destination.
 *
 * Creates a destination lot per line (recording this transfer as its source) and posts one
 * `transfer_in` movement against it. The destination lot inherits the source lot's product, unit,
 * supplier, expiry and grade, so traceability survives the move.
 *
 * A line may be received short. The difference stays "in transit" on the transfer and is visible as an
 * exception rather than silently vanishing.
 */
create or replace function public.inventory_receive_transfer(p_transfer_id uuid)
returns public.inventory_transfers
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  transfer public.inventory_transfers;
  line record;
  source_lot public.inventory_lots;
  dest_lot public.inventory_lots;
  received_qty numeric;
  lot_ref text;
begin
  select * into transfer from public.inventory_transfers where id = p_transfer_id for update;
  if transfer.id is null then
    raise exception 'That transfer does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if transfer.status = 'received' then
    return transfer;
  end if;
  if transfer.status <> 'dispatched' then
    raise exception 'Transfer % is %, so it has nothing in transit to receive', transfer.reference, transfer.status
      using errcode = 'check_violation';
  end if;

  for line in
    select * from public.inventory_transfer_items where transfer_id = transfer.id order by line_number
  loop
    received_qty := coalesce(line.quantity_received, line.quantity);
    if received_qty <= 0 then
      raise exception 'Line % would be received with no quantity', line.line_number
        using errcode = 'check_violation';
    end if;

    select * into source_lot from public.inventory_lots where id = line.lot_id;
    lot_ref := private.next_inventory_reference('inventory_lot');

    insert into public.inventory_lots
      (lot_reference, product_id, unit_id, warehouse_id, location_id, source_type, source_id,
       source_reference, supplier_id, goods_receipt_id, production_batch_id, received_date,
       manufacture_date, expiry_date, grade, notes)
    values
      (lot_ref, source_lot.product_id, source_lot.unit_id, transfer.to_warehouse_id, transfer.to_location_id,
       'transfer_in', transfer.id, transfer.reference, source_lot.supplier_id, source_lot.goods_receipt_id,
       source_lot.production_batch_id, current_date, source_lot.manufacture_date, source_lot.expiry_date,
       source_lot.grade, 'Transferred from lot ' || source_lot.lot_reference)
    returning * into dest_lot;

    insert into public.inventory_movements
      (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
       idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
       movement_date, posted_by, notes)
    values
      (dest_lot.id, dest_lot.product_id, dest_lot.unit_id, transfer.to_warehouse_id, transfer.to_location_id,
       'transfer_in', 'in', received_qty,
       'transfer-in:' || transfer.id::text || ':' || line.id::text,
       'inventory', 'stock_transfer', transfer.id, transfer.reference, transfer.id,
       current_date, auth.uid(),
       'Received from ' || (select name from public.warehouses where id = transfer.from_warehouse_id))
    ;

    update public.inventory_transfer_items
       set destination_lot_id = dest_lot.id,
           quantity_received = received_qty
     where id = line.id;
  end loop;

  update public.inventory_transfers
     set status = 'received', received_at = now(), received_by = auth.uid(), updated_by = auth.uid()
   where id = transfer.id
  returning * into transfer;

  return transfer;
end;
$$;

comment on function public.inventory_dispatch_transfer(uuid) is
  'Posts transfer_out movements against the source lots. Refuses quantities that are reserved or restricted.';
comment on function public.inventory_receive_transfer(uuid) is
  'Creates destination lots and posts transfer_in movements. A short receipt leaves the difference visibly in transit.';

-- ---------------------------------------------------------------------------
-- 4. In-transit view
-- ---------------------------------------------------------------------------

create or replace view public.inventory_in_transit
with (security_invoker = true)
as
select
  t.id as transfer_id,
  t.reference,
  t.status,
  t.dispatched_at,
  t.from_warehouse_id,
  wf.name as from_warehouse_name,
  t.to_warehouse_id,
  wt.name as to_warehouse_name,
  i.product_id,
  p.code as product_code,
  p.name as product_name,
  i.unit_id,
  u.code as unit_code,
  sum(i.quantity) as dispatched_quantity,
  coalesce(sum(i.quantity_received), 0) as received_quantity,
  sum(i.quantity) - coalesce(sum(i.quantity_received), 0) as in_transit_quantity
from public.inventory_transfers t
join public.inventory_transfer_items i on i.transfer_id = t.id
join public.warehouses wf on wf.id = t.from_warehouse_id
join public.warehouses wt on wt.id = t.to_warehouse_id
join public.products p on p.id = i.product_id
join public.units_of_measure u on u.id = i.unit_id
where t.status = 'dispatched'
group by t.id, wf.name, wt.name, i.product_id, p.code, p.name, i.unit_id, u.code;

comment on view public.inventory_in_transit is
  'Stock that has been dispatched and not yet received, per transfer line. Visible by design: in-transit stock is the company''s until it arrives or is lost.';

grant execute on function public.inventory_dispatch_transfer(uuid) to authenticated;
grant execute on function public.inventory_receive_transfer(uuid) to authenticated;
