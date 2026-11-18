-- 0067 — production configuration: stages, routings, declared inputs, yield rules
--
-- What the factory *declares* it does, as opposed to what it actually did (plans and batches, which come
-- next). Everything here is configuration: Pluck Agro maintains it, and it is versioned by effective dates
-- rather than overwritten, because a batch produced last month must still be explainable against the
-- routing that was in force when it ran.
--
-- Deliberate omissions, because they are the company's answers and not the schema's:
--   * no yield percentage, loss percentage or tsaki factor is seeded anywhere;
--   * no input quantity is seeded — a routing exists only for products the company has described;
--   * no GR-I / GR-II grading limits are stated;
--   * no product is marked as requiring a specific process by default.
-- The tables are structurally complete and empty. Empty is the honest state.

-- ---------------------------------------------------------------------------
-- 1. Stages
-- ---------------------------------------------------------------------------

create table if not exists public.production_stages (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  sequence int not null default 10,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_stages_code_unique unique (code),
  constraint production_stages_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  constraint production_stages_name_present check (length(btrim(name)) > 1)
);

create index if not exists production_stages_sequence_idx on public.production_stages (is_active, sequence);

comment on table public.production_stages is
  'Named processing stages (for example cleaning, milling, grading). Seeded empty on purpose: the stage list is the factory''s process description, not a schema decision.';

-- ---------------------------------------------------------------------------
-- 2. Product routing: which stages a product passes through, in what order
-- ---------------------------------------------------------------------------

create table if not exists public.production_product_processes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  stage_id uuid not null references public.production_stages (id) on delete restrict on update cascade,
  sequence int not null default 10,
  instructions text,
  expected_duration_hours numeric(10, 2),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_product_processes_unique unique (product_id, stage_id),
  constraint production_product_processes_duration_non_negative
    check (expected_duration_hours is null or expected_duration_hours >= 0)
);

create index if not exists production_product_processes_product_idx
  on public.production_product_processes (product_id, sequence);

comment on table public.production_product_processes is
  'A product''s route through the stages. One row per stage per product; a product with no rows simply has no declared routing.';

-- ---------------------------------------------------------------------------
-- 3. Declared inputs
-- ---------------------------------------------------------------------------
-- The company states what it expects to put in per production run. The schema records that statement; it
-- does not derive it, and it does not scale it into a requirement automatically, because scaling needs a
-- yield basis that has not been agreed.

create table if not exists public.production_product_inputs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  input_product_id uuid not null references public.products (id) on delete restrict on update cascade,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  -- Quantity stated against `basis_quantity` of output. Expressed as a pair so a routing can say
  -- "12 units of input per 100 units of output" without anyone guessing what "per unit" means.
  quantity numeric(20, 6) not null,
  basis_quantity numeric(20, 6) not null default 1,
  is_optional boolean not null default false,
  stage_id uuid references public.production_stages (id) on delete set null on update cascade,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_product_inputs_unique unique (product_id, input_product_id),
  constraint production_product_inputs_self check (product_id <> input_product_id),
  constraint production_product_inputs_quantity_positive check (quantity > 0),
  constraint production_product_inputs_basis_positive check (basis_quantity > 0)
);

create index if not exists production_product_inputs_product_idx
  on public.production_product_inputs (product_id);

comment on table public.production_product_inputs is
  'Declared material input per stated basis of output. Configuration only: it never posts a movement and never reserves stock by itself.';

-- ---------------------------------------------------------------------------
-- 4. Yield rules
-- ---------------------------------------------------------------------------
-- A yield rule states what the factory will accept as a normal outcome for a product, so a batch close can
-- say "outside the declared band, reason required" instead of inventing a tolerance at posting time.
-- `min_percent` / `max_percent` are null when the company has not set a tolerance; null means "no declared
-- tolerance", which makes every close require a stated reason rather than silently passing.

create table if not exists public.production_yield_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  -- How the observed yield is computed from a batch's own recorded quantities.
  basis text not null default 'output_over_input',
  min_percent numeric(7, 3),
  max_percent numeric(7, 3),
  requires_reason_outside_band boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_yield_rules_basis_check check (basis in ('output_over_input', 'stated')),
  constraint production_yield_rules_percent_range
    check ((min_percent is null or (min_percent >= 0 and min_percent <= 200))
       and (max_percent is null or (max_percent >= 0 and max_percent <= 200))
       and (min_percent is null or max_percent is null or min_percent <= max_percent)),
  constraint production_yield_rules_period check (effective_to is null or effective_to >= effective_from)
);

create index if not exists production_yield_rules_product_idx
  on public.production_yield_rules (product_id, effective_from desc);

comment on table public.production_yield_rules is
  'Acceptable yield band per product, set by Pluck Agro. No band is seeded: with no rule, a batch close always requires a stated reason, which is the conservative default.';
comment on column public.production_yield_rules.basis is
  'output_over_input means yield = recorded output ÷ recorded input for the same batch. stated means the company supplies the expected figure itself and the system does not compute one.';

-- ---------------------------------------------------------------------------
-- 5. Settings
-- ---------------------------------------------------------------------------

insert into public.inventory_settings (key, value_text, value_numeric, value_boolean, description)
values
  ('production_issue_requires_stock', null, null, true,
   'Refuse to issue material to production when the lot does not have the quantity available'),
  ('production_output_requires_inspection', null, null, true,
   'Production output is receipted stock and is restricted pending quality inspection, matching the goods-receipt policy'),
  ('production_available_soon_days', null, 7, null,
   'Window used by the availability report to count lots expiring inside the planning horizon')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------

/**
 * Stamps the acting profile on insert when the caller did not say who they were.
 *
 * Configuration rows have no other writer, so stamping here removes a whole class of "who changed the
 * routing" questions. Kept private and generic: it only ever assigns `created_by` from `auth.uid()`.
 */
create or replace function private.set_created_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function private.set_created_by() from public;

drop trigger if exists production_stages_set_updated_at on public.production_stages;
create trigger production_stages_set_updated_at
  before update on public.production_stages
  for each row execute function private.set_updated_at();

drop trigger if exists production_product_processes_set_updated_at on public.production_product_processes;
create trigger production_product_processes_set_updated_at
  before update on public.production_product_processes
  for each row execute function private.set_updated_at();

drop trigger if exists production_product_inputs_set_updated_at on public.production_product_inputs;
create trigger production_product_inputs_set_updated_at
  before update on public.production_product_inputs
  for each row execute function private.set_updated_at();

drop trigger if exists production_yield_rules_set_updated_at on public.production_yield_rules;
create trigger production_yield_rules_set_updated_at
  before update on public.production_yield_rules
  for each row execute function private.set_updated_at();

drop trigger if exists production_stages_set_created_by on public.production_stages;
create trigger production_stages_set_created_by
  before insert on public.production_stages
  for each row execute function private.set_created_by();

drop trigger if exists production_product_processes_set_created_by on public.production_product_processes;
create trigger production_product_processes_set_created_by
  before insert on public.production_product_processes
  for each row execute function private.set_created_by();

drop trigger if exists production_product_inputs_set_created_by on public.production_product_inputs;
create trigger production_product_inputs_set_created_by
  before insert on public.production_product_inputs
  for each row execute function private.set_created_by();

drop trigger if exists production_yield_rules_set_created_by on public.production_yield_rules;
create trigger production_yield_rules_set_created_by
  before insert on public.production_yield_rules
  for each row execute function private.set_created_by();

-- ---------------------------------------------------------------------------
-- 7. RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.production_stages enable row level security;
alter table public.production_product_processes enable row level security;
alter table public.production_product_inputs enable row level security;
alter table public.production_yield_rules enable row level security;

drop policy if exists production_stages_select on public.production_stages;
create policy production_stages_select on public.production_stages
  for select to authenticated using (private.is_active_profile());

drop policy if exists production_stages_write on public.production_stages;
create policy production_stages_write on public.production_stages
  for all to authenticated
  using (private.has_permission('production.product.manage'))
  with check (private.has_permission('production.product.manage'));

drop policy if exists production_product_processes_select on public.production_product_processes;
create policy production_product_processes_select on public.production_product_processes
  for select to authenticated
  using (private.has_any_permission(array['production.product.view', 'production.plan.view']));

drop policy if exists production_product_processes_write on public.production_product_processes;
create policy production_product_processes_write on public.production_product_processes
  for all to authenticated
  using (private.has_permission('production.product.manage'))
  with check (private.has_permission('production.product.manage'));

drop policy if exists production_product_inputs_select on public.production_product_inputs;
create policy production_product_inputs_select on public.production_product_inputs
  for select to authenticated
  using (private.has_any_permission(array['production.product.view', 'production.plan.view']));

drop policy if exists production_product_inputs_write on public.production_product_inputs;
create policy production_product_inputs_write on public.production_product_inputs
  for all to authenticated
  using (private.has_permission('production.product.manage'))
  with check (private.has_permission('production.product.manage'));

drop policy if exists production_yield_rules_select on public.production_yield_rules;
create policy production_yield_rules_select on public.production_yield_rules
  for select to authenticated
  using (private.has_any_permission(array['production.product.view', 'production.batch.view']));

drop policy if exists production_yield_rules_write on public.production_yield_rules;
create policy production_yield_rules_write on public.production_yield_rules
  for all to authenticated
  using (private.has_permission('production.product.manage'))
  with check (private.has_permission('production.product.manage'));

grant select, insert, update, delete on
  public.production_stages, public.production_product_processes,
  public.production_product_inputs, public.production_yield_rules
  to authenticated;
