-- 0076 — sampling plans, inspections, samples and results
--
-- An inspection is the quality record: it says which lot or batch was looked at, against which specification
-- version, by whom, on what evidence. The results on it are compared to the specification's limits by the
-- database, not by whoever typed them, so a result cannot be marked "conforming" by assertion.
--
-- Three rules shape this file:
--   1. **A result carries the limits it was judged against**, copied at record time. If the specification is
--      later superseded, the old inspection still explains its own verdict.
--   2. **A result that cannot be judged is recorded as `not_evaluated`,** not as a pass. Missing limits are a
--      real state and the only honest label for it.
--   3. **Results are frozen once the inspection leaves draft/in_progress.** Corrections after submission are a
--      new inspection, because a quality record that can be edited after approval is not evidence.
--
-- Sampling quantities are company data. The sampling-plan table exists so Pluck Agro can state its policy as
-- configuration; no plan is seeded and no default sample size is invented.

-- ---------------------------------------------------------------------------
-- 1. Sampling plans
-- ---------------------------------------------------------------------------

create table if not exists public.quality_sampling_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Null product means the plan applies to every product at that stage; a specific product overrides it.
  product_id uuid references public.products (id) on delete restrict on update cascade,
  stage text not null,

  basis text not null,
  percentage numeric(7, 4),
  fixed_quantity numeric(20, 6),
  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  minimum_quantity numeric(20, 6),
  maximum_quantity numeric(20, 6),

  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_sampling_plans_stage_check
    check (stage in ('incoming', 'in_process', 'finished', 'pre_dispatch', 'storage')),
  constraint quality_sampling_plans_basis_check
    check (basis in ('percentage', 'fixed')),
  constraint quality_sampling_plans_shape check (
    (basis = 'percentage' and percentage is not null and percentage > 0 and percentage <= 100)
    or (basis = 'fixed' and fixed_quantity is not null and fixed_quantity > 0 and unit_id is not null)
  ),
  constraint quality_sampling_plans_bounds
    check (minimum_quantity is null or maximum_quantity is null or maximum_quantity >= minimum_quantity)
);

create index if not exists quality_sampling_plans_lookup_idx
  on public.quality_sampling_plans (stage, is_active, product_id);

comment on table public.quality_sampling_plans is
  'Company sampling policy as configuration. No plan is seeded: a sample size is an operational decision Pluck Agro states, not one a migration invents.';

-- ---------------------------------------------------------------------------
-- 2. Inspections
-- ---------------------------------------------------------------------------

create table if not exists public.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  reference text not null,

  specification_id uuid not null references public.quality_specifications (id) on delete restrict on update cascade,
  -- At least one of the two must be present: an inspection judges a lot of stock or the output of a batch, and
  -- a batch's output is itself a lot, so the lot is the link the ledger understands.
  lot_id uuid references public.inventory_lots (id) on delete restrict on update cascade,
  production_batch_id uuid references public.production_batches (id) on delete restrict on update cascade,

  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  stage text not null,
  inspection_type text not null default 'routine',

  sampling_plan_id uuid references public.quality_sampling_plans (id) on delete restrict on update cascade,
  sampled_quantity numeric(20, 6),
  sample_unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,

  status text not null default 'draft',
  status_reason text,
  -- Derived from the results by `quality_submit_inspection`; never typed.
  result_summary text,

  inspected_by uuid references public.profiles (id) on delete set null on update cascade,
  inspected_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null on update cascade,
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,

  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_inspections_reference_unique unique (reference),
  constraint quality_inspections_subject_present check (lot_id is not null or production_batch_id is not null),
  constraint quality_inspections_stage_check
    check (stage in ('incoming', 'in_process', 'finished', 'pre_dispatch', 'storage')),
  constraint quality_inspections_type_check
    check (inspection_type in ('routine', 'incoming', 'in_process', 'final', 'pre_dispatch', 'retest', 'investigation')),
  constraint quality_inspections_status_check
    check (status in ('draft', 'in_progress', 'submitted', 'approved', 'rejected', 'cancelled')),
  constraint quality_inspections_summary_check
    check (result_summary is null or result_summary in ('conforming', 'non_conforming', 'indeterminate')),
  constraint quality_inspections_sampled_positive
    check (sampled_quantity is null or sampled_quantity > 0)
);

create index if not exists quality_inspections_lot_idx on public.quality_inspections (lot_id);
create index if not exists quality_inspections_batch_idx on public.quality_inspections (production_batch_id);
create index if not exists quality_inspections_status_idx on public.quality_inspections (status, created_at desc);

comment on table public.quality_inspections is
  'A quality inspection of a lot or production batch against one specification version. `result_summary` is derived from the results on submission and is never typed by a user.';

-- ---------------------------------------------------------------------------
-- 3. Samples
-- ---------------------------------------------------------------------------

create table if not exists public.quality_samples (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  inspection_id uuid not null references public.quality_inspections (id) on delete cascade on update cascade,
  quantity numeric(20, 6) not null,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  taken_at timestamptz not null default now(),
  taken_by uuid references public.profiles (id) on delete set null on update cascade,
  -- Where the sample came from, in the operator's words: a warehouse, a silo, a bag number. Not a structured
  -- claim about sampling technique the system cannot verify.
  location_note text,
  notes text,
  created_at timestamptz not null default now(),
  constraint quality_samples_reference_unique unique (reference),
  constraint quality_samples_quantity_positive check (quantity > 0)
);

create index if not exists quality_samples_inspection_idx on public.quality_samples (inspection_id);

-- ---------------------------------------------------------------------------
-- 4. Results
-- ---------------------------------------------------------------------------

create table if not exists public.quality_inspection_results (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.quality_inspections (id) on delete cascade on update cascade,
  specification_parameter_id uuid not null references public.quality_specification_parameters (id) on delete restrict on update cascade,
  parameter_id uuid not null references public.quality_parameters (id) on delete restrict on update cascade,

  value_numeric numeric(20, 6),
  value_text text,
  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,

  -- The limits in force when the result was recorded. Copied, not joined, so a later specification version
  -- cannot rewrite the basis of a verdict that has already been made.
  judged_min numeric(20, 6),
  judged_max numeric(20, 6),
  judged_expected_text text,

  -- 'conforming' | 'non_conforming' | 'not_evaluated'. Computed by trigger; a caller cannot set it.
  conformance text not null default 'not_evaluated',

  recorded_by uuid references public.profiles (id) on delete set null on update cascade,
  recorded_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id) on delete set null on update cascade,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_inspection_results_unique unique (inspection_id, parameter_id),
  constraint quality_inspection_results_conformance_check
    check (conformance in ('conforming', 'non_conforming', 'not_evaluated'))
);

create index if not exists quality_inspection_results_inspection_idx
  on public.quality_inspection_results (inspection_id);

comment on table public.quality_inspection_results is
  'A measured value and the limits it was judged against, copied at record time. `conformance` is computed by the database; nothing in the application may set it.';

/**
 * Decides conformance for a single result.
 *
 * Returns 'not_evaluated' when there is nothing to judge against, which is the honest answer: a value with no
 * limit is a measurement, not a verdict. A pass/fail parameter is compared to its expected value; a numeric
 * parameter to its recorded window.
 */
create or replace function private.evaluate_quality_result(
  p_result_type text,
  p_value_numeric numeric,
  p_value_text text,
  p_min numeric,
  p_max numeric,
  p_expected_text text
)
returns text
language plpgsql
immutable
as $$
begin
  if p_result_type = 'numeric' then
    if p_value_numeric is null then
      return 'not_evaluated';
    end if;
    if p_min is null and p_max is null then
      return 'not_evaluated';
    end if;
    if (p_min is not null and p_value_numeric < p_min) or (p_max is not null and p_value_numeric > p_max) then
      return 'non_conforming';
    end if;
    return 'conforming';
  end if;

  if p_result_type in ('text', 'pass_fail') then
    if p_value_text is null then
      return 'not_evaluated';
    end if;
    if p_expected_text is null then
      return 'not_evaluated';
    end if;
    if lower(btrim(p_value_text)) = lower(btrim(p_expected_text)) then
      return 'conforming';
    end if;
    return 'non_conforming';
  end if;

  -- An observation has no verdict; it is recorded for the reader.
  return 'not_evaluated';
end;
$$;

create or replace function private.prepare_quality_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  spec_param public.quality_specification_parameters;
  param public.quality_parameters;
  inspection public.quality_inspections;
begin
  select * into inspection from public.quality_inspections where id = new.inspection_id;

  if inspection.id is null then
    raise exception 'That inspection does not exist' using errcode = 'check_violation';
  end if;

  if inspection.status not in ('draft', 'in_progress') then
    raise exception 'Results cannot be changed once inspection % is %',
      inspection.reference, inspection.status
      using errcode = 'check_violation';
  end if;

  select * into spec_param
    from public.quality_specification_parameters
   where id = new.specification_parameter_id;

  if spec_param.id is null or spec_param.specification_id <> inspection.specification_id then
    raise exception 'That parameter does not belong to the specification this inspection is judged against'
      using errcode = 'check_violation';
  end if;

  select * into param from public.quality_parameters where id = spec_param.parameter_id;

  if param.id is null then
    raise exception 'That quality parameter does not exist' using errcode = 'check_violation';
  end if;

  -- The parameter on the result must be the one the specification line names; a mismatch would let a result be
  -- filed against the wrong limit.
  new.parameter_id := spec_param.parameter_id;

  if tg_op = 'INSERT' then
    new.judged_min := spec_param.min_value;
    new.judged_max := spec_param.max_value;
    new.judged_expected_text := spec_param.expected_text;
  end if;

  if param.result_type = 'numeric' and new.value_numeric is null then
    raise exception 'Parameter % expects a numeric result', param.name
      using errcode = 'check_violation';
  end if;

  if param.result_type in ('text', 'pass_fail', 'observation') and new.value_text is null and new.value_numeric is null then
    raise exception 'Parameter % expects a recorded value', param.name
      using errcode = 'check_violation';
  end if;

  new.conformance := private.evaluate_quality_result(
    param.result_type, new.value_numeric, new.value_text,
    coalesce(new.judged_min, spec_param.min_value),
    coalesce(new.judged_max, spec_param.max_value),
    coalesce(new.judged_expected_text, spec_param.expected_text)
  );

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quality_inspection_results_prepare on public.quality_inspection_results;
create trigger quality_inspection_results_prepare
  before insert or update on public.quality_inspection_results
  for each row execute function private.prepare_quality_result();

-- ---------------------------------------------------------------------------
-- 5. Inspection lifecycle functions
-- ---------------------------------------------------------------------------

create or replace function private.assign_quality_inspection_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  spec public.quality_specifications;
begin
  if new.reference is null then
    new.reference := private.next_quality_reference('quality_inspection');
  end if;

  select * into spec from public.quality_specifications where id = new.specification_id;
  if spec.id is null then
    raise exception 'That specification does not exist' using errcode = 'check_violation';
  end if;
  if spec.status <> 'approved' then
    raise exception 'Inspection can only be raised against an approved specification; % is %',
      spec.reference, spec.status
      using errcode = 'check_violation';
  end if;

  new.product_id := coalesce(new.product_id, spec.product_id);
  new.stage := coalesce(new.stage, spec.stage);

  if new.product_id <> spec.product_id or new.stage <> spec.stage then
    raise exception 'The inspection product and stage must match the specification it is judged against (% / %)',
      spec.product_id, spec.stage
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists quality_inspections_defaults on public.quality_inspections;
create trigger quality_inspections_defaults
  before insert on public.quality_inspections
  for each row execute function private.assign_quality_inspection_defaults();

drop trigger if exists quality_inspections_lifecycle on public.quality_inspections;
create trigger quality_inspections_lifecycle
  before update on public.quality_inspections
  for each row execute function private.guard_quality_status('quality_inspection', 'reference');

create or replace function private.assign_quality_sample_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null then
    new.reference := private.next_quality_reference('quality_sample');
  end if;
  new.taken_by := coalesce(new.taken_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists quality_samples_defaults on public.quality_samples;
create trigger quality_samples_defaults
  before insert on public.quality_samples
  for each row execute function private.assign_quality_sample_defaults();

/**
 * Submits an inspection for approval.
 *
 * The result summary is computed here from the recorded results. Any mandatory parameter without a result makes
 * the summary `indeterminate` rather than conforming — unless the configured policy allows partial submission,
 * in which case the missing parameters are simply absent from the verdict and the summary still reflects only
 * what was measured, which the caller can see in the register.
 */
create or replace function public.quality_submit_inspection(p_inspection_id uuid)
returns public.quality_inspections
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inspection public.quality_inspections;
  missing_params text;
  non_conforming_count int;
  not_evaluated_count int;
  allow_partial boolean;
  summary text;
begin
  if auth.uid() is not null and not private.has_permission('quality.inspection.submit') then
    raise exception 'Submitting an inspection requires permission quality.inspection.submit'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inspection from public.quality_inspections where id = p_inspection_id for update;
  if inspection.id is null then
    raise exception 'That inspection does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if inspection.status not in ('draft', 'in_progress') then
    raise exception 'Inspection % is % and cannot be submitted', inspection.reference, inspection.status
      using errcode = 'check_violation';
  end if;

  allow_partial := public.quality_setting_boolean('inspection.allow_partial_result_submission', false);

  select string_agg(qp.name, ', ' order by sp.line_number)
    into missing_params
    from public.quality_specification_parameters sp
    join public.quality_parameters qp on qp.id = sp.parameter_id
   where sp.specification_id = inspection.specification_id
     and sp.is_mandatory
     and not exists (
       select 1 from public.quality_inspection_results r
        where r.inspection_id = inspection.id and r.parameter_id = sp.parameter_id
     );

  if missing_params is not null and not allow_partial then
    raise exception 'Inspection % cannot be submitted: no result recorded for %',
      inspection.reference, missing_params
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.quality_inspection_results r where r.inspection_id = inspection.id) then
    raise exception 'Inspection % has no results; there is nothing to submit', inspection.reference
      using errcode = 'check_violation';
  end if;

  select
    count(*) filter (where r.conformance = 'non_conforming'),
    count(*) filter (where r.conformance = 'not_evaluated')
    into non_conforming_count, not_evaluated_count
    from public.quality_inspection_results r
   where r.inspection_id = inspection.id;

  if non_conforming_count > 0 then
    summary := 'non_conforming';
  elsif not_evaluated_count > 0 or missing_params is not null then
    -- Something could not be judged. Saying "conforming" here would be a claim the data does not support.
    summary := 'indeterminate';
  else
    summary := 'conforming';
  end if;

  update public.quality_inspections
     set status = 'submitted',
         result_summary = summary,
         submitted_by = coalesce(auth.uid(), submitted_by),
         submitted_at = now(),
         inspected_by = coalesce(inspected_by, auth.uid()),
         inspected_at = coalesce(inspected_at, now()),
         updated_by = coalesce(auth.uid(), updated_by),
         updated_at = now()
   where id = inspection.id
  returning * into inspection;

  return inspection;
end;
$$;

/**
 * Approves a submitted inspection.
 *
 * Approval is the gate that allows a disposition to be recorded, so it is its own permission and its own step.
 * An inspection whose summary is non-conforming may still be approved — approving the *result* is not the same
 * as agreeing the material is good, and the disposition is where that judgement belongs.
 */
create or replace function public.quality_approve_inspection(p_inspection_id uuid, p_reason text default null)
returns public.quality_inspections
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inspection public.quality_inspections;
begin
  if auth.uid() is not null and not private.has_permission('quality.inspection.approve') then
    raise exception 'Approving an inspection requires permission quality.inspection.approve'
      using errcode = 'insufficient_privilege';
  end if;

  select * into inspection from public.quality_inspections where id = p_inspection_id for update;
  if inspection.id is null then
    raise exception 'That inspection does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if inspection.status <> 'submitted' then
    raise exception 'Inspection % is % and cannot be approved; only a submitted inspection can be',
      inspection.reference, inspection.status
      using errcode = 'check_violation';
  end if;

  -- Segregation of duties, enforced here rather than assumed: the person who approved the results must not be
  -- the person who submitted them. A single person can still complete the workflow where the company has only
  -- one qualified officer — that is what the explicit override on the setting is for — but the default refuses.
  if auth.uid() is not null
     and inspection.submitted_by is not null
     and inspection.submitted_by = auth.uid()
     and not coalesce(public.quality_setting_boolean('inspection.allow_self_approval', false), false) then
    raise exception 'Inspection % was submitted by the approving user. A different person must approve it, or the policy switch inspection.allow_self_approval must be turned on.',
      inspection.reference
      using errcode = 'insufficient_privilege';
  end if;

  update public.quality_inspections
     set status = 'approved',
         approved_by = coalesce(auth.uid(), approved_by),
         approved_at = now(),
         status_reason = p_reason,
         updated_by = coalesce(auth.uid(), updated_by),
         updated_at = now()
   where id = inspection.id
  returning * into inspection;

  return inspection;
end;
$$;

insert into public.quality_settings (key, value_boolean, description)
values ('inspection.allow_self_approval', false,
        'When false, the user who submitted an inspection cannot also approve it. Turning it on is a deliberate concession for sites with a single qualified officer.')
on conflict (key) do nothing;
