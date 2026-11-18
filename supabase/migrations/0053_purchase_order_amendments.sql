-- 0053 — applying a purchase order amendment
--
-- An amendment is the only sanctioned way to change an issued order. Applying one:
--   * requires the amendment to have been approved (unless policy says otherwise);
--   * requires it to be based on the order version currently in force, so two amendments cannot be
--     applied against the same base and silently lose one;
--   * writes the change under a session flag that only this function sets, so the immutability
--     guard cannot be bypassed from an API call;
--   * increments the order version and therefore creates a new immutable version snapshot.
--
-- A reduction below a quantity already received is refused unless the caller explicitly confirms
-- the received-goods impact *and* holds procurement.purchase_order.approve. Quietly rewriting an
-- order for goods that already arrived is exactly the discrepancy the specification warns about.

insert into public.procurement_status_transitions
  (entity_type, from_status, to_status, required_permission, requires_reason, description)
values
  -- Applying an amendment re-issues the order, so a partly received order returns to issued for the
  -- length of that transaction and is restored to its derived receipt status immediately after.
  ('purchase_order', 'partially_received', 'issued', 'procurement.purchase_order.amend', false, 'Amendment applied to a partly received order'),
  ('purchase_order_amendment', 'draft', 'submitted', 'procurement.purchase_order.amend', false, 'Send the amendment for approval'),
  ('purchase_order_amendment', 'submitted', 'approved', 'procurement.purchase_order.approve', false, 'Approved within authority'),
  ('purchase_order_amendment', 'submitted', 'rejected', 'procurement.purchase_order.approve', true, 'Rejected with a reason'),
  ('purchase_order_amendment', 'approved', 'applied', 'procurement.purchase_order.amend', false, 'Applied to the order; a new version is written'),
  ('purchase_order_amendment', 'draft', 'cancelled', 'procurement.purchase_order.amend', true, 'Abandoned before approval'),
  ('purchase_order_amendment', 'submitted', 'cancelled', 'procurement.purchase_order.amend', true, 'Abandoned before approval')
on conflict (entity_type, from_status, to_status) do nothing;

create or replace function public.apply_purchase_order_amendment(
  p_amendment_id uuid,
  p_confirm_received_impact boolean default false
)
returns table (purchase_order_id uuid, version int, total_amount numeric, previous_total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  amendment public.purchase_order_amendments;
  order_row public.purchase_orders;
  item record;
  target_item public.purchase_order_items;
  received numeric(20, 6);
  new_qty numeric(20, 6);
  requires_approval boolean;
  v_previous_total numeric(20, 2);
  prior_status text;
begin
  if auth.uid() is null then
    raise exception 'Applying an amendment requires an authenticated user for attribution'
      using errcode = 'insufficient_privilege';
  end if;

  select * into amendment from public.purchase_order_amendments where id = p_amendment_id for update;
  if amendment.id is null then
    raise exception 'Amendment % not found', p_amendment_id using errcode = 'no_data_found';
  end if;

  select * into order_row from public.purchase_orders where id = amendment.purchase_order_id for update;
  if order_row.id is null then
    raise exception 'The purchase order of this amendment no longer exists' using errcode = 'check_violation';
  end if;

  if amendment.status = 'applied' then
    raise exception 'Amendment % has already been applied', amendment.reference using errcode = 'check_violation';
  end if;
  if amendment.status not in ('approved', 'submitted') then
    raise exception 'Amendment % is %, so it cannot be applied', amendment.reference, amendment.status
      using errcode = 'check_violation';
  end if;

  requires_approval := coalesce(private.procurement_setting_boolean('po_amendment_requires_approval'), true);
  if requires_approval and amendment.status <> 'approved' then
    raise exception 'This amendment needs approval before it can be applied'
      using errcode = 'check_violation';
  end if;

  if amendment.base_version <> order_row.version then
    raise exception 'Amendment % was raised against version % but the order is now at version %. Rebase the amendment.',
      amendment.reference, amendment.base_version, order_row.version
      using errcode = 'check_violation';
  end if;

  if order_row.status not in ('issued', 'partially_received', 'fully_received', 'amendment_pending') then
    raise exception 'Purchase order % is %, so it cannot be amended', order_row.reference, order_row.status
      using errcode = 'check_violation';
  end if;

  v_previous_total := order_row.total_amount;
  prior_status := case when order_row.status = 'amendment_pending'
                       then 'issued' else order_row.status end;

  -- Only this function may flip the flag that lets the immutability guard accept content changes.
  perform set_config('pluck.amendment_applied', 'on', true);

  for item in
    select * from public.purchase_order_amendment_items where amendment_id = p_amendment_id order by created_at
  loop
    if item.change_type in ('quantity', 'unit_price', 'product') then
      select * into target_item from public.purchase_order_items where id = item.purchase_order_item_id;
      if target_item.id is null then
        raise exception 'Amendment line % references a purchase order line that no longer exists', item.id
          using errcode = 'check_violation';
      end if;

      if item.change_type = 'quantity' then
        new_qty := coalesce(item.quantity, target_item.quantity);
        select s.received_quantity into received
          from public.purchase_order_receipt_status s
         where s.purchase_order_item_id = target_item.id;

        if new_qty < coalesce(received, 0) then
          if not p_confirm_received_impact then
            raise exception 'Line % already has % received, so reducing it to % needs explicit confirmation',
              target_item.line_number, received, new_qty
              using errcode = 'check_violation';
          end if;
          if not private.has_permission('procurement.purchase_order.approve') then
            raise exception 'Confirming a received-goods impact requires procurement.purchase_order.approve'
              using errcode = 'insufficient_privilege';
          end if;
        end if;

        update public.purchase_order_items set quantity = new_qty where id = target_item.id;
      elsif item.change_type = 'unit_price' then
        update public.purchase_order_items set unit_price = coalesce(item.unit_price, target_item.unit_price)
         where id = target_item.id;
      else
        update public.purchase_order_items
           set product_id = coalesce(item.product_id, target_item.product_id),
               product_code_snapshot = coalesce((select p.code from public.products p where p.id = coalesce(item.product_id, target_item.product_id)), target_item.product_code_snapshot),
               product_description = coalesce((select p.name from public.products p where p.id = coalesce(item.product_id, target_item.product_id)), target_item.product_description),
               unit_id = coalesce(item.unit_id, target_item.unit_id),
               unit_code_snapshot = coalesce((select u.code from public.units_of_measure u where u.id = coalesce(item.unit_id, target_item.unit_id)), target_item.unit_code_snapshot)
         where id = target_item.id;
      end if;

    elsif item.change_type = 'add_line' then
      insert into public.purchase_order_items
        (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
         unit_id, unit_code_snapshot, quantity, unit_price)
      select order_row.id,
             coalesce((select max(line_number) from public.purchase_order_items where purchase_order_id = order_row.id), 0) + 1,
             item.product_id,
             (select code from public.products where id = item.product_id),
             (select name from public.products where id = item.product_id),
             item.unit_id,
             (select code from public.units_of_measure where id = item.unit_id),
             item.quantity,
             coalesce(item.unit_price, 0);

    elsif item.change_type = 'remove_line' then
      select s.received_quantity into received
        from public.purchase_order_receipt_status s
       where s.purchase_order_item_id = item.purchase_order_item_id;
      if coalesce(received, 0) > 0 then
        raise exception 'A line with received quantity cannot be removed from the order'
          using errcode = 'check_violation';
      end if;
      delete from public.purchase_order_items where id = item.purchase_order_item_id;

    elsif item.change_type = 'delivery_date' then
      update public.purchase_orders set expected_delivery_date = item.new_value::date where id = order_row.id;

    elsif item.change_type = 'payment_terms' then
      update public.purchase_orders set payment_terms_id = item.new_value::uuid where id = order_row.id;

    elsif item.change_type = 'delivery_terms' then
      update public.purchase_orders set delivery_terms_id = item.new_value::uuid where id = order_row.id;

    elsif item.change_type = 'destination' then
      update public.purchase_orders set delivery_warehouse_id = item.new_value::uuid where id = order_row.id;

    elsif item.change_type = 'other' then
      if item.field_name = 'supplier_instructions' then
        update public.purchase_orders set supplier_instructions = item.new_value where id = order_row.id;
      elsif item.field_name = 'internal_remarks' then
        update public.purchase_orders set internal_remarks = item.new_value where id = order_row.id;
      elsif item.field_name = 'delivery_address' then
        update public.purchase_orders set delivery_address = item.new_value where id = order_row.id;
      else
        raise exception 'Amendment field % is not an amendable purchase order field', coalesce(item.field_name, '(none)')
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  -- Bump the version and re-issue: the issue snapshot trigger stores the new immutable version.
  update public.purchase_orders
     set version = order_row.version + 1,
         status = 'issued',
         approved_at = coalesce(approved_at, now()),
         updated_by = auth.uid()
   where id = order_row.id;

  perform set_config('pluck.amendment_applied', 'off', true);

  update public.purchase_order_amendments
     set status = 'applied',
         applied_at = now(),
         previous_total = v_previous_total,
         new_total = (select o2.total_amount from public.purchase_orders o2 where o2.id = order_row.id),
         resulting_version = order_row.version + 1
   where id = p_amendment_id;

  -- If the order had been receiving goods, restore that derived status honestly.
  if prior_status = 'partially_received' then
    update public.purchase_orders set status = 'partially_received' where id = order_row.id;
  elsif prior_status = 'fully_received' then
    update public.purchase_orders set status = 'fully_received' where id = order_row.id;
  end if;

  return query
    select o.id, o.version, o.total_amount, v_previous_total
      from public.purchase_orders o where o.id = order_row.id;
end;
$$;

comment on function public.apply_purchase_order_amendment(uuid, boolean) is
  'Applies an approved amendment atomically, bumps the order version, writes a new immutable version snapshot, and refuses to silently rewrite quantities already received.';

revoke all on function public.apply_purchase_order_amendment(uuid, boolean) from public;
grant execute on function public.apply_purchase_order_amendment(uuid, boolean) to authenticated;
