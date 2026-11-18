-- 0057 — atomic draft editing
--
-- Creating a document atomically (0056) is not enough: editing one has the same failure mode. The
-- functions here rewrite a working copy — header and lines together — inside one transaction, and
-- refuse anything that is no longer a working copy.
--
-- What "working copy" means is decided by the database, not the interface:
--   * a requisition is editable while it is draft or rejected;
--   * a purchase order is editable while it is draft or rejected — once approved it can only be
--     changed by an amendment (0053);
--   * a quotation is editable while it is draft, received or under evaluation — selecting it freezes
--     the offer that was compared.
--
-- Editing never touches status. A rejected document returns to draft through the declared lifecycle,
-- by the person holding the permission for that edge.

-- ---------------------------------------------------------------------------
-- Requisition
-- ---------------------------------------------------------------------------

create or replace function public.procurement_update_requisition(
  p_id uuid,
  p_required_delivery_date date,
  p_purpose text,
  p_priority text,
  p_currency_code text,
  p_items jsonb,
  p_preferred_supplier_id uuid default null,
  p_suggested_warehouse_id uuid default null,
  p_justification text default null,
  p_notes text default null
)
returns table (id uuid, reference text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing public.purchase_requisitions;
  line jsonb;
  line_no int := 0;
  product public.products;
  unit public.units_of_measure;
begin
  if not private.has_permission('procurement.requisition.update') then
    raise exception 'Editing a requisition requires permission procurement.requisition.update'
      using errcode = 'insufficient_privilege';
  end if;

  select * into existing from public.purchase_requisitions where purchase_requisitions.id = p_id for update;
  if existing.id is null then
    raise exception 'Requisition % not found', p_id using errcode = 'no_data_found';
  end if;

  if existing.status not in ('draft', 'rejected') then
    raise exception 'Requisition % is % and can no longer be edited. Raise a new request instead.',
      existing.reference, existing.status
      using errcode = 'check_violation';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A requisition needs at least one line' using errcode = 'check_violation';
  end if;

  update public.purchase_requisitions
     set required_delivery_date = p_required_delivery_date,
         purpose = p_purpose,
         priority = coalesce(p_priority, priority),
         currency_code = coalesce(p_currency_code, currency_code),
         preferred_supplier_id = p_preferred_supplier_id,
         suggested_warehouse_id = p_suggested_warehouse_id,
         justification = p_justification,
         notes = p_notes,
         updated_by = public.current_profile_id()
   where purchase_requisitions.id = p_id;

  -- Lines referenced by an allocation cannot be deleted: the order that consumed them still exists.
  if exists (
    select 1
      from public.purchase_requisition_allocations a
      join public.purchase_requisition_items i on i.id = a.requisition_item_id
     where i.requisition_id = p_id
  ) then
    raise exception 'This requisition has already been allocated to a purchase order and its lines cannot be rewritten'
      using errcode = 'check_violation';
  end if;

  delete from public.purchase_requisition_items where requisition_id = p_id;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_no := line_no + 1;

    select * into product from public.products where products.id = (line ->> 'product_id')::uuid;
    if product.id is null then
      raise exception 'Product % does not exist', line ->> 'product_id' using errcode = 'check_violation';
    end if;

    select * into unit from public.units_of_measure where units_of_measure.id = (line ->> 'unit_id')::uuid;
    if unit.id is null then
      raise exception 'Unit % does not exist', line ->> 'unit_id' using errcode = 'check_violation';
    end if;

    insert into public.purchase_requisition_items
      (requisition_id, line_number, product_id, product_description, quantity, unit_id,
       estimated_unit_price, specification_notes)
    values
      (p_id, line_no, product.id, product.name, (line ->> 'quantity')::numeric, unit.id,
       nullif(line ->> 'estimated_unit_price', '')::numeric, nullif(line ->> 'specification_notes', ''));
  end loop;

  return query select r.id, r.reference from public.purchase_requisitions r where r.id = p_id;
end;
$$;

comment on function public.procurement_update_requisition is
  'Rewrites a draft or rejected requisition and its lines in one transaction. Refuses once lines have been allocated to an order.';

grant execute on function public.procurement_update_requisition(
  uuid, date, text, text, text, jsonb, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Draft purchase order
-- ---------------------------------------------------------------------------

create or replace function public.procurement_update_draft_purchase_order(
  p_id uuid,
  p_expected_delivery_date date,
  p_currency_code text,
  p_items jsonb,
  p_exchange_rate numeric default null,
  p_exchange_rate_type text default null,
  p_base_currency_code text default null,
  p_payment_terms_id uuid default null,
  p_delivery_terms_id uuid default null,
  p_delivery_warehouse_id uuid default null,
  p_delivery_location_id uuid default null,
  p_delivery_address text default null,
  p_procurement_officer_employee_id uuid default null,
  p_department_id uuid default null,
  p_internal_remarks text default null,
  p_supplier_instructions text default null
)
returns table (id uuid, reference text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing public.purchase_orders;
  line jsonb;
  line_no int := 0;
  product public.products;
  unit public.units_of_measure;
  terms text;
  delivery_terms text;
  item_id uuid;
begin
  if not private.has_permission('procurement.purchase_order.update') then
    raise exception 'Editing a purchase order requires permission procurement.purchase_order.update'
      using errcode = 'insufficient_privilege';
  end if;

  select * into existing from public.purchase_orders where purchase_orders.id = p_id for update;
  if existing.id is null then
    raise exception 'Purchase order % not found', p_id using errcode = 'no_data_found';
  end if;

  if existing.status not in ('draft', 'rejected') then
    raise exception 'Purchase order % is %. An issued order is changed by an amendment, not by editing.',
      existing.reference, existing.status
      using errcode = 'check_violation';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A purchase order needs at least one line' using errcode = 'check_violation';
  end if;

  select pt.name into terms from public.payment_terms pt where pt.id = p_payment_terms_id;
  select dt.name into delivery_terms from public.delivery_terms dt where dt.id = p_delivery_terms_id;

  update public.purchase_orders
     set expected_delivery_date = p_expected_delivery_date,
         currency_code = coalesce(p_currency_code, currency_code),
         exchange_rate = p_exchange_rate,
         exchange_rate_type = p_exchange_rate_type,
         base_currency_code = p_base_currency_code,
         payment_terms_id = p_payment_terms_id,
         payment_terms_snapshot = terms,
         delivery_terms_id = p_delivery_terms_id,
         delivery_terms_snapshot = delivery_terms,
         delivery_warehouse_id = p_delivery_warehouse_id,
         delivery_location_id = p_delivery_location_id,
         delivery_address = p_delivery_address,
         procurement_officer_employee_id = p_procurement_officer_employee_id,
         department_id = p_department_id,
         internal_remarks = p_internal_remarks,
         supplier_instructions = p_supplier_instructions,
         updated_by = public.current_profile_id()
   where purchase_orders.id = p_id;

  delete from public.purchase_order_items where purchase_order_id = p_id;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_no := line_no + 1;

    select * into product from public.products where products.id = (line ->> 'product_id')::uuid;
    if product.id is null then
      raise exception 'Product % does not exist', line ->> 'product_id' using errcode = 'check_violation';
    end if;

    select * into unit from public.units_of_measure where units_of_measure.id = (line ->> 'unit_id')::uuid;
    if unit.id is null then
      raise exception 'Unit % does not exist', line ->> 'unit_id' using errcode = 'check_violation';
    end if;

    insert into public.purchase_order_items
      (purchase_order_id, line_number, product_id, product_code_snapshot, product_description, unit_id,
       unit_code_snapshot, quantity, unit_price, discount_amount, additional_charges, tax_category_id,
       tax_amount, requisition_item_id, specification_notes)
    values
      (p_id, line_no, product.id, product.code, product.name, unit.id, unit.code,
       (line ->> 'quantity')::numeric, (line ->> 'unit_price')::numeric,
       coalesce(nullif(line ->> 'discount_amount', '')::numeric, 0),
       coalesce(nullif(line ->> 'additional_charges', '')::numeric, 0),
       nullif(line ->> 'tax_category_id', '')::uuid,
       coalesce(nullif(line ->> 'tax_amount', '')::numeric, 0),
       nullif(line ->> 'requisition_item_id', '')::uuid,
       nullif(line ->> 'specification_notes', ''))
    returning purchase_order_items.id into item_id;

    if nullif(line ->> 'requisition_item_id', '') is not null then
      insert into public.purchase_requisition_allocations
        (requisition_item_id, purchase_order_item_id, allocated_quantity, created_by)
      values ((line ->> 'requisition_item_id')::uuid, item_id, (line ->> 'quantity')::numeric,
              public.current_profile_id())
      on conflict do nothing;
    end if;
  end loop;

  return query select po.id, po.reference from public.purchase_orders po where po.id = p_id;
end;
$$;

comment on function public.procurement_update_draft_purchase_order is
  'Rewrites a draft or rejected purchase order and its lines in one transaction. An approved or issued order must be changed by amendment.';

grant execute on function public.procurement_update_draft_purchase_order(
  uuid, date, text, jsonb, numeric, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Quotation
-- ---------------------------------------------------------------------------

create or replace function public.procurement_update_quotation(
  p_id uuid,
  p_valid_until date,
  p_items jsonb,
  p_delivery_lead_time_days int default null,
  p_proposed_delivery_date date default null,
  p_discount_amount numeric default 0,
  p_delivery_charges numeric default 0,
  p_other_charges numeric default 0,
  p_charge_notes text default null,
  p_remarks text default null
)
returns table (id uuid, reference text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing public.supplier_quotations;
  line jsonb;
  line_no int := 0;
  product public.products;
  unit public.units_of_measure;
begin
  if not private.has_permission('procurement.quotation.update') then
    raise exception 'Editing a quotation requires permission procurement.quotation.update'
      using errcode = 'insufficient_privilege';
  end if;

  select * into existing from public.supplier_quotations where supplier_quotations.id = p_id for update;
  if existing.id is null then
    raise exception 'Quotation % not found', p_id using errcode = 'no_data_found';
  end if;

  if existing.status not in ('draft', 'received', 'under_evaluation') then
    raise exception 'Quotation % is % and can no longer be edited.',
      existing.reference, existing.status
      using errcode = 'check_violation';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A quotation needs at least one line' using errcode = 'check_violation';
  end if;

  update public.supplier_quotations
     set valid_until = p_valid_until,
         delivery_lead_time_days = p_delivery_lead_time_days,
         proposed_delivery_date = p_proposed_delivery_date,
         discount_amount = coalesce(p_discount_amount, 0),
         delivery_charges = coalesce(p_delivery_charges, 0),
         other_charges = coalesce(p_other_charges, 0),
         charge_notes = p_charge_notes,
         remarks = p_remarks,
         updated_by = public.current_profile_id()
   where supplier_quotations.id = p_id;

  delete from public.supplier_quotation_items where quotation_id = p_id;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_no := line_no + 1;

    select * into product from public.products where products.id = (line ->> 'product_id')::uuid;
    if product.id is null then
      raise exception 'Product % does not exist', line ->> 'product_id' using errcode = 'check_violation';
    end if;

    select * into unit from public.units_of_measure where units_of_measure.id = (line ->> 'unit_id')::uuid;
    if unit.id is null then
      raise exception 'Unit % does not exist', line ->> 'unit_id' using errcode = 'check_violation';
    end if;

    insert into public.supplier_quotation_items
      (quotation_id, line_number, product_id, product_description, quantity, unit_id, unit_price,
       discount_amount, notes)
    values
      (p_id, line_no, product.id, product.name, (line ->> 'quantity')::numeric, unit.id,
       (line ->> 'unit_price')::numeric, coalesce(nullif(line ->> 'discount_amount', '')::numeric, 0),
       nullif(line ->> 'notes', ''));
  end loop;

  return query select q.id, q.reference from public.supplier_quotations q where q.id = p_id;
end;
$$;

comment on function public.procurement_update_quotation is
  'Rewrites an open quotation and its lines in one transaction, recomputing the compared totals.';

grant execute on function public.procurement_update_quotation(
  uuid, date, jsonb, int, date, numeric, numeric, numeric, text, text) to authenticated;
