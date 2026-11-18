-- 0058 — inventory foundation
--
-- Shared machinery for Phase 4, mirroring the contract Phase 3 established for procurement so there is
-- one recognisable shape for numbering, lifecycles and configuration across the system:
--   * the permission verbs inventory and production documents need, and the two audit categories
--   * configurable reference numbering with a period (PA-LOT-2026-000001) allocated under a row lock
--   * configurable, permission-controlled lifecycles per document type, with an append-only trail
--   * editable policy switches whose absent row is a refusal, not a default
--
-- Deliberately NOT here: any quantity. The movement ledger arrives in 0059 and is the only source of
-- stock. Nothing in this file may hold a balance, because a column that holds a balance is a column
-- that drifts from the movements that produced it.

-- ---------------------------------------------------------------------------
-- 1. Permission vocabulary and audit categories
-- ---------------------------------------------------------------------------
-- The action vocabulary stays closed; these are the verbs a movement ledger and a factory need and
-- that no earlier phase required. `reserve` and `release` are named for what they do to an
-- availability position, not for an approval decision.

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
      'transfer', 'count', 'reserve', 'release', 'consume', 'produce'
    ));

alter table public.audit_logs drop constraint if exists audit_logs_event_category_check;
alter table public.audit_logs
  add constraint audit_logs_event_category_check
    check (event_category in ('authentication', 'employee_management', 'account_management',
                              'authorization', 'governance', 'system_administration',
                              'master_data', 'procurement', 'inventory', 'production',
                              'general'));

-- ---------------------------------------------------------------------------
-- 2. Configurable document numbering
-- ---------------------------------------------------------------------------
-- Same shape as procurement_numbering and for the same reason: a reference embeds a period, so a
-- yearly reset is expressed in the counter rather than derived from the number of existing rows.

create table if not exists public.inventory_numbering (
  entity text primary key,
  prefix text not null,
  padding int not null default 6,
  include_year boolean not null default true,
  reset_yearly boolean not null default true,
  description text,
  last_period text,
  last_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_numbering_prefix_format check (prefix ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  constraint inventory_numbering_padding_range check (padding between 3 and 12),
  constraint inventory_numbering_value_non_negative check (last_value >= 0)
);

comment on table public.inventory_numbering is
  'Reference-numbering policy per inventory and production document. Prefix, padding and yearly reset are administrative configuration; last_value is a lock-protected counter, never a count of rows.';

insert into public.inventory_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values
  ('inventory_lot', 'PA-LOT', 6, true, true, 'Inventory lots'),
  ('inventory_movement', 'PA-MOV', 8, true, true, 'Stock ledger movements'),
  ('inventory_transfer', 'PA-TRF', 5, true, true, 'Stock transfers'),
  ('inventory_reservation', 'PA-RSV', 6, true, true, 'Stock reservations'),
  ('inventory_stock_count', 'PA-CNT', 4, true, true, 'Stock counts'),
  ('inventory_adjustment', 'PA-ADJ', 5, true, true, 'Stock adjustments'),
  ('inventory_restriction', 'PA-RST', 6, true, true, 'Availability restrictions, including quality holds'),
  ('production_plan', 'PA-PLN', 5, true, true, 'Production plans'),
  ('production_batch', 'PA-BAT', 6, true, true, 'Production batches')
on conflict (entity) do nothing;

/**
 * Allocates the next inventory/production reference.
 *
 * The counter row is updated in place, which takes a row-level lock: two concurrent inserts get
 * different values, and no value is derived from `count(*)` of existing documents.
 */
create or replace function private.next_inventory_reference(p_entity text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec public.inventory_numbering;
  period text := to_char(now(), 'YYYY');
begin
  update public.inventory_numbering n
     set last_value = case
           when n.include_year and n.reset_yearly and n.last_period is distinct from period then 1
           else n.last_value + 1
         end,
         last_period = case when n.include_year then period else n.last_period end,
         updated_at = now()
   where n.entity = p_entity
  returning * into rec;

  if rec.entity is null then
    raise exception 'Unknown inventory numbering entity: %', p_entity
      using errcode = 'check_violation';
  end if;

  return rec.prefix
         || case when rec.include_year then '-' || coalesce(rec.last_period, period) else '' end
         || '-' || lpad(rec.last_value::text, rec.padding, '0');
end;
$$;

revoke all on function private.next_inventory_reference(text) from public;

-- ---------------------------------------------------------------------------
-- 3. Configurable document lifecycles
-- ---------------------------------------------------------------------------
-- Same contract as master data and procurement: a status may only move along a declared edge, the
-- edge names the permission it requires, and an edge may demand a written reason. Anything undeclared
-- is refused by trigger, so no screen and no direct API call can invent a transition.

create table if not exists public.inventory_status_transitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  from_status text not null,
  to_status text not null,
  required_permission text,
  requires_reason boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  constraint inventory_status_transitions_distinct check (from_status <> to_status),
  constraint inventory_status_transitions_unique unique (entity_type, from_status, to_status)
);

create index if not exists inventory_status_transitions_lookup_idx
  on public.inventory_status_transitions (entity_type, from_status);

comment on table public.inventory_status_transitions is
  'Declared lifecycle edges per inventory and production document type. Any edge absent here is rejected by trigger.';

-- ---------------------------------------------------------------------------
-- 4. Append-only status trail
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_status_history (
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

create index if not exists inventory_status_history_entity_idx
  on public.inventory_status_history (entity_type, entity_id, created_at desc);
create index if not exists inventory_status_history_created_idx
  on public.inventory_status_history (created_at desc);

comment on table public.inventory_status_history is
  'Append-only lifecycle trail for inventory and production documents. Written by trigger; application code never inserts here.';

create or replace function private.block_inventory_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The inventory status trail is append-only' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists inventory_status_history_no_mutation on public.inventory_status_history;
create trigger inventory_status_history_no_mutation
  before update or delete on public.inventory_status_history
  for each row execute function private.block_inventory_history_mutation();

-- ---------------------------------------------------------------------------
-- 5. Lifecycle guard
-- ---------------------------------------------------------------------------

create or replace function private.assert_inventory_transition(
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
      from public.inventory_status_transitions t
     where t.entity_type = p_entity
       and t.from_status = p_from_status
       and t.to_status = p_to_status
  ) then
    raise exception 'Illegal % status transition: % -> %. Configure it in the inventory lifecycle first.',
      p_entity, p_from_status, p_to_status
      using errcode = 'check_violation';
  end if;
end;
$$;

/**
 * Enforces the declared lifecycle on an inventory or production document table.
 *
 * Registered with two trigger arguments: the entity type and the column holding the human-readable
 * reference. The reference is copied into the trail so an auditor reads "PA-TRF-2026-00007 was
 * received" without needing a join.
 */
create or replace function private.guard_inventory_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.inventory_status_transitions;
  entity text := tg_argv[0];
  reference text;
  new_json jsonb := to_jsonb(new);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform private.assert_inventory_transition(entity, old.status, new.status);

  select * into rule
    from public.inventory_status_transitions t
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

  insert into public.inventory_status_history
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
-- Every default below is the conservative reading. Where no row exists the calling function refuses
-- rather than assuming a value, except for the two that are genuinely boolean options.

create table if not exists public.inventory_settings (
  key text primary key,
  value_text text,
  value_numeric numeric(18, 6),
  value_boolean boolean,
  description text not null,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_at timestamptz not null default now(),
  constraint inventory_settings_key_format check (key ~ '^[a-z][a-z0-9_.]{2,63}$')
);

comment on table public.inventory_settings is
  'Editable inventory policy switches. No valuation method, yield formula or grading threshold is stored here: those are company decisions recorded by the company, and the system ships none of them.';

insert into public.inventory_settings (key, value_text, value_numeric, value_boolean, description)
values
  ('negative_stock_allowed', null, null, false,
   'When false, a movement that would take a lot or a warehouse below zero is refused. Default false: a negative balance is a data error, not a state to tolerate.'),
  ('reservation_expiry_days', null, 30, null,
   'Default lifetime of a reservation in days. A reservation past its expiry stops reducing availability and is reported as expired, rather than silently holding stock forever.'),
  ('transfer_requires_receipt', null, null, true,
   'When true a stock transfer must be received at its destination before the stock counts as available there. Dispatch alone places the quantity in transit.'),
  ('stock_count_requires_approval', null, null, true,
   'When true the variances from a completed stock count must be approved before adjustment movements are posted.'),
  ('adjustment_requires_approval', null, null, true,
   'When true a manual stock adjustment must be approved before it posts.'),
  ('production_output_creates_lot', null, null, true,
   'When true each production output line creates or extends an inventory lot, so finished goods are traceable to the batch that made them.'),
  ('lot_tracking_required', null, null, true,
   'When true no movement may be posted without a lot. Default true: the ledger is lot-based, and untracked stock cannot be traced or held.')
on conflict (key) do nothing;

drop trigger if exists inventory_settings_set_updated_at on public.inventory_settings;
create trigger inventory_settings_set_updated_at
  before update on public.inventory_settings
  for each row execute function private.set_updated_at();

create or replace function private.inventory_setting_numeric(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value_numeric from public.inventory_settings where key = p_key;
$$;

create or replace function private.inventory_setting_boolean(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(value_boolean, false) from public.inventory_settings where key = p_key;
$$;

revoke all on function private.inventory_setting_numeric(text) from public;
revoke all on function private.inventory_setting_boolean(text) from public;

-- ---------------------------------------------------------------------------
-- 7. Document lifecycles
-- ---------------------------------------------------------------------------
-- Transfer: a stock movement between warehouses. Dispatch and receipt are separate steps, because
-- stock that has left one warehouse and not arrived at the other is in transit and must be visible.
-- Stock count: a physical count whose variances become adjustment movements once approved.
-- Adjustment: a correction requiring approval, which posts compensating movements.

insert into public.inventory_status_transitions
  (entity_type, from_status, to_status, required_permission, requires_reason, description)
values
  -- ---------------------------------------------------------------- stock transfer
  ('stock_transfer', 'draft', 'submitted', 'inventory.transfer.create', false, 'Sent for approval'),
  ('stock_transfer', 'submitted', 'approved', 'inventory.transfer.approve', false, 'Approved for dispatch'),
  ('stock_transfer', 'submitted', 'rejected', 'inventory.transfer.approve', true, 'Rejected with a reason'),
  ('stock_transfer', 'approved', 'dispatched', 'inventory.transfer.execute', false, 'Stock has left the source warehouse'),
  ('stock_transfer', 'dispatched', 'received', 'inventory.transfer.execute', false, 'Stock has arrived at the destination'),
  ('stock_transfer', 'dispatched', 'cancelled', 'inventory.transfer.approve', true, 'Abandoned in transit with a documented reason'),
  ('stock_transfer', 'draft', 'cancelled', 'inventory.transfer.create', true, 'Abandoned before approval'),
  ('stock_transfer', 'submitted', 'cancelled', 'inventory.transfer.approve', true, 'Abandoned before approval'),

  -- ---------------------------------------------------------------- stock count
  ('stock_count', 'draft', 'counting', 'inventory.count.execute', false, 'Counting has started'),
  ('stock_count', 'counting', 'counted', 'inventory.count.execute', false, 'All lines counted'),
  ('stock_count', 'counted', 'submitted', 'inventory.count.execute', false, 'Variances sent for approval'),
  ('stock_count', 'submitted', 'approved', 'inventory.count.approve', false, 'Variances approved'),
  ('stock_count', 'submitted', 'rejected', 'inventory.count.approve', true, 'Variances rejected; recount required'),
  ('stock_count', 'rejected', 'counting', 'inventory.count.execute', true, 'Recounting after rejection'),
  ('stock_count', 'approved', 'posted', 'inventory.count.approve', false, 'Adjustment movements written; the count is closed'),
  ('stock_count', 'draft', 'cancelled', 'inventory.count.execute', true, 'Abandoned before counting'),
  ('stock_count', 'counting', 'cancelled', 'inventory.count.execute', true, 'Abandoned mid-count'),

  -- ---------------------------------------------------------------- stock adjustment
  ('stock_adjustment', 'draft', 'submitted', 'inventory.adjustment.create', false, 'Sent for approval'),
  ('stock_adjustment', 'submitted', 'approved', 'inventory.adjustment.approve', false, 'Approved to post'),
  ('stock_adjustment', 'submitted', 'rejected', 'inventory.adjustment.approve', true, 'Rejected with a reason'),
  ('stock_adjustment', 'approved', 'posted', 'inventory.adjustment.approve', false, 'Compensating movements written'),
  ('stock_adjustment', 'draft', 'cancelled', 'inventory.adjustment.create', true, 'Abandoned before approval'),
  ('stock_adjustment', 'submitted', 'cancelled', 'inventory.adjustment.approve', true, 'Abandoned before approval'),

  -- ---------------------------------------------------------------- reservation
  ('stock_reservation', 'active', 'released', 'inventory.reservation.release', false, 'The claim was satisfied or withdrawn'),
  ('stock_reservation', 'active', 'expired', 'inventory.reservation.release', false, 'The reservation passed its expiry'),
  ('stock_reservation', 'active', 'cancelled', 'inventory.reservation.release', true, 'Cancelled before use'),

  -- ---------------------------------------------------------------- availability restriction
  -- Restrictions include quality holds. A restriction is never deleted: releasing it records who
  -- released what quantity and why, so the period during which stock was restricted stays auditable.
  ('inventory_restriction', 'active', 'partially_released', 'inventory.restriction.release', false, 'Part of the restricted quantity was released'),
  ('inventory_restriction', 'active', 'released', 'inventory.restriction.release', false, 'The whole restricted quantity was released'),
  ('inventory_restriction', 'partially_released', 'released', 'inventory.restriction.release', false, 'The remainder was released'),
  ('inventory_restriction', 'active', 'cancelled', 'inventory.restriction.release', true, 'The restriction was created in error'),

  -- ---------------------------------------------------------------- production plan
  ('production_plan', 'draft', 'submitted', 'production.plan.create', false, 'Sent for approval'),
  ('production_plan', 'submitted', 'approved', 'production.plan.approve', false, 'Approved to execute'),
  ('production_plan', 'submitted', 'rejected', 'production.plan.approve', true, 'Rejected with a reason'),
  ('production_plan', 'approved', 'in_progress', 'production.plan.execute', false, 'Work has started'),
  ('production_plan', 'in_progress', 'completed', 'production.plan.execute', false, 'Planned quantity produced'),
  ('production_plan', 'draft', 'cancelled', 'production.plan.create', true, 'Abandoned before approval'),
  ('production_plan', 'submitted', 'cancelled', 'production.plan.approve', true, 'Abandoned before approval'),
  ('production_plan', 'approved', 'cancelled', 'production.plan.approve', true, 'Abandoned before execution'),

  -- ---------------------------------------------------------------- production batch
  -- A batch is operationally completable while its output remains quality-pending. The quality gate is
  -- Phase 5's, and this lifecycle deliberately stops at `completed`, not at `released`.
  ('production_batch', 'draft', 'in_progress', 'production.batch.execute', false, 'Production started'),
  ('production_batch', 'in_progress', 'completed', 'production.batch.execute', false, 'All planned output recorded'),
  ('production_batch', 'completed', 'closed', 'production.batch.close', false, 'Reconciled against its mass balance'),
  ('production_batch', 'in_progress', 'aborted', 'production.batch.execute', true, 'Abandoned mid-run with a reason'),
  ('production_batch', 'completed', 'aborted', 'production.batch.close', true, 'Rejected after completion with a reason'),
  ('production_batch', 'draft', 'cancelled', 'production.batch.execute', true, 'Abandoned before any material was issued')
on conflict (entity_type, from_status, to_status) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Department / reference helpers used by the documents
-- ---------------------------------------------------------------------------

/** True when the caller may act across all departments rather than only their own. */
create or replace function private.has_inventory_oversight()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(private.has_any_permission(array[
    'inventory.stock.manage',
    'inventory.transfer.approve',
    'inventory.count.approve',
    'inventory.adjustment.approve'
  ]), false);
$$;

revoke all on function private.has_inventory_oversight() from public;
grant execute on function private.has_inventory_oversight() to anon, authenticated, service_role;
