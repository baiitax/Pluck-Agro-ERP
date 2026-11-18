-- 0069 — production batches
--
-- A batch is the thing that actually consumes material and produces output. It is the only production object
-- that touches the ledger, and it does so exclusively through 0070's functions:
--   * a material issue posts `issue_to_production` out of the source lot;
--   * an output posts `production_output` / `by_product_output` / `waste_output` into a NEW lot.
--
-- Two design points worth stating because they are easy to get wrong:
--   1. Output always creates a lot. Production output is received stock, it needs provenance, and the batch
--      it came from is that provenance (`inventory_lots.production_batch_id`, populated here).
--   2. A batch records what happened. It does not "carry" a balance, and closing it does not move stock.

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  plan_id uuid references public.production_plans (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,

  planned_quantity numeric(20, 6) not null,
  -- Kept as recorded facts. They are sums of posted movements, recomputed by trigger, never typed by a user.
  issued_quantity numeric(20, 6) not null default 0,
  output_quantity numeric(20, 6) not null default 0,
  waste_quantity numeric(20, 6) not null default 0,

  status text not null default 'draft',
  status_reason text,

  batch_date date not null default current_date,
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null on update cascade,
  supervisor_employee_id uuid references public.employees (id) on delete set null on update cascade,

  -- Yield as recorded, not as predicted. Null until there is both an input and an output to divide.
  recorded_yield_percent numeric(7, 3),
  recorded_yield_basis text,
  within_declared_band boolean,

  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint production_batches_reference_unique unique (reference),
  constraint production_batches_planned_positive check (planned_quantity > 0),
  constraint production_batches_totals_non_negative
    check (issued_quantity >= 0 and output_quantity >= 0 and waste_quantity >= 0),
  constraint production_batches_status_check
    check (status in ('draft', 'in_progress', 'completed', 'closed', 'aborted', 'cancelled')),
  constraint production_batches_yield_basis_check
    check (recorded_yield_basis is null or recorded_yield_basis in ('same_unit', 'mixed_units', 'stated'))
);

create index if not exists production_batches_status_idx on public.production_batches (status, batch_date desc);
create index if not exists production_batches_plan_idx on public.production_batches (plan_id);
create index if not exists production_batches_product_idx on public.production_batches (product_id, batch_date desc);

comment on table public.production_batches is
  'One production run. Issued/output/waste quantities are maintained from posted movements, never typed. Closing a batch moves no stock.';

-- ---------------------------------------------------------------------------
-- 2. Material issues
-- ---------------------------------------------------------------------------

create table if not exists public.production_batch_materials (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches (id) on delete cascade on update cascade,
  line_number int not null,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  quantity numeric(20, 6) not null,
  -- The movement that actually took the stock out. A batch line with no movement would be a claim, not a fact.
  movement_id uuid references public.inventory_movements (id) on delete restrict on update cascade,
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id) on delete set null on update cascade,
  notes text,
  constraint production_batch_materials_unique unique (batch_id, line_number),
  constraint production_batch_materials_quantity_positive check (quantity > 0),
  constraint production_batch_materials_movement_present check (movement_id is not null)
);

create index if not exists production_batch_materials_batch_idx on public.production_batch_materials (batch_id);
create index if not exists production_batch_materials_lot_idx on public.production_batch_materials (lot_id);

-- ---------------------------------------------------------------------------
-- 3. Outputs
-- ---------------------------------------------------------------------------

create table if not exists public.production_batch_outputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches (id) on delete cascade on update cascade,
  line_number int not null,
  -- 'main' is the product the batch exists to make; by-products and waste are declared as such rather than
  -- being mixed into the main quantity, because they have different value and different destinations.
  output_type text not null default 'main',
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  lot_id uuid not null references public.inventory_lots (id) on delete restrict on update cascade,
  quantity numeric(20, 6) not null,
  movement_id uuid not null references public.inventory_movements (id) on delete restrict on update cascade,
  -- Set when the output was receipted pending inspection; the restriction id is the real one Phase 5 releases.
  restriction_id uuid references public.inventory_restrictions (id) on delete set null on update cascade,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null on update cascade,
  notes text,
  constraint production_batch_outputs_unique unique (batch_id, line_number),
  constraint production_batch_outputs_quantity_positive check (quantity > 0),
  constraint production_batch_outputs_type_check
    check (output_type in ('main', 'by_product', 'waste'))
);

create index if not exists production_batch_outputs_batch_idx on public.production_batch_outputs (batch_id);
create index if not exists production_batch_outputs_lot_idx on public.production_batch_outputs (lot_id);

-- ---------------------------------------------------------------------------
-- 4. Daily logs
-- ---------------------------------------------------------------------------
-- The operational diary: what happened on a shift that the quantities will not show. Free-text on purpose;
-- this table exists so supervisors have somewhere to write it rather than in the batch notes, which are
-- about the batch as a whole.

create table if not exists public.production_batch_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches (id) on delete cascade on update cascade,
  log_date date not null default current_date,
  shift text,
  log_type text not null default 'note',
  stage_id uuid references public.production_stages (id) on delete set null on update cascade,
  body text not null,
  employee_id uuid references public.employees (id) on delete set null on update cascade,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint production_batch_logs_body_present check (length(btrim(body)) >= 3),
  constraint production_batch_logs_type_check
    check (log_type in ('note', 'downtime', 'issue', 'observation', 'handover')),
  constraint production_batch_logs_shift_check
    check (shift is null or shift in ('morning', 'afternoon', 'night', 'full_day'))
);

create index if not exists production_batch_logs_batch_idx on public.production_batch_logs (batch_id, log_date desc);

-- ---------------------------------------------------------------------------
-- 5. Totals are derived, never typed
-- ---------------------------------------------------------------------------

/**
 * Recomputes the batch's issued / output / waste totals from its own lines.
 *
 * Called by trigger after any change to a line. A user cannot write a batch total directly: the columns are
 * overwritten from the lines on every insert, update and delete, so the header cannot disagree with the body.
 */
create or replace function private.recalculate_production_batch_totals(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  issued numeric(20, 6);
  produced numeric(20, 6);
  wasted numeric(20, 6);
begin
  select coalesce(sum(m.quantity), 0) into issued
    from public.production_batch_materials m
   where m.batch_id = p_batch_id
     and m.unit_id = (select unit_id from public.production_batches where id = p_batch_id);

  -- Output totals are only summed where the unit matches the batch's output unit; a by-product measured in
  -- another unit cannot be added to the main quantity without a conversion the company has not declared.
  select coalesce(sum(o.quantity), 0) into produced
    from public.production_batch_outputs o
   where o.batch_id = p_batch_id
     and o.output_type = 'main'
     and o.unit_id = (select unit_id from public.production_batches where id = p_batch_id);

  select coalesce(sum(o.quantity), 0) into wasted
    from public.production_batch_outputs o
   where o.batch_id = p_batch_id
     and o.output_type = 'waste'
     and o.unit_id = (select unit_id from public.production_batches where id = p_batch_id);

  update public.production_batches
     set issued_quantity = issued,
         output_quantity = produced,
         waste_quantity = wasted
   where id = p_batch_id;
end;
$$;

create or replace function private.sync_production_batch_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.recalculate_production_batch_totals(coalesce(new.batch_id, old.batch_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists production_batch_materials_totals on public.production_batch_materials;
create trigger production_batch_materials_totals
  after insert or update or delete on public.production_batch_materials
  for each row execute function private.sync_production_batch_totals();

drop trigger if exists production_batch_outputs_totals on public.production_batch_outputs;
create trigger production_batch_outputs_totals
  after insert or update or delete on public.production_batch_outputs
  for each row execute function private.sync_production_batch_totals();

-- ---------------------------------------------------------------------------
-- 6. Defaults and lifecycle
-- ---------------------------------------------------------------------------

create or replace function private.set_production_batch_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := private.next_inventory_reference('production_batch');
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists production_batches_set_reference on public.production_batches;
create trigger production_batches_set_reference
  before insert on public.production_batches
  for each row execute function private.set_production_batch_reference();

drop trigger if exists production_batches_set_updated_at on public.production_batches;
create trigger production_batches_set_updated_at
  before update on public.production_batches
  for each row execute function private.set_updated_at();

drop trigger if exists production_batches_status_guard on public.production_batches;
create trigger production_batches_status_guard
  before update on public.production_batches
  for each row execute function private.guard_inventory_status('production_batch', 'reference');

/** Lines may only be added while the batch is running. A closed batch's body is evidence. */
create or replace function private.guard_production_batch_line_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  parent_id uuid := coalesce(new.batch_id, old.batch_id);
begin
  select status into parent_status from public.production_batches where id = parent_id;
  if parent_status is null then
    return coalesce(new, old);
  end if;
  if parent_status not in ('draft', 'in_progress') then
    raise exception 'Lines cannot be changed while batch is %', parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists production_batch_materials_guard on public.production_batch_materials;
create trigger production_batch_materials_guard
  before insert or update or delete on public.production_batch_materials
  for each row execute function private.guard_production_batch_line_edit();

drop trigger if exists production_batch_outputs_guard on public.production_batch_outputs;
create trigger production_batch_outputs_guard
  before insert or update or delete on public.production_batch_outputs
  for each row execute function private.guard_production_batch_line_edit();

-- ---------------------------------------------------------------------------
-- 7. The batch ↔ output lot link
-- ---------------------------------------------------------------------------
-- 0059 left `inventory_lots.production_batch_id` unconstrained because production did not exist yet. It is
-- constrained here, once the table it points at is real.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'inventory_lots_production_batch_fk'
       and conrelid = 'public.inventory_lots'::regclass
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_production_batch_fk
      foreign key (production_batch_id) references public.production_batches (id)
      on delete set null on update cascade;
  end if;
end;
$$;

create index if not exists inventory_lots_batch_idx on public.inventory_lots (production_batch_id);

-- ---------------------------------------------------------------------------
-- 8. RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.production_batches enable row level security;
alter table public.production_batch_materials enable row level security;
alter table public.production_batch_outputs enable row level security;
alter table public.production_batch_logs enable row level security;

drop policy if exists production_batches_select on public.production_batches;
create policy production_batches_select on public.production_batches
  for select to authenticated
  using (private.has_any_permission(array[
    'production.batch.view', 'production.plan.view', 'inventory.reports.view'
  ]));

drop policy if exists production_batches_insert on public.production_batches;
create policy production_batches_insert on public.production_batches
  for insert to authenticated
  with check (private.has_permission('production.batch.create'));

drop policy if exists production_batches_update on public.production_batches;
create policy production_batches_update on public.production_batches
  for update to authenticated
  using (private.has_any_permission(array['production.batch.execute', 'production.batch.close']))
  with check (private.has_any_permission(array['production.batch.execute', 'production.batch.close']));

drop policy if exists production_batch_materials_select on public.production_batch_materials;
create policy production_batch_materials_select on public.production_batch_materials
  for select to authenticated
  using (private.has_any_permission(array['production.batch.view', 'inventory.stock.view']));

drop policy if exists production_batch_materials_write on public.production_batch_materials;
create policy production_batch_materials_write on public.production_batch_materials
  for all to authenticated
  using (private.has_permission('production.batch.execute'))
  with check (private.has_permission('production.batch.execute'));

drop policy if exists production_batch_outputs_select on public.production_batch_outputs;
create policy production_batch_outputs_select on public.production_batch_outputs
  for select to authenticated
  using (private.has_any_permission(array['production.batch.view', 'inventory.stock.view']));

drop policy if exists production_batch_outputs_write on public.production_batch_outputs;
create policy production_batch_outputs_write on public.production_batch_outputs
  for all to authenticated
  using (private.has_permission('production.batch.execute'))
  with check (private.has_permission('production.batch.execute'));

drop policy if exists production_batch_logs_select on public.production_batch_logs;
create policy production_batch_logs_select on public.production_batch_logs
  for select to authenticated
  using (private.has_permission('production.batch.view'));

drop policy if exists production_batch_logs_insert on public.production_batch_logs;
create policy production_batch_logs_insert on public.production_batch_logs
  for insert to authenticated
  with check (private.has_permission('production.batch.execute'));

grant select, insert, update on public.production_batches to authenticated;
grant select, insert on public.production_batch_materials, public.production_batch_outputs to authenticated;
grant select, insert on public.production_batch_logs to authenticated;
