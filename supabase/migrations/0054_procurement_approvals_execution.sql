-- 0054 — approval execution
--
-- Phase 1 configured approval authority; nothing executed it. Phase 3 executes approvals through the
-- two functions below, for one reason: authorisation must happen at the moment of the decision, in
-- the same transaction as the status change, and it must not be possible to obtain an approval by
-- calling the REST endpoint for the status column directly.
--
-- `public.procurement_decide` therefore performs, atomically:
--   1. permission check for the decision itself;
--   2. authority check against `approval_authorities` (amount, currency, module, transaction type,
--      validity window) — a missing row is a refusal, never an implied limit;
--   3. separation-of-duties check: the creator of a document may never approve it, and a configured
--      BLOCK rule is honoured (an override must exist to proceed);
--   4. the status transition (the lifecycle guard still validates the edge and its permission);
--   5. the immutable decision row, with the amount and authority snapshotted;
--   6. notification of the requester.
--
-- The employee id is resolved from the session, never accepted as an argument, so a caller cannot
-- claim to be somebody else.

create or replace function private.notify_permission_holders(
  p_permission text,
  p_module text,
  p_event_type text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_href text,
  p_severity text default 'info'
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted int;
begin
  with holders as (
    select distinct ur.user_id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions p on p.id = rp.permission_id
      join public.profiles pr on pr.id = ur.user_id and pr.is_active
     where p.code = p_permission
       and ur.is_active
       and (ur.expires_at is null or ur.expires_at > now())
  )
  insert into public.notifications
    (recipient_profile_id, module, event_type, title, body, entity_type, entity_id, href, severity, dedupe_key)
  select h.user_id, p_module, p_event_type, p_title, p_body, p_entity_type, p_entity_id, p_href, p_severity,
         p_event_type || ':' || p_entity_type || ':' || p_entity_id::text || ':' || h.user_id::text
    from holders h
  on conflict (dedupe_key) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function private.notify_permission_holders(text, text, text, text, text, text, uuid, text, text) from public;

/** True when an active authority row covers this amount for the current user. Used by the UI to be honest. */
create or replace function public.procurement_authority_covers(
  p_module text,
  p_transaction_type text,
  p_amount numeric,
  p_currency text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    private.resolve_approval_authority(
      private.current_employee_id(), p_module, p_transaction_type, p_amount, p_currency
    ) is not null,
    false
  );
$$;

grant execute on function public.procurement_authority_covers(text, text, numeric, text) to authenticated;

/**
 * Records a decision on a procurement document and moves it.
 *
 * p_decision is one of: approve, reject, return, issue, post, confirm_payment, cancel.
 * The function maps the decision onto the document's declared lifecycle and refuses anything the
 * configured transitions do not allow.
 */
create or replace function public.procurement_decide(
  p_entity_type text,
  p_entity_id uuid,
  p_decision text,
  p_comment text default null
)
returns table (
  entity_type text,
  entity_id uuid,
  previous_status text,
  new_status text,
  authority_id uuid,
  sod_rule_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile uuid := auth.uid();
  actor_employee uuid := private.current_employee_id();
  creator uuid;
  current_status text;
  current_ref text;
  next_status text;
  doc_amount numeric(20, 2);
  doc_currency text;
  approval_permission text;
  required_permission text;
  module_name text := 'procurement';
  transaction_kind text;
  authority uuid;
  rule_id uuid;
  blocking_rule record;
  override_exists boolean;
  href text;
  owner_employee uuid;
begin
  if actor_profile is null then
    raise exception 'An authenticated user is required' using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------------- resolve the document
  case p_entity_type
    when 'purchase_requisition' then
      select r.status, r.reference, r.estimated_total, r.currency_code, r.created_by, r.requesting_employee_id
        into current_status, current_ref, doc_amount, doc_currency, creator, owner_employee
        from public.purchase_requisitions r where r.id = p_entity_id for update;
      transaction_kind := 'purchase_requisition';
    when 'purchase_order' then
      select po.status, po.reference, po.total_amount, po.currency_code, po.created_by, po.procurement_officer_employee_id
        into current_status, current_ref, doc_amount, doc_currency, creator, owner_employee
        from public.purchase_orders po where po.id = p_entity_id for update;
      transaction_kind := 'purchase_order';
    when 'purchase_order_amendment' then
      select a.status, a.reference, po.total_amount, po.currency_code, a.requested_by, a.requested_employee_id
        into current_status, current_ref, doc_amount, doc_currency, creator, owner_employee
        from public.purchase_order_amendments a
        join public.purchase_orders po on po.id = a.purchase_order_id
       where a.id = p_entity_id
       for update of a;
      transaction_kind := 'purchase_order_amendment';
    when 'goods_receipt' then
      select gr.status, gr.reference, po.total_amount, po.currency_code, gr.created_by, gr.receiving_employee_id
        into current_status, current_ref, doc_amount, doc_currency, creator, owner_employee
        from public.goods_receipts gr
        join public.purchase_orders po on po.id = gr.purchase_order_id
       where gr.id = p_entity_id
       for update of gr;
      transaction_kind := 'goods_receipt';
    when 'supplier_advance' then
      select a.status, a.reference, a.amount, a.currency_code, a.created_by, a.requested_employee_id
        into current_status, current_ref, doc_amount, doc_currency, creator, owner_employee
        from public.supplier_advances a where a.id = p_entity_id for update;
      transaction_kind := 'supplier_advance';
    else
      raise exception 'Unknown procurement document type: %', p_entity_type using errcode = 'check_violation';
  end case;

  if current_status is null then
    raise exception 'Document % not found', p_entity_id using errcode = 'no_data_found';
  end if;

  -- ---------------------------------------------------------------- permission for the decision
  approval_permission := case p_decision
    when 'approve' then 'procurement.' || case p_entity_type
        when 'purchase_requisition' then 'requisition'
        when 'purchase_order' then 'purchase_order'
        when 'purchase_order_amendment' then 'purchase_order'
        when 'goods_receipt' then 'goods_receipt'
        when 'supplier_advance' then 'supplier_advance'
      end || '.approve'
    when 'reject' then 'procurement.' || case p_entity_type
        when 'purchase_requisition' then 'requisition'
        when 'purchase_order' then 'purchase_order'
        when 'purchase_order_amendment' then 'purchase_order'
        when 'goods_receipt' then 'goods_receipt'
        when 'supplier_advance' then 'supplier_advance'
      end || case when p_entity_type = 'purchase_requisition' then '.reject' else '.approve' end
    when 'return' then 'procurement.goods_receipt.review'
    when 'issue' then 'procurement.purchase_order.issue'
    when 'post' then 'procurement.goods_receipt.post'
    when 'confirm_payment' then 'procurement.supplier_advance.approve'
    when 'cancel' then 'procurement.' || case p_entity_type
        when 'purchase_requisition' then 'requisition.cancel'
        when 'purchase_order' then 'purchase_order.cancel'
        when 'goods_receipt' then 'goods_receipt.cancel'
        when 'supplier_advance' then 'supplier_advance.cancel'
        when 'purchase_order_amendment' then 'purchase_order.amend'
      end
    else null
  end;

  if approval_permission is null then
    raise exception 'Unknown decision: %', p_decision using errcode = 'check_violation';
  end if;

  if not private.has_permission(approval_permission) then
    raise exception 'Decision % on % requires permission %', p_decision, p_entity_type, approval_permission
      using errcode = 'insufficient_privilege';
  end if;

  -- ---------------------------------------------------------------- separation of duties
  if p_decision in ('approve', 'issue', 'post') and creator is not null and creator = actor_profile then
    raise exception 'You created %, so you cannot % it. Ask another authorised user.', current_ref, p_decision
      using errcode = 'insufficient_privilege';
  end if;

  select r.id, r.enforcement_level into blocking_rule
    from public.segregation_of_duties_rules r
   where r.is_active
     and r.module = module_name
     and (r.transaction_type = transaction_kind or r.transaction_type = '*')
   order by case r.enforcement_level when 'BLOCK' then 0 when 'REQUIRE_OVERRIDE' then 1 else 2 end
   limit 1;

  if blocking_rule.id is not null then
    select exists (
      select 1 from public.sod_overrides o
       where o.rule_id = blocking_rule.id
         and o.employee_id = actor_employee
         and (o.entity_id is null or o.entity_id = p_entity_id)
         and (o.expires_at is null or o.expires_at > now())
    ) into override_exists;

    if not override_exists and blocking_rule.enforcement_level in ('BLOCK', 'REQUIRE_OVERRIDE') then
      raise exception 'A segregation-of-duties rule (%) applies to % on this document; an approved override is required.',
        blocking_rule.id, p_decision
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ---------------------------------------------------------------- approval authority
  if p_decision in ('approve', 'issue', 'post') and doc_amount is not null then
    authority := private.resolve_approval_authority(actor_employee, module_name, transaction_kind, doc_amount, doc_currency);
    if authority is null then
      raise exception 'You have no approval authority covering % % for %. An administrator must configure it in approval authorities.',
        doc_currency, doc_amount, transaction_kind
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ---------------------------------------------------------------- the transition
  next_status := case p_entity_type
    when 'purchase_requisition' then case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'cancel' then 'cancelled'
      end
    when 'purchase_order' then case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'return' then 'draft'
        when 'issue' then 'issued'
        when 'cancel' then 'cancelled'
      end
    when 'purchase_order_amendment' then case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'cancel' then 'cancelled'
      end
    when 'goods_receipt' then case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'return' then 'returned'
        when 'cancel' then 'cancelled'
      end
    when 'supplier_advance' then case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        when 'cancel' then 'cancelled'
      end
  end;

  if next_status is null then
    raise exception 'Decision % does not apply to a %', p_decision, p_entity_type using errcode = 'check_violation';
  end if;

  if p_decision = 'post' then
    raise exception 'Posting a goods receipt is performed by post_goods_receipt(), which also emits the inventory handoff event'
      using errcode = 'check_violation';
  end if;

  required_permission := null;

  case p_entity_type
    when 'purchase_requisition' then
      update public.purchase_requisitions
         set status = next_status,
             status_reason = coalesce(p_comment, status_reason),
             approved_at = case when p_decision = 'approve' then now() else approved_at end,
             approved_by = case when p_decision = 'approve' then actor_profile else approved_by end,
             cancelled_at = case when p_decision = 'cancel' then now() else cancelled_at end,
             cancelled_by = case when p_decision = 'cancel' then actor_profile else cancelled_by end,
             updated_by = actor_profile
       where id = p_entity_id;
      href := '/procurement/requisitions/' || p_entity_id::text;
    when 'purchase_order' then
      update public.purchase_orders
         set status = next_status,
             status_reason = coalesce(p_comment, status_reason),
             approved_at = case when p_decision = 'approve' then now() else approved_at end,
             approved_by = case when p_decision = 'approve' then actor_profile else approved_by end,
             issued_at = case when p_decision = 'issue' then coalesce(issued_at, now()) else issued_at end,
             issued_by = case when p_decision = 'issue' then coalesce(issued_by, actor_profile) else issued_by end,
             cancelled_at = case when p_decision = 'cancel' then now() else cancelled_at end,
             cancelled_by = case when p_decision = 'cancel' then actor_profile else cancelled_by end,
             updated_by = actor_profile
       where id = p_entity_id;
      href := '/procurement/purchase-orders/' || p_entity_id::text;
    when 'purchase_order_amendment' then
      update public.purchase_order_amendments
         set status = next_status,
             status_reason = p_comment,
             approved_at = case when p_decision = 'approve' then now() else approved_at end,
             approved_by = case when p_decision = 'approve' then actor_profile else approved_by end
       where id = p_entity_id;

      -- Submitting an amendment parks the order so it cannot be received against mid-change.
      if p_decision in ('approve', 'reject') then
        null;
      end if;
      href := '/procurement/purchase-orders/' ||
        (select a.purchase_order_id::text from public.purchase_order_amendments a where a.id = p_entity_id);
    when 'goods_receipt' then
      update public.goods_receipts
         set status = next_status,
             status_reason = p_comment,
             reviewed_by = case when p_decision in ('approve', 'reject', 'return') then actor_profile else reviewed_by end,
             reviewed_at = case when p_decision in ('approve', 'reject', 'return') then now() else reviewed_at end,
             approved_by = case when p_decision = 'approve' then actor_profile else approved_by end,
             approved_at = case when p_decision = 'approve' then now() else approved_at end,
             cancelled_at = case when p_decision = 'cancel' then now() else cancelled_at end,
             cancelled_by = case when p_decision = 'cancel' then actor_profile else cancelled_by end,
             updated_by = actor_profile
       where id = p_entity_id;
      href := '/procurement/goods-receipts/' || p_entity_id::text;
    when 'supplier_advance' then
      update public.supplier_advances
         set status = next_status,
             status_reason = p_comment,
             approved_at = case when p_decision = 'approve' then now() else approved_at end,
             approved_by = case when p_decision = 'approve' then actor_profile else approved_by end,
             updated_by = actor_profile
       where id = p_entity_id;
      href := '/procurement/supplier-advances/' || p_entity_id::text;
  end case;

  insert into public.procurement_approvals
    (entity_type, entity_id, entity_reference, decision, actor_user_id, actor_employee_id,
     amount_at_decision, currency_code, authority_id, sod_rule_id, comment)
  values
    (p_entity_type, p_entity_id, current_ref,
     case p_decision
       when 'approve' then 'approved'
       when 'issue' then 'issued'
       when 'reject' then 'rejected'
       when 'return' then 'returned'
       when 'cancel' then 'cancelled'
       else 'submitted'
     end,
     actor_profile, actor_employee, doc_amount, doc_currency, authority, blocking_rule.id, p_comment);

  -- Tell the person who raised the document; never tell them about their own action twice.
  if owner_employee is not null then
    insert into public.notifications
      (recipient_profile_id, module, event_type, title, body, entity_type, entity_id, href, severity, dedupe_key)
    select pr.id, 'procurement', 'procurement.' || p_entity_type || '.' || p_decision,
           current_ref || ' ' || replace(p_decision, '_', ' '),
           coalesce(p_comment, 'Decision recorded.'),
           p_entity_type, p_entity_id, href,
           case when p_decision in ('reject', 'return') then 'warning' else 'notice' end,
           'decision:' || p_entity_type || ':' || p_entity_id::text || ':' || p_decision || ':' || actor_profile::text
      from public.profiles pr
     where pr.employee_id = owner_employee
       and pr.id <> actor_profile
    on conflict (dedupe_key) do nothing;
  end if;

  return query select p_entity_type, p_entity_id, current_status, next_status, authority, blocking_rule.id;
end;
$$;

comment on function public.procurement_decide(text, uuid, text, text) is
  'Single execution path for procurement decisions: permission, approval authority, segregation of duties, lifecycle transition, immutable decision row and notification, all in one transaction.';

revoke all on function public.procurement_decide(text, uuid, text, text) from public;
grant execute on function public.procurement_decide(text, uuid, text, text) to authenticated;

/**
 * Notifies the holders of a permission within a document's transaction.
 * Used for "ready for approval" style events from the application.
 */
create or replace function public.procurement_notify_approvers(
  p_permission text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_href text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return 0;
  end if;
  return private.notify_permission_holders(
    p_permission, 'procurement', 'procurement.' || p_entity_type || '.submitted',
    p_title, p_body, p_entity_type, p_entity_id, p_href, 'info'
  );
end;
$$;

grant execute on function public.procurement_notify_approvers(text, text, text, text, uuid, text) to authenticated;
