-- 0068 — production plans
--
-- A plan says what the factory intends to make, how much, where it will be stored, and which materials it
-- expects to consume. It is approved before work starts, and approval is where the material requirement
-- becomes visible to the store (as a reservation, through the same reservation table Phase 6 will use).
--
-- A plan holds no quantity of stock and posts no movement. Only `production_issue_material` and
-- `production_record_output` (both in 0070) touch the ledger.

create table if not exists public.production_plans (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  -- Where the output will be stored. Required, because production output is receipted stock and every lot
  -- needs a warehouse.
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,

  planned_quantity numeric(20, 6) not null,
  planned_date date not null,
  planned_end_date date,

  status text not null default 'draft',
  status_reason text,
  priority text not null default 'normal',

  -- What asked for this plan. Kept as text plus an optional reference rather than a hard foreign key,
  -- because the requesting module (sales, stock shortfall) may not exist yet at plan time.
  source text not null default 'manual',
  source_reference text,

  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  started_at timestamptz,
  completed_at timestamptz,

  batch_count int not null default 0,
  produced_quantity numeric(20, 6) not null default 0,

  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint production_plans_reference_unique unique (reference),
  constraint production_plans_quantity_positive check (planned_quantity > 0),
  constraint production_plans_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'in_progress', 'completed', 'cancelled')),
  constraint production_plans_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint production_plans_source_check check (source in ('manual', 'sales_order', 'stock_shortfall', 'rework')),
  constraint production_plans_dates check (planned_end_date is null or planned_end_date >= planned_date),
  constraint production_plans_produced_non_negative check (produced_quantity >= 0)
);

create index if not exists production_plans_status_idx on public.production_plans (status, planned_date desc);
create index if not exists production_plans_product_idx on public.production_plans (product_id, status);

comment on table public.production_plans is
  'An approved intention to produce. Carries no stock: quantities exist only once 0070 posts movements against a batch.';

-- ---------------------------------------------------------------------------
-- 2. Declared material requirement for the plan
-- ---------------------------------------------------------------------------

create table if not exists public.production_plan_materials (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_plans (id) on delete cascade on update cascade,
  line_number int not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  required_quantity numeric(20, 6) not null,
  -- Copied out of `production_product_inputs` when the line is created, so a later change to the declared
  -- routing does not silently rewrite an approved plan.
  declared_quantity numeric(20, 6),
  declared_basis_quantity numeric(20, 6),
  is_optional boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  constraint production_plan_materials_unique unique (plan_id, line_number),
  constraint production_plan_materials_quantity_positive check (required_quantity > 0)
);

create index if not exists production_plan_materials_plan_idx on public.production_plan_materials (plan_id);

/** Requirement lines are fixed once the plan has been approved, for the same reason transfer lines are. */
create or replace function private.guard_production_plan_material_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  parent_id uuid := coalesce(new.plan_id, old.plan_id);
begin
  select status into parent_status from public.production_plans where id = parent_id;
  if parent_status is null then
    return coalesce(new, old);
  end if;
  if parent_status not in ('draft', 'rejected') then
    raise exception 'Material requirements cannot change while plan % is %', parent_id, parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists production_plan_materials_guard on public.production_plan_materials;
create trigger production_plan_materials_guard
  before insert or update or delete on public.production_plan_materials
  for each row execute function private.guard_production_plan_material_edit();

-- ---------------------------------------------------------------------------
-- 3. Defaults and lifecycle
-- ---------------------------------------------------------------------------

create or replace function private.set_production_plan_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := private.next_inventory_reference('production_plan');
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists production_plans_set_reference on public.production_plans;
create trigger production_plans_set_reference
  before insert on public.production_plans
  for each row execute function private.set_production_plan_reference();

drop trigger if exists production_plans_set_updated_at on public.production_plans;
create trigger production_plans_set_updated_at
  before update on public.production_plans
  for each row execute function private.set_updated_at();

drop trigger if exists production_plans_status_guard on public.production_plans;
create trigger production_plans_status_guard
  before update on public.production_plans
  for each row execute function private.guard_inventory_status('production_plan', 'reference');

-- ---------------------------------------------------------------------------
-- 4. Building a plan from the declared routing
-- ---------------------------------------------------------------------------

/**
 * Copies the declared inputs for the plan's product onto the plan, scaled to the planned quantity.
 *
 * The scaling here is arithmetic on the routing the company itself declared (`quantity per basis_quantity`).
 * It is not a yield calculation: nothing is discounted for loss, and the result is labelled as a
 * requirement, not a forecast. If the company has declared no inputs, the plan ends up with no material
 * lines and the caller is told so rather than being given a made-up requirement.
 */
create or replace function public.production_plan_apply_declared_inputs(p_plan_id uuid)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  plan public.production_plans;
  input_row record;
  inserted int := 0;
  line_no int := coalesce((
    select max(line_number) from public.production_plan_materials where plan_id = p_plan_id
  ), 0);
begin
  select * into plan from public.production_plans where id = p_plan_id;
  if plan.id is null then
    raise exception 'That production plan does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if plan.status not in ('draft', 'rejected') then
    raise exception 'Plan % is %; its material requirements are already fixed', plan.reference, plan.status
      using errcode = 'check_violation';
  end if;

  for input_row in
    select i.*
      from public.production_product_inputs i
     where i.product_id = plan.product_id
       and not i.is_optional
     order by i.created_at
  loop
    -- Skip lines already present, so the function can be re-run after adding another declared input.
    if exists (
      select 1 from public.production_plan_materials
       where plan_id = p_plan_id and product_id = input_row.input_product_id
    ) then
      continue;
    end if;

    line_no := line_no + 1;
    insert into public.production_plan_materials
      (plan_id, line_number, product_id, unit_id, required_quantity,
       declared_quantity, declared_basis_quantity, is_optional, notes)
    values
      (p_plan_id, line_no, input_row.input_product_id, input_row.unit_id,
       round(input_row.quantity * plan.planned_quantity / input_row.basis_quantity, 6),
       input_row.quantity, input_row.basis_quantity, input_row.is_optional,
       input_row.notes);
    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;

/**
 * Claims available stock for one material line of an approved plan.
 *
 * The lot is chosen by the caller, never by this function: which lot to draw from is a warehouse decision
 * (age, grade, location), and guessing it here would hide that decision. The claim itself goes through
 * `inventory_reserve_stock`, so it reduces availability exactly like any other reservation.
 */
create or replace function public.production_plan_reserve_material(
  p_plan_id uuid,
  p_lot_id uuid,
  p_quantity numeric,
  p_notes text default null
)
returns public.inventory_reservations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  plan public.production_plans;
  lot public.inventory_lots;
  required numeric;
  already numeric;
begin
  select * into plan from public.production_plans where id = p_plan_id;
  if plan.id is null then
    raise exception 'That production plan does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if plan.status not in ('approved', 'in_progress') then
    raise exception 'Plan % is %; material can only be reserved for an approved plan', plan.reference, plan.status
      using errcode = 'check_violation';
  end if;

  select * into lot from public.inventory_lots where id = p_lot_id;
  if lot.id is null then
    raise exception 'That lot does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;

  select m.required_quantity into required
    from public.production_plan_materials m
   where m.plan_id = p_plan_id and m.product_id = lot.product_id;
  if required is null then
    raise exception 'Lot % holds %, which is not a declared input of plan %',
      lot.lot_reference, lot.product_id, plan.reference
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(r.quantity - r.released_quantity), 0) into already
    from public.inventory_reservations r
   where r.reserved_for_module = 'production'
     and r.reserved_for_type = 'production_plan'
     and r.reserved_for_id = p_plan_id
     and r.lot_id = p_lot_id
     and r.status in ('active', 'partially_released');

  if already + p_quantity > required then
    raise exception 'Plan % needs % for this material; % is already reserved and % more was requested',
      plan.reference, required, already, p_quantity
      using errcode = 'check_violation';
  end if;

  return public.inventory_reserve_stock(
    p_lot_id,
    p_quantity,
    'production',
    'production_plan',
    p_plan_id,
    plan.reference,
    'plan-reservation:' || p_plan_id::text || ':' || p_lot_id::text,
    coalesce(p_notes, 'Reserved for production plan ' || plan.reference)
  );
end;
$$;

comment on function public.production_plan_apply_declared_inputs(uuid) is
  'Scales the company-declared inputs to the planned quantity. Refuses nothing and invents nothing: no declared inputs means no lines.';
comment on function public.production_plan_reserve_material(uuid, uuid, numeric, text) is
  'Reserves available stock for a plan material line through the shared reservation mechanism.';

-- ---------------------------------------------------------------------------
-- 5. RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.production_plans enable row level security;
alter table public.production_plan_materials enable row level security;

drop policy if exists production_plans_select on public.production_plans;
create policy production_plans_select on public.production_plans
  for select to authenticated
  using (private.has_any_permission(array['production.plan.view', 'production.batch.view', 'inventory.reports.view']));

drop policy if exists production_plans_insert on public.production_plans;
create policy production_plans_insert on public.production_plans
  for insert to authenticated
  with check (private.has_permission('production.plan.create'));

drop policy if exists production_plans_update on public.production_plans;
create policy production_plans_update on public.production_plans
  for update to authenticated
  using (private.has_any_permission(array['production.plan.create', 'production.plan.approve', 'production.plan.execute']))
  with check (private.has_any_permission(array['production.plan.create', 'production.plan.approve', 'production.plan.execute']));

drop policy if exists production_plan_materials_select on public.production_plan_materials;
create policy production_plan_materials_select on public.production_plan_materials
  for select to authenticated
  using (exists (
    select 1 from public.production_plans p
     where p.id = production_plan_materials.plan_id
       and private.has_any_permission(array['production.plan.view', 'production.batch.view'])
  ));

drop policy if exists production_plan_materials_write on public.production_plan_materials;
create policy production_plan_materials_write on public.production_plan_materials
  for all to authenticated
  using (private.has_permission('production.plan.create'))
  with check (private.has_permission('production.plan.create'));

grant select, insert, update on public.production_plans to authenticated;
grant select, insert, update, delete on public.production_plan_materials to authenticated;
grant execute on function public.production_plan_apply_declared_inputs(uuid) to authenticated;
grant execute on function public.production_plan_reserve_material(uuid, uuid, numeric, text) to authenticated;
