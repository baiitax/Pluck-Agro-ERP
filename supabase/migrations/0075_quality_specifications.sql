-- 0075 — quality parameters and product specifications
--
-- A specification is the thing an inspection is judged against. This file builds it in the only shape that
-- survives an audit:
--   * a **parameter catalogue** (moisture, purity, foreign matter, colour, odour, …) shared across products,
--     so "moisture" means one thing everywhere;
--   * **versioned specifications** per product and stage. An approved version is immutable; a change is a new
--     version that supersedes the old one, and the old one is kept because inspections were judged against it;
--   * **limits as data**, never as code. Nothing here seeds a number. A specification with no limits can be
--     created and reviewed, but it cannot be approved, because approving it would create a document that
--     cannot decide anything.
--
-- What is deliberately absent: any claim about method validity, laboratory accreditation, or which standard a
-- method follows. `method_reference` is free text a person copies from a real document. If it is empty, the
-- inspection records the value and states that no method was declared.

-- ---------------------------------------------------------------------------
-- 1. Parameter catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.quality_parameters (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  -- A numeric parameter is compared against limits. A text or pass/fail parameter is compared against an
  -- expected value recorded on the specification. The difference matters: comparing a colour description
  -- against a number would be nonsense dressed as precision.
  result_type text not null default 'numeric',
  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  -- Free text, supplied by Pluck Agro from its own method documentation. Never generated, never assumed.
  method_reference text,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_parameters_code_format check (code ~ '^[a-z][a-z0-9_]{1,48}$'),
  constraint quality_parameters_code_unique unique (code),
  constraint quality_parameters_result_type_check
    check (result_type in ('numeric', 'text', 'pass_fail', 'observation')),
  constraint quality_parameters_unit_shape
    check ((result_type = 'numeric') or unit_id is null)
);

create index if not exists quality_parameters_active_idx on public.quality_parameters (is_active, sort_order);

comment on table public.quality_parameters is
  'Shared test-parameter catalogue. Method references are free text copied from company documentation; the system makes no claim about method validity or laboratory accreditation.';

comment on column public.quality_parameters.method_reference is
  'Free-text method reference supplied by the company. Empty means no method was declared — the system never invents a standard, a clause number or an accreditation.';

-- ---------------------------------------------------------------------------
-- 2. Specifications
-- ---------------------------------------------------------------------------

create table if not exists public.quality_specifications (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  -- Which point in the flow this specification governs. 'incoming' judges a supplier lot, 'finished' judges a
  -- production batch output, 'pre_dispatch' judges stock before it leaves. A product may have all three.
  stage text not null,
  -- Allocated by trigger: a version is never chosen by a caller, so two drafts cannot collide.
  version int not null,
  status text not null default 'draft',
  status_reason text,

  effective_from date,
  effective_to date,

  -- The version this one replaces, so the chain of what was in force when is readable.
  supersedes_id uuid references public.quality_specifications (id) on delete restrict on update cascade,

  title text,
  notes text,
  method_reference text,

  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_specifications_reference_unique unique (reference),
  constraint quality_specifications_version_unique unique (product_id, stage, version),
  constraint quality_specifications_version_positive check (version > 0),
  constraint quality_specifications_stage_check
    check (stage in ('incoming', 'in_process', 'finished', 'pre_dispatch', 'storage')),
  constraint quality_specifications_status_check
    check (status in ('draft', 'approved', 'superseded', 'cancelled')),
  constraint quality_specifications_effective_range
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  -- An approved version must carry the moment of approval. `approved_by` is nullable because the column is
  -- `on delete set null`: an approver who later leaves the company must not make their old approvals invalid.
  -- Who approved is preserved in the status trail and the audit log, which are append-only.
  constraint quality_specifications_approval_shape
    check ((status <> 'approved') or (approved_at is not null)),
  constraint quality_specifications_self_supersede check (supersedes_id is null or supersedes_id <> id)
);

create index if not exists quality_specifications_product_idx
  on public.quality_specifications (product_id, stage, version desc);
create index if not exists quality_specifications_status_idx
  on public.quality_specifications (status);

comment on table public.quality_specifications is
  'Versioned product quality specification. Approved versions are immutable; a change is a new version that supersedes the old one, which is retained because inspections were judged against it.';

-- ---------------------------------------------------------------------------
-- 3. Specification parameters (the limits themselves)
-- ---------------------------------------------------------------------------

create table if not exists public.quality_specification_parameters (
  id uuid primary key default gen_random_uuid(),
  specification_id uuid not null references public.quality_specifications (id) on delete cascade on update cascade,
  parameter_id uuid not null references public.quality_parameters (id) on delete restrict on update cascade,
  line_number int not null default 1,

  -- Nullable on purpose. A limit that is genuinely not stated must be able to be absent rather than be
  -- given a filler value that a later reader would trust.
  min_value numeric(20, 6),
  max_value numeric(20, 6),
  target_value numeric(20, 6),
  expected_text text,

  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  is_mandatory boolean not null default true,
  criticality text not null default 'major',
  -- Where a parameter needs its own method rather than the catalogue's, it is stated here.
  method_reference text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_specification_parameters_unique unique (specification_id, parameter_id),
  constraint quality_specification_parameters_line_unique unique (specification_id, line_number),
  constraint quality_specification_parameters_range
    check (min_value is null or max_value is null or max_value >= min_value),
  constraint quality_specification_parameters_criticality_check
    check (criticality in ('critical', 'major', 'minor')),
  constraint quality_specification_parameters_shape
    check (target_value is null or min_value is null or max_value is null
           or (target_value >= min_value and target_value <= max_value))
);

create index if not exists quality_specification_parameters_spec_idx
  on public.quality_specification_parameters (specification_id, line_number);

comment on table public.quality_specification_parameters is
  'The limits an inspection is judged against. Every limit is company-supplied data; no migration seeds one.';

-- ---------------------------------------------------------------------------
-- 4. An approved specification is frozen, and a draft cannot be edited once it has been used
-- ---------------------------------------------------------------------------
-- The rule is enforced in the database rather than only in the service layer, because "we only edit approved
-- specifications through the UI" is exactly the assumption an audit tests.

create or replace function private.guard_specification_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid;
  current_status text;
begin
  if tg_table_name = 'quality_specifications' then
    if tg_op = 'UPDATE' and old.status in ('approved', 'superseded', 'cancelled') then
      -- Only lifecycle bookkeeping may change after approval: the status itself, the effective window, the
      -- reason and the supersession link. The substance — which product, which stage, which version, which
      -- limits — is frozen, because inspections were judged against exactly that.
      if new.product_id is distinct from old.product_id
         or new.stage is distinct from old.stage
         or new.version is distinct from old.version
         or new.reference is distinct from old.reference then
        raise exception 'Specification % is % and can no longer be edited; create a new version instead',
          old.reference, old.status
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- Parameter rows: changeable only while the specification is still a draft.
  if tg_op = 'DELETE' then
    target_id := old.specification_id;
  else
    target_id := new.specification_id;
  end if;
  select status into current_status from public.quality_specifications where id = target_id;

  if current_status is null then
    raise exception 'That specification does not exist'
      using errcode = 'check_violation';
  end if;

  if current_status <> 'draft' then
    raise exception 'Specification parameters can only be changed while the specification is a draft (current status: %)',
      current_status
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quality_specifications_immutable on public.quality_specifications;
create trigger quality_specifications_immutable
  before update on public.quality_specifications
  for each row execute function private.guard_specification_immutability();

drop trigger if exists quality_specification_parameters_guard on public.quality_specification_parameters;
create trigger quality_specification_parameters_guard
  before insert or update or delete on public.quality_specification_parameters
  for each row execute function private.guard_specification_immutability();

-- Lifecycle guard and reference allocation.
drop trigger if exists quality_specifications_lifecycle on public.quality_specifications;
create trigger quality_specifications_lifecycle
  before update on public.quality_specifications
  for each row execute function private.guard_quality_status('quality_specification', 'reference');

create or replace function private.assign_quality_specification_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null then
    new.reference := private.next_quality_reference('quality_specification');
  end if;
  select coalesce(max(s.version), 0) + 1 into new.version
    from public.quality_specifications s
   where s.product_id = new.product_id and s.stage = new.stage;
  return new;
end;
$$;

drop trigger if exists quality_specifications_defaults on public.quality_specifications;
create trigger quality_specifications_defaults
  before insert on public.quality_specifications
  for each row execute function private.assign_quality_specification_defaults();

-- ---------------------------------------------------------------------------
-- 5. Approval
-- ---------------------------------------------------------------------------
-- Approval is a function rather than a status update, because it has three obligations the update path
-- cannot express: the specification must be able to decide something, the previous version must be
-- superseded in the same transaction, and the approver must be recorded.

create or replace function public.quality_approve_specification(
  p_specification_id uuid,
  p_reason text default null
)
returns public.quality_specifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  spec public.quality_specifications;
  previous public.quality_specifications;
  parameter_count int;
  undecidable text;
begin
  if auth.uid() is not null and not private.has_permission('quality.specification.approve') then
    raise exception 'Approving a quality specification requires permission quality.specification.approve'
      using errcode = 'insufficient_privilege';
  end if;

  select * into spec from public.quality_specifications where id = p_specification_id for update;
  if spec.id is null then
    raise exception 'That specification does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if spec.status <> 'draft' then
    raise exception 'Specification % is % and cannot be approved again', spec.reference, spec.status
      using errcode = 'check_violation';
  end if;

  select count(*) into parameter_count
    from public.quality_specification_parameters p
   where p.specification_id = spec.id;

  if parameter_count = 0 then
    raise exception 'Specification % has no parameters, so approving it would create a document that cannot judge anything',
      spec.reference
      using errcode = 'check_violation';
  end if;

  -- Every mandatory parameter must be able to produce a verdict. A numeric parameter with neither a minimum
  -- nor a maximum, or a text parameter with no expected value, would record a result that can never fail.
  select string_agg(qp.name, ', ' order by sp.line_number) into undecidable
    from public.quality_specification_parameters sp
    join public.quality_parameters qp on qp.id = sp.parameter_id
   where sp.specification_id = spec.id
     and sp.is_mandatory
     and (
       (qp.result_type = 'numeric' and sp.min_value is null and sp.max_value is null)
       or (qp.result_type in ('text', 'pass_fail')
           and sp.expected_text is null and sp.min_value is null and sp.max_value is null)
     );

  if undecidable is not null then
    raise exception 'Specification % cannot be approved: these mandatory parameters have no limit or expected value to judge against: %',
      spec.reference, undecidable
      using errcode = 'check_violation';
  end if;

  select * into previous
    from public.quality_specifications s
   where s.product_id = spec.product_id
     and s.stage = spec.stage
     and s.status = 'approved'
     and s.id <> spec.id
   order by s.version desc
   limit 1;

  if previous.id is not null then
    update public.quality_specifications
       set status = 'superseded',
           effective_to = coalesce(effective_to, current_date),
           status_reason = coalesce('Superseded by ' || spec.reference, status_reason),
           updated_at = now()
     where id = previous.id;

    update public.quality_specifications
       set supersedes_id = coalesce(supersedes_id, previous.id)
     where id = spec.id;
  end if;

  update public.quality_specifications
     set status = 'approved',
         approved_by = coalesce(auth.uid(), approved_by),
         approved_at = now(),
         effective_from = coalesce(effective_from, current_date),
         status_reason = p_reason,
         updated_at = now()
   where id = spec.id
  returning * into spec;

  return spec;
end;
$$;

comment on function public.quality_approve_specification(uuid, text) is
  'Approves a draft specification, supersedes the currently approved version for the same product and stage, and refuses a specification that has no parameter able to produce a verdict.';

-- ---------------------------------------------------------------------------
-- 6. Resolution: which specification governs this product and stage right now
-- ---------------------------------------------------------------------------

create or replace function public.quality_effective_specification(p_product_id uuid, p_stage text)
returns public.quality_specifications
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  spec public.quality_specifications;
begin
  select * into spec
    from public.quality_specifications s
   where s.product_id = p_product_id
     and s.stage = p_stage
     and s.status = 'approved'
     and (s.effective_from is null or s.effective_from <= current_date)
     and (s.effective_to is null or s.effective_to >= current_date)
   order by s.version desc
   limit 1;

  return spec;
end;
$$;

comment on function public.quality_effective_specification(uuid, text) is
  'The approved specification in force for a product and stage today. Returns an empty row when there is none — the caller must handle that rather than assume a default.';

create or replace function public.quality_setting_text(p_key text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result text;
begin
  select coalesce(value_text, value_numeric::text) into result
    from public.quality_settings where key = p_key;
  return result;
end;
$$;

revoke all on function public.quality_setting_text(text) from public;
grant execute on function public.quality_setting_text(text) to authenticated, service_role;
