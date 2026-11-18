-- 0030 — master data foundation
--
-- Shared machinery for every Phase 2 master entity:
--   * permission actions used by master-data codes (verify, block, archive, review, execute)
--   * configurable business-reference numbering (PA-SUP-000001 and friends)
--   * configurable, permission-controlled lifecycle transitions per entity type
--   * record-level change history captured by trigger (never by forgotten application code)

-- ---------------------------------------------------------------------------
-- 1. Permission action vocabulary
-- ---------------------------------------------------------------------------
-- Phase 1 fixed 20 actions. Master data needs five more verbs. The vocabulary stays closed:
-- permission codes remain `module.resource.action` and administrators still cannot invent
-- codes at runtime.

alter table public.permissions drop constraint if exists permissions_action_check;

alter table public.permissions
  add constraint permissions_action_check
    check (action in (
      'view', 'create', 'update', 'delete', 'submit', 'approve', 'reject', 'cancel',
      'export', 'print', 'manage', 'configure', 'post', 'adjust', 'deactivate',
      'invite', 'activate', 'suspend', 'revoke', 'assign',
      'verify', 'block', 'archive', 'review', 'execute'
    ));

-- Master data events get their own audit category so governance reporting can separate them from
-- identity and account events (spec §15.4 event families).
alter table public.audit_logs drop constraint if exists audit_logs_event_category_check;
alter table public.audit_logs
  add constraint audit_logs_event_category_check
    check (event_category in ('authentication', 'employee_management', 'account_management',
                              'authorization', 'governance', 'system_administration',
                              'master_data', 'general'));

-- ---------------------------------------------------------------------------
-- 2. Configurable business references
-- ---------------------------------------------------------------------------
-- Internal keys are UUIDs. Humans need readable references. Both the prefix and the padding
-- are configuration, not code, so a future policy change ("switch to PA-SUP-24-0001") does
-- not require a migration.

create table if not exists public.master_data_entities (
  entity text primary key,
  prefix text not null,
  padding int not null default 6,
  description text,
  last_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_data_entities_prefix_format check (prefix ~ '^[A-Z0-9][A-Z0-9-]{1,7}$'),
  constraint master_data_entities_padding_range check (padding between 3 and 12)
);

comment on table public.master_data_entities is
  'Reference-numbering policy per master entity. Prefix and padding are administrative configuration.';

insert into public.master_data_entities (entity, prefix, padding, description)
values
  ('supplier', 'PA-SUP', 6, 'Supplier master records'),
  ('customer', 'PA-CUS', 6, 'Customer master records'),
  ('product', 'PA-PRD', 6, 'Product master records'),
  ('product_variant', 'PA-VAR', 6, 'Product variants and grades'),
  ('warehouse', 'PA-WH', 6, 'Warehouse records'),
  ('site', 'PA-SIT', 6, 'Business site records'),
  ('warehouse_location', 'PA-LOC', 6, 'Storage locations')
on conflict (entity) do nothing;

/**
 * Allocates the next business reference for an entity (e.g. PA-SUP-000001).
 *
 * The counter is bumped under a row lock, so two concurrent creates can never share a
 * reference. Called from the master tables' insert triggers, never from the browser.
 */
create or replace function private.next_master_reference(target_entity text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec public.master_data_entities;
begin
  update public.master_data_entities
     set last_value = last_value + 1,
         updated_at = now()
   where entity = target_entity
  returning * into rec;

  if rec.entity is null then
    raise exception 'Unknown master data entity: %', target_entity;
  end if;

  return rec.prefix || '-' || lpad(rec.last_value::text, rec.padding, '0');
end;
$$;

revoke all on function private.next_master_reference(text) from public;

-- ---------------------------------------------------------------------------
-- 3. Configurable lifecycle transitions
-- ---------------------------------------------------------------------------
-- Whether a supplier may move from DRAFT to VERIFIED is company policy, not code. The rules
-- live in a table an administrator can inspect and adjust, and the trigger below refuses any
-- transition that is not declared here.

create table if not exists public.master_data_status_transitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  from_status text not null,
  to_status text not null,
  required_permission text,
  requires_reason boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  constraint master_data_status_transitions_distinct check (from_status <> to_status),
  constraint master_data_status_transitions_unique unique (entity_type, from_status, to_status)
);

create index if not exists master_data_status_transitions_lookup_idx
  on public.master_data_status_transitions (entity_type, from_status);

comment on table public.master_data_status_transitions is
  'Declared lifecycle transitions per master entity. Any transition absent from this table is rejected by trigger.';

-- Supplier lifecycle (spec §5.3).
insert into public.master_data_status_transitions (entity_type, from_status, to_status, required_permission, requires_reason, description)
values
  ('supplier', 'draft', 'submitted', 'master_data.suppliers.create', false, 'Submit a draft for review'),
  ('supplier', 'submitted', 'under_review', 'master_data.suppliers.verify', false, 'Reviewer picks up the submission'),
  ('supplier', 'under_review', 'rejected', 'master_data.suppliers.verify', true, 'Review rejected'),
  ('supplier', 'under_review', 'verified', 'master_data.suppliers.verify', false, 'Documents verified'),
  ('supplier', 'rejected', 'submitted', 'master_data.suppliers.update', false, 'Re-submit after correction'),
  ('supplier', 'verified', 'active', 'master_data.suppliers.activate', false, 'Approved for procurement'),
  ('supplier', 'active', 'inactive', 'master_data.suppliers.activate', true, 'Temporarily not trading'),
  ('supplier', 'inactive', 'active', 'master_data.suppliers.activate', false, 'Reactivated'),
  ('supplier', 'active', 'blocked', 'master_data.suppliers.block', true, 'Blocked from procurement'),
  ('supplier', 'inactive', 'blocked', 'master_data.suppliers.block', true, 'Blocked from procurement'),
  ('supplier', 'blocked', 'inactive', 'master_data.suppliers.block', true, 'Block lifted, remains inactive'),
  ('supplier', 'active', 'archived', 'master_data.suppliers.archive', true, 'Permanently archived'),
  ('supplier', 'inactive', 'archived', 'master_data.suppliers.archive', true, 'Permanently archived'),
  ('supplier', 'blocked', 'archived', 'master_data.suppliers.archive', true, 'Permanently archived'),
  -- Customer lifecycle (spec §6.3).
  ('customer', 'lead', 'prospect', 'master_data.customers.update', false, 'Qualified as a prospect'),
  ('customer', 'prospect', 'onboarding', 'master_data.customers.update', false, 'Onboarding started'),
  ('customer', 'onboarding', 'verified', 'master_data.customers.activate', false, 'Onboarding documents verified'),
  ('customer', 'verified', 'active', 'master_data.customers.activate', false, 'Approved for trade'),
  ('customer', 'active', 'inactive', 'master_data.customers.activate', true, 'Temporarily not trading'),
  ('customer', 'inactive', 'active', 'master_data.customers.activate', false, 'Reactivated'),
  ('customer', 'active', 'blocked', 'master_data.customers.block', true, 'Blocked from trade'),
  ('customer', 'inactive', 'blocked', 'master_data.customers.block', true, 'Blocked from trade'),
  ('customer', 'blocked', 'inactive', 'master_data.customers.block', true, 'Block lifted, remains inactive'),
  ('customer', 'active', 'archived', 'master_data.customers.archive', true, 'Permanently archived'),
  ('customer', 'inactive', 'archived', 'master_data.customers.archive', true, 'Permanently archived'),
  ('customer', 'blocked', 'archived', 'master_data.customers.archive', true, 'Permanently archived'),
  -- Product lifecycle (spec §7.3).
  ('product', 'draft', 'active', 'master_data.products.activate', false, 'Approved for operational use'),
  ('product', 'active', 'inactive', 'master_data.products.activate', true, 'Temporarily unavailable'),
  ('product', 'inactive', 'active', 'master_data.products.activate', false, 'Reactivated'),
  ('product', 'active', 'discontinued', 'master_data.products.activate', true, 'No longer produced'),
  ('product', 'inactive', 'discontinued', 'master_data.products.activate', true, 'No longer produced'),
  ('product', 'discontinued', 'archived', 'master_data.products.archive', true, 'Permanently archived'),
  ('product', 'inactive', 'archived', 'master_data.products.archive', true, 'Permanently archived')
on conflict (entity_type, from_status, to_status) do nothing;

/**
 * Validates a master-record status change against the configured transition table.
 * Returns the transition row (so the caller can enforce `requires_reason`).
 */
create or replace function private.assert_master_status_transition(
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
declare
  declared boolean;
begin
  if p_from_status is null or p_from_status = p_to_status then
    return;
  end if;

  select exists (
    select 1
      from public.master_data_status_transitions t
     where t.entity_type = p_entity
       and t.from_status = p_from_status
       and t.to_status = p_to_status
  ) into declared;

  if not declared then
    raise exception 'Illegal % status transition: % -> %. Configure it in master data settings first.',
      p_entity, p_from_status, p_to_status
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Record-level change history
-- ---------------------------------------------------------------------------
-- audit_logs is the governance record: who did what, with severity and request correlation.
-- master_data_change_history is the record-level diff trail a data steward reads when asking
-- "what exactly changed on this supplier". Both are written; neither replaces the other.

create table if not exists public.master_data_change_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  entity_reference text,
  change_type text not null default 'updated',
  changed_fields text[] not null default '{}',
  old_values jsonb,
  new_values jsonb,
  reason text,
  actor_user_id uuid references public.profiles (id) on delete set null on update cascade,
  actor_employee_id uuid references public.employees (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint master_data_change_history_type_check
    check (change_type in ('created', 'updated', 'status_changed', 'verified', 'merged', 'imported'))
);

create index if not exists master_data_change_history_entity_idx
  on public.master_data_change_history (entity_type, entity_id, created_at desc);
create index if not exists master_data_change_history_created_idx
  on public.master_data_change_history (created_at desc);

comment on table public.master_data_change_history is
  'Append-only field-level trail for master records. Written by trigger; application code never writes it directly.';

/**
 * Generic master-record history trigger.
 *
 * Attach to any master table that has `id` and a `reference`-like business key. It records
 * inserts, deletes-changes and field-level diffs, and it never stores more than it must:
 * unchanged fields are omitted so the trail stays readable.
 */
create or replace function private.record_master_data_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  employee uuid := private.current_employee_id();
  entity text := tg_argv[0];
  reference text;
  old_json jsonb;
  new_json jsonb;
  changed text[];
  change_kind text := 'updated';
begin
  if tg_op = 'INSERT' then
    new_json := to_jsonb(new);
    reference := coalesce(new_json ->> 'reference', new_json ->> 'code', new_json ->> 'name');
    insert into public.master_data_change_history
      (entity_type, entity_id, entity_reference, change_type, changed_fields, new_values, actor_user_id, actor_employee_id)
    values
      (entity, new.id, reference, 'created', array[]::text[], new_json, actor, employee);
    return new;
  end if;

  old_json := to_jsonb(old);
  new_json := to_jsonb(new);
  reference := coalesce(new_json ->> 'reference', new_json ->> 'code', new_json ->> 'name');

  select coalesce(array_agg(key order by key), array[]::text[])
    into changed
    from jsonb_each(new_json) as e(key, value)
   where old_json -> key is distinct from value
     and key not in ('updated_at', 'updated_by');

  if changed = array[]::text[] then
    return new;
  end if;

  if 'status' = any (changed) then
    change_kind := 'status_changed';
  elsif 'verification_status' = any (changed) then
    change_kind := 'verified';
  end if;

  insert into public.master_data_change_history
    (entity_type, entity_id, entity_reference, change_type, changed_fields, old_values, new_values, actor_user_id, actor_employee_id)
  values
    (entity, new.id, reference, change_kind, changed,
     (select jsonb_object_agg(key, old_json -> key) from unnest(changed) as key),
     (select jsonb_object_agg(key, new_json -> key) from unnest(changed) as key),
     actor, employee);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Shared master-record triggers
-- ---------------------------------------------------------------------------

/** Assigns the configured business reference when the caller did not supply one. */
create or replace function private.assign_master_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := private.next_master_reference(tg_argv[0]);
  end if;
  return new;
end;
$$;

/**
 * Enforces the configured lifecycle: a status may only change along a declared edge, and a
 * transition declared as requiring a reason must arrive with one in `status_reason`.
 */
create or replace function private.guard_master_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.master_data_status_transitions;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform private.assert_master_status_transition(tg_argv[0], old.status, new.status);

  select * into rule
    from public.master_data_status_transitions t
   where t.entity_type = tg_argv[0]
     and t.from_status = old.status
     and t.to_status = new.status;

  -- The transition table also names the permission required for the edge, so a user who can
  -- edit a supplier cannot quietly promote it to verified by writing SQL through the API.
  if rule.required_permission is not null
     and auth.uid() is not null
     and not private.has_permission(rule.required_permission) then
    raise exception 'Moving % from % to % requires permission %', tg_argv[0], old.status, new.status, rule.required_permission
      using errcode = 'insufficient_privilege';
  end if;

  -- The reason must accompany *this* transition. A reason left over from an earlier change is not
  -- evidence for a new one, so the value has to differ from the row's current reason.
  if rule.requires_reason then
    if new.status_reason is null
       or length(btrim(new.status_reason)) < 10
       or new.status_reason is not distinct from old.status_reason then
      raise exception 'A reason of at least 10 characters must be supplied with the move of % from % to %.',
        tg_argv[0], old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

/**
 * Convenience installer: reference assignment, status guard, history trail and updated_at.
 * Master tables call this once in their migration instead of repeating four triggers.
 */
create or replace function private.install_master_triggers(target_table regclass, entity text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  execute format('drop trigger if exists %I on %s', entity || '_assign_reference', target_table);
  execute format(
    'create trigger %I before insert on %s for each row execute function private.assign_master_reference(%L)',
    entity || '_assign_reference', target_table, entity);

  execute format('drop trigger if exists %I on %s', entity || '_status_guard', target_table);
  execute format(
    'create trigger %I before update on %s for each row execute function private.guard_master_status(%L)',
    entity || '_status_guard', target_table, entity);

  execute format('drop trigger if exists %I on %s', entity || '_history', target_table);
  execute format(
    'create trigger %I after insert or update on %s for each row execute function private.record_master_data_change(%L)',
    entity || '_history', target_table, entity);
end;
$$;
