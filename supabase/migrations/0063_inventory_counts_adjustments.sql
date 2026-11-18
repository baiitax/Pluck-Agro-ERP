-- 0063 — stock counts and approval-controlled adjustments
--
-- Two documents whose only purpose is to correct the ledger *honestly*.
--
-- A stock count compares what the system believes (derived from movements) with what a person found on
-- the floor. Its variances become gain/loss movements only after approval, and each movement references
-- the count, so a loss can always be traced back to the physical count that discovered it.
--
-- An adjustment is a deliberate correction with a stated reason. It is a separate document from a count
-- because "we counted and the number differed" and "we know why this is wrong" are different claims, and
-- an auditor needs to distinguish them.
--
-- Neither document edits a movement. Both post new ones.

-- ---------------------------------------------------------------------------
-- 1. Stock count
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_stock_counts (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,
  count_date date not null,
  status text not null default 'draft',
  status_reason text,
  counted_by_employee_id uuid references public.employees (id) on delete set null on update cascade,
  started_at timestamptz,
  counted_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  posted_at timestamptz,
  posted_by uuid references public.profiles (id) on delete set null on update cascade,
  total_gain_quantity numeric(20, 6) not null default 0,
  total_loss_quantity numeric(20, 6) not null default 0,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_stock_counts_reference_unique unique (reference),
  constraint inventory_stock_counts_status_check
    check (status in ('draft', 'counting', 'counted', 'submitted', 'approved', 'rejected', 'posted', 'cancelled'))
);

create index if not exists inventory_stock_counts_status_idx on public.inventory_stock_counts (status, count_date desc);
create index if not exists inventory_stock_counts_warehouse_idx on public.inventory_stock_counts (warehouse_id);

create table if not exists public.inventory_stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_stock_counts (id) on delete cascade on update cascade,
  line_number int not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  -- What the ledger said when the line was added, frozen so the variance stays explainable even after
  -- later movements change the live balance.
  system_quantity numeric(20, 6) not null,
  counted_quantity numeric(20, 6),
  variance_quantity numeric(20, 6) generated always as
    (case when counted_quantity is null then null else counted_quantity - system_quantity end) stored,
  counted_by_employee_id uuid references public.employees (id) on delete set null on update cascade,
  counted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint inventory_stock_count_lines_unique unique (count_id, line_number),
  constraint inventory_stock_count_lines_system_non_negative check (system_quantity >= 0),
  constraint inventory_stock_count_lines_counted_non_negative
    check (counted_quantity is null or counted_quantity >= 0)
);

create index if not exists inventory_stock_count_lines_count_idx on public.inventory_stock_count_lines (count_id);
create index if not exists inventory_stock_count_lines_lot_idx on public.inventory_stock_count_lines (lot_id);

comment on table public.inventory_stock_count_lines is
  'One counted lot. `system_quantity` is frozen at count time and `variance_quantity` is generated, so the difference cannot be edited into agreement.';

-- ---------------------------------------------------------------------------
-- 2. Stock adjustment
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  adjustment_date date not null,
  reason_code text not null,
  reason text not null,
  status text not null default 'draft',
  status_reason text,
  source_count_id uuid references public.inventory_stock_counts (id) on delete set null on update cascade,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  posted_at timestamptz,
  posted_by uuid references public.profiles (id) on delete set null on update cascade,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_stock_adjustments_reference_unique unique (reference),
  constraint inventory_stock_adjustments_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'posted', 'cancelled')),
  constraint inventory_stock_adjustments_reason_present check (length(btrim(reason)) >= 10)
);

create index if not exists inventory_stock_adjustments_status_idx
  on public.inventory_stock_adjustments (status, adjustment_date desc);

create table if not exists public.inventory_stock_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.inventory_stock_adjustments (id) on delete cascade on update cascade,
  line_number int not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  -- Signed: positive increases stock, negative decreases it. Unlike the ledger, a signed column is the
  -- honest representation here because the document's whole purpose is to state a direction.
  quantity_change numeric(20, 6) not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint inventory_stock_adjustment_lines_unique unique (adjustment_id, line_number),
  constraint inventory_stock_adjustment_lines_change_non_zero check (quantity_change <> 0)
);

create index if not exists inventory_stock_adjustment_lines_adj_idx
  on public.inventory_stock_adjustment_lines (adjustment_id);

-- ---------------------------------------------------------------------------
-- 3. Defaults, guards
-- ---------------------------------------------------------------------------

create or replace function private.set_inventory_document_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entity text := tg_argv[0];
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := private.next_inventory_reference(entity);
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_stock_counts_set_reference on public.inventory_stock_counts;
create trigger inventory_stock_counts_set_reference
  before insert on public.inventory_stock_counts
  for each row execute function private.set_inventory_document_reference('inventory_stock_count');

drop trigger if exists inventory_stock_adjustments_set_reference on public.inventory_stock_adjustments;
create trigger inventory_stock_adjustments_set_reference
  before insert on public.inventory_stock_adjustments
  for each row execute function private.set_inventory_document_reference('inventory_adjustment');

drop trigger if exists inventory_stock_counts_set_updated_at on public.inventory_stock_counts;
create trigger inventory_stock_counts_set_updated_at
  before update on public.inventory_stock_counts
  for each row execute function private.set_updated_at();

drop trigger if exists inventory_stock_adjustments_set_updated_at on public.inventory_stock_adjustments;
create trigger inventory_stock_adjustments_set_updated_at
  before update on public.inventory_stock_adjustments
  for each row execute function private.set_updated_at();

drop trigger if exists inventory_stock_counts_status_guard on public.inventory_stock_counts;
create trigger inventory_stock_counts_status_guard
  before update on public.inventory_stock_counts
  for each row execute function private.guard_inventory_status('stock_count', 'reference');

drop trigger if exists inventory_stock_adjustments_status_guard on public.inventory_stock_adjustments;
create trigger inventory_stock_adjustments_status_guard
  before update on public.inventory_stock_adjustments
  for each row execute function private.guard_inventory_status('stock_adjustment', 'reference');

/** Count and adjustment lines are fixed once the document has left draft/counting. */
create or replace function private.guard_inventory_correction_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  parent_id uuid := coalesce(new.count_id, new.adjustment_id, old.count_id, old.adjustment_id);
  is_count boolean := tg_argv[0] = 'count';
begin
  if is_count then
    select status into parent_status from public.inventory_stock_counts where id = parent_id;
  else
    select status into parent_status from public.inventory_stock_adjustments where id = parent_id;
  end if;

  if parent_status is null then
    return coalesce(new, old);
  end if;

  -- Counting itself writes counted quantities while the document is in `counting`.
  if is_count and tg_argv[1] = 'count' and parent_status = 'counting' then
    return coalesce(new, old);
  end if;

  if parent_status not in ('draft', 'counting', 'rejected') then
    raise exception 'Lines cannot be changed while the document is %', parent_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists inventory_stock_count_lines_guard on public.inventory_stock_count_lines;
create trigger inventory_stock_count_lines_guard
  before insert or update or delete on public.inventory_stock_count_lines
  for each row execute function private.guard_inventory_correction_edit('count', 'structure');

drop trigger if exists inventory_stock_count_lines_counting on public.inventory_stock_count_lines;
create trigger inventory_stock_count_lines_counting
  before update on public.inventory_stock_count_lines
  for each row execute function private.guard_inventory_correction_edit('count', 'count');

drop trigger if exists inventory_stock_adjustment_lines_guard on public.inventory_stock_adjustment_lines;
create trigger inventory_stock_adjustment_lines_guard
  before insert or update or delete on public.inventory_stock_adjustment_lines
  for each row execute function private.guard_inventory_correction_edit('adjustment', 'structure');

-- ---------------------------------------------------------------------------
-- 4. Starting a count: snapshot the system quantities
-- ---------------------------------------------------------------------------

/**
 * Opens a stock count for a warehouse, optionally narrowed to a location.
 *
 * Every lot with a non-zero balance is added as a line with the system quantity frozen now. Taking the
 * snapshot at the start is what makes a variance meaningful: comparing a count taken on Monday with a
 * balance read on Friday would blame the counter for legitimate week-day movements.
 */
create or replace function public.inventory_start_stock_count(
  p_warehouse_id uuid,
  p_location_id uuid default null,
  p_count_date date default null,
  p_notes text default null
)
returns public.inventory_stock_counts
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created public.inventory_stock_counts;
  lot record;
  line_no int := 0;
begin
  insert into public.inventory_stock_counts
    (warehouse_id, location_id, count_date, status, notes, started_at, created_by)
  values
    (p_warehouse_id, p_location_id, coalesce(p_count_date, current_date), 'counting', p_notes, now(), auth.uid())
  returning * into created;

  for lot in
    select b.lot_id, b.product_id, b.unit_id, b.on_hand_quantity
      from public.inventory_lot_balances b
     where b.warehouse_id = p_warehouse_id
       and (p_location_id is null or b.location_id = p_location_id)
       and b.on_hand_quantity <> 0
       and b.lot_status = 'open'
     order by b.lot_reference
  loop
    line_no := line_no + 1;
    insert into public.inventory_stock_count_lines
      (count_id, line_number, lot_id, product_id, unit_id, system_quantity)
    values
      (created.id, line_no, lot.lot_id, lot.product_id, lot.unit_id, lot.on_hand_quantity);
  end loop;

  return created;
end;
$$;

/**
 * Records the counted quantity for one line, and moves the count from `counting` to `counted` when every
 * line has been counted. Two separate updates so the status guard sees a legal edge.
 */
create or replace function public.inventory_record_count_line(
  p_count_line_id uuid,
  p_counted_quantity numeric,
  p_notes text default null
)
returns public.inventory_stock_count_lines
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  line public.inventory_stock_count_lines;
  count_row public.inventory_stock_counts;
  remaining int;
begin
  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'A counted quantity must be zero or greater' using errcode = 'check_violation';
  end if;

  select * into line from public.inventory_stock_count_lines where id = p_count_line_id;
  if line.id is null then
    raise exception 'That count line does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;

  select * into count_row from public.inventory_stock_counts where id = line.count_id;
  if count_row.status <> 'counting' then
    raise exception 'Count % is %, so quantities can no longer be recorded',
      count_row.reference, count_row.status
      using errcode = 'check_violation';
  end if;

  update public.inventory_stock_count_lines
     set counted_quantity = p_counted_quantity,
         counted_at = now(),
         counted_by_employee_id = coalesce(line.counted_by_employee_id, private.current_employee_id()),
         notes = coalesce(p_notes, notes)
   where id = p_count_line_id
  returning * into line;

  select count(*) into remaining
    from public.inventory_stock_count_lines
   where count_id = count_row.id and counted_quantity is null;

  if remaining = 0 then
    update public.inventory_stock_counts
       set status = 'counted', counted_at = now(), updated_by = auth.uid()
     where id = count_row.id;
  end if;

  return line;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Posting a count: variances become movements
-- ---------------------------------------------------------------------------

/**
 * Posts the variances of an approved count.
 *
 * Requires approval when `stock_count_requires_approval` is on, which it is by default. Each non-zero
 * variance becomes a `count_gain` or `count_loss` movement referencing the count, so a loss can always be
 * traced to the physical count that found it.
 *
 * A lot whose count came in at zero is left at zero rather than closed: the stock is gone, but closing the
 * lot is a separate decision that may need to wait for an investigation.
 */
create or replace function public.inventory_post_stock_count(p_count_id uuid)
returns public.inventory_stock_counts
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  count_row public.inventory_stock_counts;
  line record;
  requires_approval boolean := private.inventory_setting_boolean('stock_count_requires_approval');
  gain_total numeric(20, 6) := 0;
  loss_total numeric(20, 6) := 0;
begin
  select * into count_row from public.inventory_stock_counts where id = p_count_id for update;
  if count_row.id is null then
    raise exception 'That stock count does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if count_row.status = 'posted' then
    return count_row;
  end if;

  if requires_approval and count_row.status <> 'approved' then
    raise exception 'Stock count % is %; it must be approved before its variances are posted',
      count_row.reference, count_row.status
      using errcode = 'check_violation';
  end if;
  if not requires_approval and count_row.status not in ('counted', 'approved') then
    raise exception 'Stock count % is %, so there is nothing to post', count_row.reference, count_row.status
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.inventory_stock_count_lines
     where count_id = count_row.id and counted_quantity is null
  ) then
    raise exception 'Stock count % still has uncounted lines', count_row.reference
      using errcode = 'check_violation';
  end if;

  for line in
    select * from public.inventory_stock_count_lines
     where count_id = count_row.id and coalesce(variance_quantity, 0) <> 0
     order by line_number
  loop
    if line.variance_quantity > 0 then
      gain_total := gain_total + line.variance_quantity;
      insert into public.inventory_movements
        (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
         idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
         movement_date, posted_by, reason)
      select
        line.lot_id, line.product_id, line.unit_id, count_row.warehouse_id, count_row.location_id,
        'count_gain', 'in', line.variance_quantity,
        'count-gain:' || count_row.id::text || ':' || line.id::text,
        'inventory', 'stock_count', count_row.id, count_row.reference, count_row.id,
        count_row.count_date, auth.uid(),
        'Counted more than the ledger recorded on ' || count_row.reference;
    else
      loss_total := loss_total + abs(line.variance_quantity);
      insert into public.inventory_movements
        (lot_id, product_id, unit_id, warehouse_id, location_id, movement_type, direction, quantity,
         idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
         movement_date, posted_by, reason)
      select
        line.lot_id, line.product_id, line.unit_id, count_row.warehouse_id, count_row.location_id,
        'count_loss', 'out', abs(line.variance_quantity),
        'count-loss:' || count_row.id::text || ':' || line.id::text,
        'inventory', 'stock_count', count_row.id, count_row.reference, count_row.id,
        count_row.count_date, auth.uid(),
        'Counted fewer than the ledger recorded on ' || count_row.reference;
    end if;
  end loop;

  update public.inventory_stock_counts
     set status = 'posted', posted_at = now(), posted_by = auth.uid(),
         total_gain_quantity = gain_total, total_loss_quantity = loss_total, updated_by = auth.uid()
   where id = count_row.id
  returning * into count_row;

  return count_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Posting an adjustment
-- ---------------------------------------------------------------------------

/**
 * Posts an approved adjustment.
 *
 * The line's signed `quantity_change` becomes an `adjustment_in` or `adjustment_out` movement. Approval is
 * required when `adjustment_requires_approval` is on, which it is by default — a stock adjustment that
 * does not need approval is a way to write off inventory unnoticed.
 */
create or replace function public.inventory_post_adjustment(p_adjustment_id uuid)
returns public.inventory_stock_adjustments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  adjustment public.inventory_stock_adjustments;
  line record;
  requires_approval boolean := private.inventory_setting_boolean('adjustment_requires_approval');
begin
  select * into adjustment from public.inventory_stock_adjustments where id = p_adjustment_id for update;
  if adjustment.id is null then
    raise exception 'That adjustment does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if adjustment.status = 'posted' then
    return adjustment;
  end if;

  if requires_approval and adjustment.status <> 'approved' then
    raise exception 'Adjustment % is %; it must be approved before it can post',
      adjustment.reference, adjustment.status
      using errcode = 'check_violation';
  end if;
  if not requires_approval and adjustment.status not in ('submitted', 'approved') then
    raise exception 'Adjustment % is %, so there is nothing to post', adjustment.reference, adjustment.status
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.inventory_stock_adjustment_lines where adjustment_id = adjustment.id) then
    raise exception 'Adjustment % has no lines', adjustment.reference using errcode = 'check_violation';
  end if;

  for line in
    select * from public.inventory_stock_adjustment_lines
     where adjustment_id = adjustment.id
     order by line_number
  loop
    insert into public.inventory_movements
      (lot_id, product_id, unit_id, warehouse_id, movement_type, direction, quantity,
       idempotency_key, source_module, source_type, source_id, source_reference, transaction_id,
       movement_date, posted_by, reason)
    values
      (line.lot_id, line.product_id, line.unit_id, adjustment.warehouse_id,
       case when line.quantity_change > 0 then 'adjustment_in' else 'adjustment_out' end,
       case when line.quantity_change > 0 then 'in' else 'out' end,
       abs(line.quantity_change),
       'adjustment:' || adjustment.id::text || ':' || line.id::text,
       'inventory', 'stock_adjustment', adjustment.id, adjustment.reference, adjustment.id,
       adjustment.adjustment_date, auth.uid(),
       coalesce(line.reason, adjustment.reason));
  end loop;

  update public.inventory_stock_adjustments
     set status = 'posted', posted_at = now(), posted_by = auth.uid(), updated_by = auth.uid()
   where id = adjustment.id
  returning * into adjustment;

  return adjustment;
end;
$$;

comment on function public.inventory_start_stock_count(uuid, uuid, date, text) is
  'Opens a count and freezes the system quantity per lot, so variances describe the moment of counting.';
comment on function public.inventory_post_stock_count(uuid) is
  'Posts count_gain / count_loss movements for approved variances. Never edits an existing movement.';
comment on function public.inventory_post_adjustment(uuid) is
  'Posts adjustment_in / adjustment_out movements for an approved adjustment.';

grant execute on function public.inventory_start_stock_count(uuid, uuid, date, text) to authenticated;
grant execute on function public.inventory_record_count_line(uuid, numeric, text) to authenticated;
grant execute on function public.inventory_post_stock_count(uuid) to authenticated;
grant execute on function public.inventory_post_adjustment(uuid) to authenticated;
