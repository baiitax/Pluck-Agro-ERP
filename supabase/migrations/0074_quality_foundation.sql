-- 0074 — quality management foundation
--
-- Shared machinery for Phase 5, mirroring the contract Phases 3 and 4 established, so the system has one
-- recognisable shape for numbering, lifecycles, configuration and audit across every module:
--   * the permission verbs quality documents need, and the `quality` audit category
--   * configurable reference numbering (PA-QSP-2026-0001, PA-QIN-…, PA-QNC-…, PA-QCA-…, PA-QCO-…)
--     allocated under a row lock
--   * configurable, permission-controlled lifecycles per document type, with an append-only trail
--   * editable policy switches whose absent row is a refusal, not a default
--
-- Deliberately NOT here, and deliberately not anywhere in Phase 5:
--   * any quality limit. Moisture, purity, impurity, grading bands and acceptance criteria are commercial
--     and technical definitions owned by Pluck Agro. They arrive as specification rows an authorised person
--     approves; nothing in the migrations seeds a limit, and a specification with no limits can be created
--     but cannot be approved (0075).
--   * any laboratory accreditation, certificate number, method standard or regulatory reference. The only
--     place such a reference can appear is a free-text column an operator fills from a real document.
--
-- The defining constraint of this phase: **a quality hold must actually prevent stock being used**, and a
-- quality release must be the thing that makes stock usable again. A status column that merely says
-- "quarantined" while the ledger still allows a reservation would be a lie, so every hold and release in
-- 0077 writes through the Phase 4 availability function. That seam is the whole point of the phase.

-- ---------------------------------------------------------------------------
-- 1. Permission vocabulary and audit categories
-- ---------------------------------------------------------------------------
-- Each verb names what the quality officer actually does: a sample is collected, a result is recorded, a
-- lot is placed on hold and released. `release` already exists from Phase 4 and means the same thing here:
-- stock returns to availability.

alter table public.permissions drop constraint if exists permissions_action_check;

alter table public.permissions
  add constraint permissions_action_check
    check (action in (
      'view', 'create', 'update', 'delete', 'submit', 'approve', 'reject', 'cancel',
      'export', 'print', 'manage', 'configure', 'post', 'adjust', 'deactivate',
      'invite', 'activate', 'suspend', 'revoke', 'assign',
      'verify', 'block', 'archive', 'review', 'execute',
      -- Phase 3
      'issue', 'amend', 'compare', 'select', 'close', 'upload', 'reconcile',
      -- Phase 4
      'transfer', 'count', 'reserve', 'release', 'consume', 'produce',
      -- Phase 5
      'collect', 'record', 'hold'
    ));

alter table public.audit_logs drop constraint if exists audit_logs_event_category_check;
alter table public.audit_logs
  add constraint audit_logs_event_category_check
    check (event_category in ('authentication', 'employee_management', 'account_management',
                              'authorization', 'governance', 'system_administration',
                              'master_data', 'procurement', 'inventory', 'production',
                              'quality', 'general'));

-- ---------------------------------------------------------------------------
-- 2. Configurable document numbering
-- ---------------------------------------------------------------------------

create table if not exists public.quality_numbering (
  entity text primary key,
  prefix text not null,
  padding int not null default 5,
  include_year boolean not null default true,
  reset_yearly boolean not null default true,
  description text,
  last_period text,
  last_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quality_numbering_prefix_format check (prefix ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  constraint quality_numbering_padding_range check (padding between 3 and 12),
  constraint quality_numbering_value_non_negative check (last_value >= 0)
);

comment on table public.quality_numbering is
  'Reference-numbering policy per quality document. Prefix, padding and yearly reset are administrative configuration; last_value is a lock-protected counter, never a count of rows.';

insert into public.quality_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values
  ('quality_specification', 'PA-QSP', 4, true, true, 'Product quality specifications (one per version)'),
  ('quality_inspection', 'PA-QIN', 6, true, true, 'Quality inspections'),
  ('quality_sample', 'PA-QSM', 6, true, true, 'Samples taken for inspection'),
  ('quality_ncr', 'PA-QNC', 5, true, true, 'Non-conformance reports'),
  ('quality_capa', 'PA-QCA', 5, true, true, 'Corrective and preventive actions'),
  ('quality_certificate', 'PA-QCO', 5, true, true, 'Certificates of analysis issued from inspections')
on conflict (entity) do nothing;

/**
 * Allocates the next quality reference.
 *
 * The counter row is updated in place, which takes a row-level lock, so two concurrent inserts receive
 * different values and no value is ever derived from `count(*)` of existing documents.
 */
create or replace function private.next_quality_reference(p_entity text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec public.quality_numbering;
  period text := to_char(now(), 'YYYY');
begin
  update public.quality_numbering n
     set last_value = case
           when n.include_year and n.reset_yearly and n.last_period is distinct from period then 1
           else n.last_value + 1
         end,
         last_period = case when n.include_year then period else n.last_period end,
         updated_at = now()
   where n.entity = p_entity
  returning * into rec;

  if rec.entity is null then
    raise exception 'Unknown quality numbering entity: %', p_entity
      using errcode = 'check_violation';
  end if;

  return rec.prefix
         || case when rec.include_year then '-' || coalesce(rec.last_period, period) else '' end
         || '-' || lpad(rec.last_value::text, rec.padding, '0');
end;
$$;

revoke all on function private.next_quality_reference(text) from public;

-- ---------------------------------------------------------------------------
-- 3. Configurable document lifecycles
-- ---------------------------------------------------------------------------
-- A status may only move along a declared edge, the edge names the permission it requires, and an edge may
-- demand a written reason. Anything undeclared is refused by trigger, so no screen and no direct API call
-- can invent a transition — including one that would release stock.

create table if not exists public.quality_status_transitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  from_status text not null,
  to_status text not null,
  required_permission text,
  requires_reason boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  constraint quality_status_transitions_distinct check (from_status <> to_status),
  constraint quality_status_transitions_unique unique (entity_type, from_status, to_status)
);

create index if not exists quality_status_transitions_lookup_idx
  on public.quality_status_transitions (entity_type, from_status);

comment on table public.quality_status_transitions is
  'Declared lifecycle edges per quality document type. Any edge absent here is rejected by trigger.';

-- The seeded edges are the ones a quality workflow cannot work without. They are engineering shape, not
-- company policy: they name the order in which an inspection can honestly be completed, not who signs it.
insert into public.quality_status_transitions
  (entity_type, from_status, to_status, required_permission, requires_reason, description)
values
  ('quality_specification', 'draft', 'approved', 'quality.specification.approve', false,
   'Approve a specification version for use in inspections'),
  ('quality_specification', 'draft', 'cancelled', 'quality.specification.approve', true,
   'Abandon a draft version that was never approved'),
  ('quality_specification', 'approved', 'superseded', 'quality.specification.approve', false,
   'A later approved version replaces this one; performed by the approval of its successor'),
  ('quality_specification', 'approved', 'cancelled', 'quality.specification.approve', true,
   'Withdraw an approved specification before any inspection used it'),

  ('quality_inspection', 'draft', 'in_progress', 'quality.result.record', false,
   'Begin recording results against the sampled quantity'),
  ('quality_inspection', 'draft', 'cancelled', 'quality.inspection.manage', true,
   'Abandon an inspection that was never worked on'),
  ('quality_inspection', 'in_progress', 'submitted', 'quality.inspection.submit', false,
   'Submit a completed result set for approval'),
  ('quality_inspection', 'draft', 'submitted', 'quality.inspection.submit', false,
   'Submit in one sitting, without the intermediate in-progress move'),
  ('quality_inspection', 'in_progress', 'cancelled', 'quality.inspection.manage', true,
   'Abandon an inspection part-way through'),
  ('quality_inspection', 'submitted', 'approved', 'quality.inspection.approve', false,
   'Approve the results; this is what allows a disposition to be recorded'),
  ('quality_inspection', 'submitted', 'in_progress', 'quality.inspection.manage', true,
   'Return an inspection for correction'),
  ('quality_inspection', 'submitted', 'rejected', 'quality.inspection.approve', true,
   'Reject the submitted results as unusable'),

  ('quality_ncr', 'open', 'investigating', 'quality.ncr.update', false,
   'Start an investigation into the non-conformance'),
  ('quality_ncr', 'open', 'closed', 'quality.ncr.close', true,
   'Close a non-conformance with no further action'),
  ('quality_ncr', 'investigating', 'closed', 'quality.ncr.close', true,
   'Close the investigation with its root cause and actions recorded'),
  ('quality_ncr', 'investigating', 'cancelled', 'quality.ncr.close', true,
   'Withdraw a non-conformance raised in error'),

  ('quality_capa', 'open', 'in_progress', 'quality.capa.update', false,
   'The assigned owner has begun the action'),
  ('quality_capa', 'open', 'cancelled', 'quality.capa.update', true,
   'Cancel an action that is no longer required'),
  ('quality_capa', 'in_progress', 'completed', 'quality.capa.update', false,
   'The owner reports the action complete'),
  ('quality_capa', 'open', 'completed', 'quality.capa.update', false,
   'The owner reports an action complete without having marked it started'),
  ('quality_capa', 'in_progress', 'cancelled', 'quality.capa.update', true,
   'Cancel an action that is no longer required'),
  ('quality_capa', 'completed', 'verified', 'quality.capa.verify', true,
   'Quality verifies that the action had the effect intended'),
  ('quality_capa', 'completed', 'in_progress', 'quality.capa.verify', true,
   'Verification found the action ineffective; it is reopened')
on conflict (entity_type, from_status, to_status) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Append-only status trail
-- ---------------------------------------------------------------------------

create table if not exists public.quality_status_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  entity_reference text,
  from_status text,
  to_status text not null,
  reason text,
  actor_user_id uuid references public.profiles (id) on delete set null on update cascade,
  actor_employee_id uuid references public.employees (id) on delete set null on update cascade,
  created_at timestamptz not null default now()
);

create index if not exists quality_status_history_entity_idx
  on public.quality_status_history (entity_type, entity_id, created_at desc);
create index if not exists quality_status_history_created_idx
  on public.quality_status_history (created_at desc);

comment on table public.quality_status_history is
  'Append-only lifecycle trail for quality documents. Written by trigger; application code never inserts here.';

create or replace function private.block_quality_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The quality status trail is append-only' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists quality_status_history_no_mutation on public.quality_status_history;
create trigger quality_status_history_no_mutation
  before update or delete on public.quality_status_history
  for each row execute function private.block_quality_history_mutation();

-- ---------------------------------------------------------------------------
-- 5. Lifecycle guard
-- ---------------------------------------------------------------------------

create or replace function private.assert_quality_transition(
  p_entity text,
  p_from_status text,
  p_to_status text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_from_status is null or p_to_status is null or p_from_status = p_to_status then
    return;
  end if;

  if not exists (
    select 1
      from public.quality_status_transitions t
     where t.entity_type = p_entity
       and t.from_status = p_from_status
       and t.to_status = p_to_status
  ) then
    raise exception 'Illegal % status transition: % -> %. Configure it in the quality lifecycle first.',
      p_entity, p_from_status, p_to_status
      using errcode = 'check_violation';
  end if;
end;
$$;

/**
 * Enforces the declared lifecycle on a quality document table.
 *
 * Registered with two trigger arguments: the entity type and the column holding the human-readable
 * reference, which is copied into the trail so an auditor reads "PA-QIN-2026-000004 was approved"
 * without needing a join.
 *
 * The permission check is skipped when there is no authenticated caller (`auth.uid()` is null), which is
 * the migration, service-role and test context. Every application path arrives with a JWT, so in practice
 * the check always runs; the exemption exists so a database migration or an administrative repair is not
 * blocked by a permission that is meaningless outside a session.
 */
create or replace function private.guard_quality_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.quality_status_transitions;
  entity text := tg_argv[0];
  reference text;
  new_json jsonb := to_jsonb(new);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform private.assert_quality_transition(entity, old.status, new.status);

  select * into rule
    from public.quality_status_transitions t
   where t.entity_type = entity
     and t.from_status = old.status
     and t.to_status = new.status;

  if rule.required_permission is not null
     and auth.uid() is not null
     and not private.has_permission(rule.required_permission) then
    raise exception 'Moving % from % to % requires permission %',
      entity, old.status, new.status, rule.required_permission
      using errcode = 'insufficient_privilege';
  end if;

  if rule.requires_reason then
    if new_json ->> 'status_reason' is null
       or length(btrim(new_json ->> 'status_reason')) < 10
       or (new_json ->> 'status_reason') is not distinct from (to_jsonb(old) ->> 'status_reason') then
      raise exception 'A reason of at least 10 characters must be supplied with the move of % from % to %.',
        entity, old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  if coalesce(array_length(tg_argv, 1), 0) > 1 then
    reference := new_json ->> tg_argv[1];
  end if;

  insert into public.quality_status_history
    (entity_type, entity_id, entity_reference, from_status, to_status, reason,
     actor_user_id, actor_employee_id)
  values
    (entity, new.id, reference, old.status, new.status, new_json ->> 'status_reason',
     auth.uid(), private.current_employee_id());

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Policy switches
-- ---------------------------------------------------------------------------
-- Same rule as Phase 4: every default is the conservative reading, and where no row exists the calling
-- function refuses rather than assuming a value. Nothing here decides a limit or a sampling number.

create table if not exists public.quality_settings (
  key text primary key,
  value_text text,
  value_numeric numeric(18, 6),
  value_boolean boolean,
  description text not null,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_at timestamptz not null default now(),
  constraint quality_settings_key_format check (key ~ '^[a-z][a-z0-9_.]{2,63}$')
);

comment on table public.quality_settings is
  'Editable quality policy switches. A switch that would encode a company decision (retest interval, sample size) is deliberately stored with no default and its absence is a refusal.';

insert into public.quality_settings (key, value_boolean, description)
values
  ('inspection.require_approval_before_disposition', true,
   'A disposition may only be recorded against an approved inspection. Turning this off would let an unapproved result release stock.'),
  ('hold.require_reason', true,
   'Placing a lot on quality hold requires a written reason.'),
  ('certificate.require_release_disposition', true,
   'A certificate of analysis may only be issued for an inspection whose disposition was release.'),
  ('inspection.allow_partial_result_submission', false,
   'When false, every mandatory specification parameter must carry a result before an inspection can be submitted.')
on conflict (key) do nothing;

-- Deliberately seeded with no value: Pluck Agro states these, and a guessed number would silently become a
-- quality decision. The functions read them and refuse with an explanatory message while they are unset.
insert into public.quality_settings (key, value_text, value_numeric, description)
values
  ('inspection.retest_interval_days', null, null,
   'Days after which a released lot must be retested. Unset until Pluck Agro states the interval; the system does not invent one.'),
  ('inspection.default_sample_basis', null, null,
   'Default sampling basis (percentage or fixed) when no sampling plan applies. Unset until Pluck Agro states its sampling policy.')
on conflict (key) do nothing;

create or replace function public.quality_setting_boolean(p_key text, p_default boolean default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result boolean;
begin
  select value_boolean into result from public.quality_settings where key = p_key;

  if result is null then
    if p_default is null then
      raise exception 'Quality policy setting % has not been configured', p_key
        using errcode = 'check_violation';
    end if;
    return p_default;
  end if;

  return result;
end;
$$;

revoke all on function public.quality_setting_boolean(text, boolean) from public;
grant execute on function public.quality_setting_boolean(text, boolean) to authenticated, service_role;
