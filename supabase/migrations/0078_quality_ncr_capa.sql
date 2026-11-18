-- 0078 — non-conformance reports and corrective/preventive actions
--
-- A non-conformance is raised when something did not meet a requirement: a failed inspection, a supplier problem,
-- an internal complaint, a deviation. It is deliberately *not* the same object as a rejected disposition — the
-- disposition decides what happens to the stock, the NCR decides what happens to the process. One lot can produce
-- a rejection and no NCR (isolated supplier defect handled commercially) or an NCR and no rejection (a process
-- deviation caught before it affected product).
--
-- CAPA actions hang off the NCR. Closing an NCR with actions still open is refused, because "closed" with
-- unfinished corrective work is the most common way a quality system quietly stops meaning anything.

create table if not exists public.quality_ncrs (
  id uuid primary key default gen_random_uuid(),
  reference text not null,

  inspection_id uuid references public.quality_inspections (id) on delete set null on update cascade,
  disposition_id uuid references public.quality_dispositions (id) on delete set null on update cascade,
  lot_id uuid references public.inventory_lots (id) on delete restrict on update cascade,
  production_batch_id uuid references public.production_batches (id) on delete restrict on update cascade,
  supplier_id uuid references public.suppliers (id) on delete set null on update cascade,

  source text not null default 'inspection',
  severity text not null default 'major',
  title text not null,
  description text not null,

  -- What was done immediately to stop the problem spreading, in the reporter's words.
  containment_action text,
  -- Filled in during investigation. The system never guesses a root cause.
  root_cause text,

  detected_at timestamptz not null default now(),
  detected_by uuid references public.profiles (id) on delete set null on update cascade,

  status text not null default 'open',
  status_reason text,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null on update cascade,

  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_ncrs_reference_unique unique (reference),
  constraint quality_ncrs_source_check
    check (source in ('inspection', 'supplier', 'internal', 'customer_complaint', 'audit', 'deviation')),
  constraint quality_ncrs_severity_check
    check (severity in ('critical', 'major', 'minor', 'observation')),
  constraint quality_ncrs_status_check
    check (status in ('open', 'investigating', 'closed', 'cancelled')),
  constraint quality_ncrs_title_length check (length(btrim(title)) >= 5),
  constraint quality_ncrs_description_length check (length(btrim(description)) >= 20)
);

create index if not exists quality_ncrs_status_idx on public.quality_ncrs (status, detected_at desc);
create index if not exists quality_ncrs_lot_idx on public.quality_ncrs (lot_id);
create index if not exists quality_ncrs_severity_idx on public.quality_ncrs (severity);

comment on table public.quality_ncrs is
  'A recorded non-conformance and its investigation. Distinct from a disposition: the disposition decides the stock, the NCR decides the process.';

create table if not exists public.quality_capa_actions (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  ncr_id uuid references public.quality_ncrs (id) on delete restrict on update cascade,

  action_type text not null default 'corrective',
  title text not null,
  description text not null,

  owner_employee_id uuid references public.employees (id) on delete set null on update cascade,
  due_date date,

  status text not null default 'open',
  status_reason text,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null on update cascade,

  -- Verification is a separate step with its own permission: an action its owner says is done is not yet verified.
  verification_notes text,
  verified_by uuid references public.profiles (id) on delete set null on update cascade,
  verified_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quality_capa_actions_reference_unique unique (reference),
  constraint quality_capa_actions_type_check check (action_type in ('corrective', 'preventive')),
  constraint quality_capa_actions_status_check
    check (status in ('open', 'in_progress', 'completed', 'verified', 'cancelled')),
  constraint quality_capa_actions_title_length check (length(btrim(title)) >= 5),
  constraint quality_capa_actions_verification_shape
    check ((status = 'verified' and verified_at is not null and verification_notes is not null)
        or (status <> 'verified'))
);

create index if not exists quality_capa_actions_ncr_idx on public.quality_capa_actions (ncr_id);
create index if not exists quality_capa_actions_open_idx
  on public.quality_capa_actions (status) where status in ('open', 'in_progress');

-- ---------------------------------------------------------------------------
-- Numbering and lifecycle guards
-- ---------------------------------------------------------------------------

create or replace function private.assign_quality_ncr_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null then
    new.reference := private.next_quality_reference('quality_ncr');
  end if;
  new.detected_by := coalesce(new.detected_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists quality_ncrs_defaults on public.quality_ncrs;
create trigger quality_ncrs_defaults
  before insert on public.quality_ncrs
  for each row execute function private.assign_quality_ncr_defaults();

drop trigger if exists quality_ncrs_lifecycle on public.quality_ncrs;
create trigger quality_ncrs_lifecycle
  before update on public.quality_ncrs
  for each row execute function private.guard_quality_status('quality_ncr', 'reference');

create or replace function private.assign_quality_capa_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null then
    new.reference := private.next_quality_reference('quality_capa');
  end if;
  return new;
end;
$$;

drop trigger if exists quality_capa_actions_defaults on public.quality_capa_actions;
create trigger quality_capa_actions_defaults
  before insert on public.quality_capa_actions
  for each row execute function private.assign_quality_capa_defaults();

drop trigger if exists quality_capa_actions_lifecycle on public.quality_capa_actions;
create trigger quality_capa_actions_lifecycle
  before update on public.quality_capa_actions
  for each row execute function private.guard_quality_status('quality_capa', 'reference');

-- ---------------------------------------------------------------------------
-- Closing an NCR
-- ---------------------------------------------------------------------------

create or replace function public.quality_close_ncr(p_ncr_id uuid, p_root_cause text, p_reason text)
returns public.quality_ncrs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ncr public.quality_ncrs;
  open_actions int;
begin
  if auth.uid() is not null and not private.has_permission('quality.ncr.close') then
    raise exception 'Closing a non-conformance requires permission quality.ncr.close'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Closing a non-conformance requires a reason of at least 10 characters'
      using errcode = 'check_violation';
  end if;

  select * into ncr from public.quality_ncrs where id = p_ncr_id for update;
  if ncr.id is null then
    raise exception 'That non-conformance does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if ncr.status in ('closed', 'cancelled') then
    raise exception 'Non-conformance % is already %', ncr.reference, ncr.status
      using errcode = 'check_violation';
  end if;

  select count(*) into open_actions
    from public.quality_capa_actions a
   where a.ncr_id = ncr.id
     and a.status in ('open', 'in_progress');

  if open_actions > 0 then
    raise exception 'Non-conformance % still has % corrective/preventive action(s) open. Complete or cancel them before closing it.',
      ncr.reference, open_actions
      using errcode = 'check_violation';
  end if;

  update public.quality_ncrs
     set status = 'closed',
         root_cause = coalesce(nullif(btrim(p_root_cause), ''), root_cause),
         closed_at = now(),
         closed_by = coalesce(auth.uid(), closed_by),
         status_reason = p_reason,
         updated_by = coalesce(auth.uid(), updated_by),
         updated_at = now()
   where id = ncr.id
  returning * into ncr;

  return ncr;
end;
$$;

create or replace function public.quality_verify_capa(p_action_id uuid, p_notes text)
returns public.quality_capa_actions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  action public.quality_capa_actions;
begin
  if auth.uid() is not null and not private.has_permission('quality.capa.verify') then
    raise exception 'Verifying a corrective action requires permission quality.capa.verify'
      using errcode = 'insufficient_privilege';
  end if;

  if p_notes is null or length(btrim(p_notes)) < 20 then
    raise exception 'Verification requires a note of at least 20 characters describing the evidence'
      using errcode = 'check_violation';
  end if;

  select * into action from public.quality_capa_actions where id = p_action_id for update;
  if action.id is null then
    raise exception 'That action does not exist, or you cannot see it' using errcode = 'check_violation';
  end if;
  if action.status <> 'completed' then
    raise exception 'Action % is %; only a completed action can be verified', action.reference, action.status
      using errcode = 'check_violation';
  end if;

  update public.quality_capa_actions
     set status = 'verified',
         verification_notes = p_notes,
         verified_by = coalesce(auth.uid(), verified_by),
         verified_at = now(),
         updated_by = coalesce(auth.uid(), updated_by),
         updated_at = now()
   where id = action.id
  returning * into action;

  return action;
end;
$$;
