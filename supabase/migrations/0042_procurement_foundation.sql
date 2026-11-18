-- 0042 — procurement foundation
--
-- Shared machinery for every Phase 3 transactional document:
--   * the permission verbs procurement needs (issue, amend, compare, select, close, upload,
--     reconcile) added to the closed vocabulary, and a `procurement` audit category
--   * configurable reference numbering that supports a period in the reference
--     (PA-PO-2026-000001) with a yearly reset, allocated under a row lock
--   * configurable, permission-controlled document lifecycles per entity type
--   * an append-only status trail written by trigger, never by application code
--   * the approval decision trail that Phase 1 deliberately did not build, reading Phase 1
--     authority / delegation / segregation-of-duties configuration rather than duplicating it
--
-- Nothing here invents a monetary threshold, a supplier rule or an approval policy: every
-- policy value is a row an administrator edits, and every missing policy row is a refusal rather
-- than a default.

-- ---------------------------------------------------------------------------
-- 1. Permission vocabulary and audit category
-- ---------------------------------------------------------------------------
-- The vocabulary stays closed. A document lifecycle needs verbs the earlier phases did not have:
-- a purchase order is *issued* (not merely activated), an amendment is *amended*, quotations are
-- *compared* and a supplier is *selected*, a completed order is *closed*, documents are
-- *uploaded*, and supplier statements are *reconciled*.

alter table public.permissions drop constraint if exists permissions_action_check;

alter table public.permissions
  add constraint permissions_action_check
    check (action in (
      'view', 'create', 'update', 'delete', 'submit', 'approve', 'reject', 'cancel',
      'export', 'print', 'manage', 'configure', 'post', 'adjust', 'deactivate',
      'invite', 'activate', 'suspend', 'revoke', 'assign',
      'verify', 'block', 'archive', 'review', 'execute',
      -- Phase 3
      'issue', 'amend', 'compare', 'select', 'close', 'upload', 'reconcile'
    ));

alter table public.audit_logs drop constraint if exists audit_logs_event_category_check;
alter table public.audit_logs
  add constraint audit_logs_event_category_check
    check (event_category in ('authentication', 'employee_management', 'account_management',
                              'authorization', 'governance', 'system_administration',
                              'master_data', 'procurement', 'general'));

-- ---------------------------------------------------------------------------
-- 2. Configurable document numbering
-- ---------------------------------------------------------------------------
-- The master-data counter (private.next_master_reference) produces PA-SUP-000001. Procurement
-- references embed the year, so the counter also tracks a period and resets when it rolls over.
-- Both the prefix and the padding are configuration: changing company policy to "PA-PO-26-0001"
-- is an UPDATE, not a migration.

create table if not exists public.procurement_numbering (
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
  constraint procurement_numbering_prefix_format check (prefix ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  constraint procurement_numbering_padding_range check (padding between 3 and 12),
  constraint procurement_numbering_value_non_negative check (last_value >= 0)
);

comment on table public.procurement_numbering is
  'Reference-numbering policy per procurement document. Prefix, padding and yearly reset are administrative configuration; last_value is a lock-protected counter, never a count of rows.';

insert into public.procurement_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values
  ('purchase_requisition', 'PA-REQ', 6, true, true, 'Purchase requisitions'),
  ('supplier_quotation', 'PA-QUO', 6, true, true, 'Supplier quotations'),
  ('purchase_order', 'PA-PO', 6, true, true, 'Purchase orders'),
  ('purchase_order_amendment', 'PA-AMD', 4, true, true, 'Purchase order amendments'),
  ('goods_receipt', 'PA-GRN', 6, true, true, 'Goods receipt notes'),
  ('supplier_advance', 'PA-ADV', 6, true, true, 'Supplier advances'),
  ('supplier_reconciliation', 'PA-REC', 5, true, true, 'Supplier reconciliations')
on conflict (entity) do nothing;

/**
 * Allocates the next reference for a procurement document.
 *
 * The counter row is updated in place, which takes a row-level lock: two concurrent inserts get
 * different values, and no value is ever derived from `count(*)` of existing documents (which
 * would collide after any deletion and would be ambiguous under concurrency).
 *
 * When `include_year` is set the reference carries the current year, and `reset_yearly` restarts
 * the sequence at 1 when the year changes. Both are performed inside the same UPDATE so the
 * period rollover cannot race.
 */
create or replace function private.next_procurement_reference(p_entity text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec public.procurement_numbering;
  period text := to_char(now(), 'YYYY');
begin
  update public.procurement_numbering n
     set last_value = case
           when n.include_year and n.reset_yearly and n.last_period is distinct from period then 1
           else n.last_value + 1
         end,
         last_period = case when n.include_year then period else n.last_period end,
         updated_at = now()
   where n.entity = p_entity
  returning * into rec;

  if rec.entity is null then
    raise exception 'Unknown procurement numbering entity: %', p_entity
      using errcode = 'check_violation';
  end if;

  return rec.prefix
         || case when rec.include_year then '-' || coalesce(rec.last_period, period) else '' end
         || '-' || lpad(rec.last_value::text, rec.padding, '0');
end;
$$;

revoke all on function private.next_procurement_reference(text) from public;

-- ---------------------------------------------------------------------------
-- 3. Configurable document lifecycles
-- ---------------------------------------------------------------------------
-- Same contract as master data: a status may only move along a declared edge, the edge names the
-- permission it requires, and an edge may demand a written reason. Anything undeclared is
-- refused by trigger, so no screen and no direct API call can invent a transition.

create table if not exists public.procurement_status_transitions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  from_status text not null,
  to_status text not null,
  required_permission text,
  requires_reason boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  constraint procurement_status_transitions_distinct check (from_status <> to_status),
  constraint procurement_status_transitions_unique unique (entity_type, from_status, to_status)
);

create index if not exists procurement_status_transitions_lookup_idx
  on public.procurement_status_transitions (entity_type, from_status);

comment on table public.procurement_status_transitions is
  'Declared lifecycle edges per procurement document type. Any edge absent here is rejected by trigger.';

insert into public.procurement_status_transitions
  (entity_type, from_status, to_status, required_permission, requires_reason, description)
values
  -- ---------------------------------------------------------------- requisition (§3.1)
  ('purchase_requisition', 'draft', 'submitted', 'procurement.requisition.submit', false, 'Send for review'),
  ('purchase_requisition', 'submitted', 'under_review', 'procurement.requisition.approve', false, 'Reviewer picks up the request'),
  ('purchase_requisition', 'under_review', 'approved', 'procurement.requisition.approve', false, 'Approved for procurement'),
  ('purchase_requisition', 'under_review', 'rejected', 'procurement.requisition.reject', true, 'Rejected with a reason'),
  ('purchase_requisition', 'rejected', 'draft', 'procurement.requisition.update', false, 'Returned to the requester for correction'),
  ('purchase_requisition', 'approved', 'processing', 'procurement.requisition.manage', false, 'Procurement has started sourcing'),
  ('purchase_requisition', 'processing', 'partially_fulfilled', 'procurement.requisition.manage', false, 'Part of the requested quantity is ordered'),
  ('purchase_requisition', 'processing', 'fulfilled', 'procurement.requisition.manage', false, 'Request fully ordered'),
  ('purchase_requisition', 'partially_fulfilled', 'fulfilled', 'procurement.requisition.manage', false, 'Remaining quantity ordered'),
  ('purchase_requisition', 'draft', 'cancelled', 'procurement.requisition.cancel', true, 'Withdrawn by the requester'),
  ('purchase_requisition', 'submitted', 'cancelled', 'procurement.requisition.cancel', true, 'Withdrawn before review'),
  ('purchase_requisition', 'approved', 'cancelled', 'procurement.requisition.cancel', true, 'Cancelled after approval'),

  -- ---------------------------------------------------------------- quotation (§3.2)
  ('supplier_quotation', 'draft', 'received', 'procurement.quotation.create', false, 'Quotation recorded from the supplier'),
  ('supplier_quotation', 'received', 'under_evaluation', 'procurement.quotation.compare', false, 'Included in a comparison'),
  ('supplier_quotation', 'under_evaluation', 'selected', 'procurement.quotation.select', true, 'Chosen for the purchase order'),
  ('supplier_quotation', 'under_evaluation', 'not_selected', 'procurement.quotation.compare', true, 'Considered but not chosen'),
  ('supplier_quotation', 'received', 'not_selected', 'procurement.quotation.compare', true, 'Not taken forward'),
  ('supplier_quotation', 'received', 'expired', 'procurement.quotation.update', false, 'Validity period passed'),
  ('supplier_quotation', 'under_evaluation', 'expired', 'procurement.quotation.update', false, 'Validity period passed'),
  ('supplier_quotation', 'received', 'withdrawn', 'procurement.quotation.update', true, 'Withdrawn by the supplier'),
  ('supplier_quotation', 'draft', 'rejected', 'procurement.quotation.update', true, 'Quotation not acceptable'),
  ('supplier_quotation', 'received', 'rejected', 'procurement.quotation.update', true, 'Quotation not acceptable'),

  -- ---------------------------------------------------------------- purchase order (§3.3)
  ('purchase_order', 'draft', 'submitted', 'procurement.purchase_order.submit', false, 'Sent for approval'),
  ('purchase_order', 'submitted', 'under_review', 'procurement.purchase_order.approve', false, 'Reviewer picks up the order'),
  ('purchase_order', 'under_review', 'approved', 'procurement.purchase_order.approve', false, 'Approved within authority'),
  ('purchase_order', 'under_review', 'rejected', 'procurement.purchase_order.approve', true, 'Rejected with a reason'),
  ('purchase_order', 'under_review', 'draft', 'procurement.purchase_order.approve', true, 'Returned for correction'),
  ('purchase_order', 'rejected', 'draft', 'procurement.purchase_order.update', false, 'Reworked after rejection'),
  ('purchase_order', 'approved', 'issued', 'procurement.purchase_order.issue', false, 'Sent to the supplier'),
  ('purchase_order', 'issued', 'partially_received', 'procurement.goods_receipt.post', false, 'Derived from posted receipts'),
  ('purchase_order', 'partially_received', 'fully_received', 'procurement.goods_receipt.post', false, 'Derived from posted receipts'),
  ('purchase_order', 'issued', 'fully_received', 'procurement.goods_receipt.post', false, 'Derived from posted receipts'),
  ('purchase_order', 'issued', 'amendment_pending', 'procurement.purchase_order.amend', false, 'An amendment is awaiting approval'),
  ('purchase_order', 'partially_received', 'amendment_pending', 'procurement.purchase_order.amend', false, 'An amendment is awaiting approval'),
  ('purchase_order', 'amendment_pending', 'issued', 'procurement.purchase_order.amend', false, 'Amendment applied to the issued version'),
  ('purchase_order', 'amendment_pending', 'partially_received', 'procurement.purchase_order.amend', false, 'Amendment rejected; order unchanged'),
  ('purchase_order', 'amendment_pending', 'fully_received', 'procurement.purchase_order.amend', false, 'Amendment rejected; order already complete'),
  ('purchase_order', 'issued', 'closed', 'procurement.purchase_order.close', true, 'Closed with quantities outstanding'),
  ('purchase_order', 'partially_received', 'closed', 'procurement.purchase_order.close', true, 'Closed with quantities outstanding'),
  ('purchase_order', 'fully_received', 'closed', 'procurement.purchase_order.close', false, 'Fulfilment complete'),
  ('purchase_order', 'draft', 'cancelled', 'procurement.purchase_order.cancel', true, 'Abandoned before issue'),
  ('purchase_order', 'submitted', 'cancelled', 'procurement.purchase_order.cancel', true, 'Abandoned before approval'),
  ('purchase_order', 'approved', 'cancelled', 'procurement.purchase_order.cancel', true, 'Cancelled before issue'),

  -- ---------------------------------------------------------------- goods receipt (§3.4)
  ('goods_receipt', 'draft', 'submitted', 'procurement.goods_receipt.submit', false, 'Sent for review'),
  ('goods_receipt', 'submitted', 'under_review', 'procurement.goods_receipt.review', false, 'Reviewer picks up the receipt'),
  ('goods_receipt', 'under_review', 'approved', 'procurement.goods_receipt.approve', false, 'Accepted for posting'),
  ('goods_receipt', 'under_review', 'rejected', 'procurement.goods_receipt.approve', true, 'Rejected with a reason'),
  ('goods_receipt', 'under_review', 'returned', 'procurement.goods_receipt.review', true, 'Returned for correction'),
  ('goods_receipt', 'returned', 'draft', 'procurement.goods_receipt.update', false, 'Corrected by the recorder'),
  ('goods_receipt', 'rejected', 'draft', 'procurement.goods_receipt.update', false, 'Reopened by the recorder'),
  ('goods_receipt', 'approved', 'posted', 'procurement.goods_receipt.post', false, 'Posted once; immutable afterwards'),
  ('goods_receipt', 'draft', 'cancelled', 'procurement.goods_receipt.cancel', true, 'Abandoned before review'),
  ('goods_receipt', 'submitted', 'cancelled', 'procurement.goods_receipt.cancel', true, 'Abandoned before review'),

  -- ---------------------------------------------------------------- supplier advance (§3.5)
  ('supplier_advance', 'draft', 'submitted', 'procurement.supplier_advance.submit', false, 'Sent for approval'),
  ('supplier_advance', 'submitted', 'approved', 'procurement.supplier_advance.approve', false, 'Approved within authority'),
  ('supplier_advance', 'submitted', 'rejected', 'procurement.supplier_advance.approve', true, 'Rejected with a reason'),
  ('supplier_advance', 'approved', 'payment_pending', 'procurement.supplier_advance.approve', false, 'Awaiting treasury confirmation'),
  ('supplier_advance', 'payment_pending', 'paid', 'procurement.supplier_advance.approve', false, 'Treasury confirmed disbursement'),
  ('supplier_advance', 'paid', 'partially_applied', 'procurement.supplier_advance.approve', false, 'Part of the advance is applied'),
  ('supplier_advance', 'paid', 'fully_applied', 'procurement.supplier_advance.approve', false, 'Advance fully applied'),
  ('supplier_advance', 'partially_applied', 'fully_applied', 'procurement.supplier_advance.approve', false, 'Remainder applied'),
  ('supplier_advance', 'draft', 'cancelled', 'procurement.supplier_advance.create', true, 'Abandoned before approval'),
  ('supplier_advance', 'submitted', 'cancelled', 'procurement.supplier_advance.approve', true, 'Abandoned before approval')
on conflict (entity_type, from_status, to_status) do nothing;

/** Refuses a status change that is not a declared edge for that document type. */
create or replace function private.assert_procurement_transition(
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
      from public.procurement_status_transitions t
     where t.entity_type = p_entity
       and t.from_status = p_from_status
       and t.to_status = p_to_status
  ) then
    raise exception 'Illegal % status transition: % -> %. Configure it in procurement settings first.',
      p_entity, p_from_status, p_to_status
      using errcode = 'check_violation';
  end if;
end;
$$;

/**
 * Enforces the declared lifecycle on a document table.
 *
 * Registered with two trigger arguments: the entity type and the column that holds the
 * human-readable reference. The reference is copied into the status trail so an auditor reads
 * "PA-PO-2026-000004 was issued" without a join.
 */
create or replace function private.guard_procurement_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.procurement_status_transitions;
  entity text := tg_argv[0];
  reference text;
  new_json jsonb := to_jsonb(new);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  perform private.assert_procurement_transition(entity, old.status, new.status);

  select * into rule
    from public.procurement_status_transitions t
   where t.entity_type = entity
     and t.from_status = old.status
     and t.to_status = new.status;

  -- A declared edge names the permission it needs. Checking it here means a user who can update a
  -- draft cannot promote a document by writing through the API, and a service-layer mistake cannot
  -- either. `auth.uid()` is null for migrations and for the service-role maintenance path.
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

  insert into public.procurement_status_history
    (entity_type, entity_id, entity_reference, from_status, to_status, reason,
     actor_user_id, actor_employee_id)
  values
    (entity, new.id, reference, old.status, new.status, new_json ->> 'status_reason',
     auth.uid(), private.current_employee_id());

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Append-only status trail
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_status_history (
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

create index if not exists procurement_status_history_entity_idx
  on public.procurement_status_history (entity_type, entity_id, created_at desc);
create index if not exists procurement_status_history_created_idx
  on public.procurement_status_history (created_at desc);

comment on table public.procurement_status_history is
  'Append-only document lifecycle trail. Written by trigger; application code never inserts here.';

/** The trail is evidence, so it is not editable or deletable, even by a privileged session. */
create or replace function private.block_procurement_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The procurement status trail is append-only' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists procurement_status_history_no_update on public.procurement_status_history;
create trigger procurement_status_history_no_update
  before update or delete on public.procurement_status_history
  for each row execute function private.block_procurement_history_mutation();

-- ---------------------------------------------------------------------------
-- 5. Approval decision trail
-- ---------------------------------------------------------------------------
-- Phase 1 configured *who may approve what* (approval_authorities, delegations, SOD rules) but
-- built no request engine. Phase 3 records every submission and decision here. The row stores the
-- amount and currency the decision was taken against, and the authority row that authorised it, so
-- a later change to an authority limit cannot rewrite the history of what was approved.

create table if not exists public.procurement_approvals (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  entity_reference text,
  stage int not null default 1,
  decision text not null,
  actor_user_id uuid references public.profiles (id) on delete set null on update cascade,
  actor_employee_id uuid references public.employees (id) on delete set null on update cascade,
  amount_at_decision numeric(20, 2),
  currency_code text,
  authority_id uuid references public.approval_authorities (id) on delete set null on update cascade,
  delegation_id uuid references public.approval_delegations (id) on delete set null on update cascade,
  sod_rule_id uuid references public.segregation_of_duties_rules (id) on delete set null on update cascade,
  comment text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint procurement_approvals_decision_check
    check (decision in ('submitted', 'approved', 'rejected', 'returned', 'issued', 'cancelled', 'posted')),
  constraint procurement_approvals_currency_format
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint procurement_approvals_amount_non_negative
    check (amount_at_decision is null or amount_at_decision >= 0)
);

create index if not exists procurement_approvals_entity_idx
  on public.procurement_approvals (entity_type, entity_id, created_at);
create index if not exists procurement_approvals_pending_idx
  on public.procurement_approvals (decision, created_at desc);

comment on table public.procurement_approvals is
  'Submission and decision trail for procurement documents. Amount and authority are snapshotted at decision time.';

drop trigger if exists procurement_approvals_no_update on public.procurement_approvals;
create trigger procurement_approvals_no_update
  before update or delete on public.procurement_approvals
  for each row execute function private.block_procurement_history_mutation();

-- ---------------------------------------------------------------------------
-- 6. Approval authority resolution
-- ---------------------------------------------------------------------------

/**
 * Returns the approval authority row that permits `p_employee` to approve `p_amount` of
 * `p_currency` for a module/transaction pair, or null when nothing permits it.
 *
 * Deliberately reads configuration: an employee-scoped row wins over a role-scoped row (the more
 * specific grant), expired/inactive rows are ignored, and minutes are consulted only through the
 * delegations table by the caller. A null result is a refusal, never an implied "no limit".
 */
create or replace function private.resolve_approval_authority(
  p_employee_id uuid,
  p_module text,
  p_transaction_type text,
  p_amount numeric,
  p_currency text
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
    from public.approval_authorities a
   where a.is_active
     and a.module = p_module
     and a.transaction_type = p_transaction_type
     and a.currency_code = p_currency
     and p_amount >= a.minimum_amount
     and p_amount <= a.maximum_amount
     and a.effective_from <= current_date
     and (a.effective_until is null or a.effective_until >= current_date)
     and (
       a.employee_id = p_employee_id
       or (a.role_id is not null and exists (
             select 1
               from public.user_roles ur
               join public.profiles p on p.id = ur.user_id
              where p.employee_id = p_employee_id
                and ur.role_id = a.role_id
                and ur.is_active
                and (ur.expires_at is null or ur.expires_at > now())
           ))
     )
   order by (a.employee_id is not null) desc, a.maximum_amount asc
   limit 1;
$$;

revoke all on function private.resolve_approval_authority(uuid, text, text, numeric, text) from public;

-- ---------------------------------------------------------------------------
-- 7. Shared document triggers
-- ---------------------------------------------------------------------------

/**
 * Convenience installer: reference assignment, lifecycle guard and updated_at for one document
 * table. Called once per table instead of repeating three trigger definitions.
 */
create or replace function private.install_procurement_triggers(
  target_table regclass,
  entity text,
  reference_column text default 'reference'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  execute format('drop trigger if exists %I on %s', entity || '_assign_reference', target_table);
  execute format(
    'create trigger %I before insert on %s for each row execute function private.assign_procurement_reference(%L, %L)',
    entity || '_assign_reference', target_table, entity, reference_column);

  execute format('drop trigger if exists %I on %s', entity || '_status_guard', target_table);
  execute format(
    'create trigger %I before update on %s for each row execute function private.guard_procurement_status(%L, %L)',
    entity || '_status_guard', target_table, entity, reference_column);

  execute format('drop trigger if exists %I on %s', entity || '_set_updated_at', target_table);
  execute format(
    'create trigger %I before update on %s for each row execute function private.set_updated_at()',
    entity || '_set_updated_at', target_table);
end;
$$;

/** Assigns the configured reference when the caller did not supply one. Never overwrites. */
create or replace function private.assign_procurement_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  column_name text := coalesce(tg_argv[1], 'reference');
  current_value text := to_jsonb(new) ->> column_name;
begin
  if current_value is null or btrim(current_value) = '' then
    new := jsonb_populate_record(new, jsonb_build_object(column_name, private.next_procurement_reference(tg_argv[0])));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Procurement settings (policy values an administrator owns)
-- ---------------------------------------------------------------------------
-- The specification is explicit that Phase 3 must not invent business policy. Every value that a
-- policy would normally decide lives here as an editable, audited row, with the conservative
-- value as the default. `procurement_settings` is read by the validation functions below, so a
-- policy change takes effect without a deployment.

create table if not exists public.procurement_settings (
  key text primary key,
  value_text text,
  value_numeric numeric(12, 4),
  value_boolean boolean,
  description text not null,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_at timestamptz not null default now(),
  constraint procurement_settings_key_format check (key ~ '^[a-z][a-z0-9_.]{2,63}$')
);

comment on table public.procurement_settings is
  'Editable procurement policy switches. Defaults are the conservative choice (no tolerance, justification required) and are never silently assumed by code.';

insert into public.procurement_settings (key, value_numeric, value_boolean, description)
values
  ('excess_receipt_tolerance_percent', 0, null,
   'Percentage by which a receipt may exceed the outstanding ordered quantity. 0 means excess delivery is always an exception requiring authorised approval.'),
  ('receipt_requires_review', null, true,
   'When true a goods receipt must pass review and approval before it can be posted.'),
  ('quotation_selection_requires_justification', null, true,
   'When true, selecting a supplier requires a written justification regardless of price ranking.'),
  ('requisition_requires_approval', null, true,
   'When true a requisition cannot move to procurement processing until approved.'),
  ('po_amendment_requires_approval', null, true,
   'When true an amendment to an issued purchase order needs its own approval before it takes effect.'),
  ('allow_multiple_requisitions_per_po', null, true,
   'When true a single purchase order may consolidate several approved requisitions.')
on conflict (key) do nothing;

drop trigger if exists procurement_settings_set_updated_at on public.procurement_settings;
create trigger procurement_settings_set_updated_at
  before update on public.procurement_settings
  for each row execute function private.set_updated_at();

/** Reads a numeric setting. Returns null when unset so callers must decide, not inherit a guess. */
create or replace function private.procurement_setting_numeric(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value_numeric from public.procurement_settings where key = p_key;
$$;

/** Reads a boolean setting, defaulting to false when the row is absent. */
create or replace function private.procurement_setting_boolean(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(value_boolean, false) from public.procurement_settings where key = p_key;
$$;

revoke all on function private.procurement_setting_numeric(text) from public;
revoke all on function private.procurement_setting_boolean(text) from public;
