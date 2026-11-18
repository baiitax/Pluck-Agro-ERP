-- 0056 — atomic document creation
--
-- PostgREST has no multi-statement transaction, so a service that inserts a header and then its
-- lines can leave a half-written document behind if the second call fails. For procurement that is
-- not an acceptable failure mode: a purchase order with no lines, or a receipt whose totals do not
-- match its items, would be a defect somebody has to clean up by hand.
--
-- Each function below creates one document and its lines in a single transaction, deriving the
-- snapshots (description, unit code, supplier name, outstanding quantity) from master data at the
-- moment of writing. They run as the *invoker*: RLS and the table grants still apply, so these
-- functions provide atomicity and nothing else. Permission is checked explicitly so the failure is
-- a clear refusal rather than an empty result.
--
-- Statuses are never set from outside: every document starts in `draft`, and moves only through
-- `procurement_decide` or a declared status transition.

-- ---------------------------------------------------------------------------
-- Requisitions
-- ---------------------------------------------------------------------------

create or replace function public.procurement_create_requisition(
  p_department_id uuid,
  p_requesting_employee_id uuid,
  p_requisition_date date,
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
  new_id uuid;
  line jsonb;
  line_no int := 0;
  product public.products;
  unit public.units_of_measure;
begin
  if not private.has_permission('procurement.requisition.create') then
    raise exception 'Raising a requisition requires permission procurement.requisition.create'
      using errcode = 'insufficient_privilege';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A requisition needs at least one line' using errcode = 'check_violation';
  end if;

  insert into public.purchase_requisitions
    (requesting_employee_id, department_id, requisition_date, required_delivery_date, purpose,
     justification, priority, currency_code, preferred_supplier_id, suggested_warehouse_id, notes, created_by)
  values
    (p_requesting_employee_id, p_department_id, coalesce(p_requisition_date, current_date),
     p_required_delivery_date, p_purpose, p_justification, coalesce(p_priority, 'normal'),
     coalesce(p_currency_code, 'NGN'), p_preferred_supplier_id, p_suggested_warehouse_id, p_notes, public.current_profile_id())
  returning purchase_requisitions.id into new_id;

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
      (new_id, line_no, product.id, product.name, (line ->> 'quantity')::numeric, unit.id,
       nullif(line ->> 'estimated_unit_price', '')::numeric, nullif(line ->> 'specification_notes', ''));
  end loop;

  return query
    select r.id, r.reference from public.purchase_requisitions r where r.id = new_id;
end;
$$;

comment on function public.procurement_create_requisition is
  'Creates a draft requisition and its lines atomically, snapshotting the product name and unit from master data.';

grant execute on function public.procurement_create_requisition(
  uuid, uuid, date, date, text, text, text, jsonb, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Supplier quotations
-- ---------------------------------------------------------------------------

create or replace function public.procurement_create_quotation(
  p_supplier_id uuid,
  p_quotation_date date,
  p_currency_code text,
  p_items jsonb,
  p_requisition_id uuid default null,
  p_quotation_request_id uuid default null,
  p_supplier_quotation_reference text default null,
  p_valid_until date default null,
  p_payment_terms_id uuid default null,
  p_delivery_terms_id uuid default null,
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
  new_id uuid;
  line jsonb;
  line_no int := 0;
  product public.products;
  unit public.units_of_measure;
  terms text;
  delivery_terms text;
begin
  if not private.has_permission('procurement.quotation.create') then
    raise exception 'Recording a quotation requires permission procurement.quotation.create'
      using errcode = 'insufficient_privilege';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A quotation needs at least one line' using errcode = 'check_violation';
  end if;

  -- Terms are snapshotted so a later rewrite of the master record cannot restate the offer.
  select pt.name into terms from public.payment_terms pt where pt.id = p_payment_terms_id;
  select dt.name into delivery_terms from public.delivery_terms dt where dt.id = p_delivery_terms_id;

  insert into public.supplier_quotations
    (supplier_id, requisition_id, quotation_request_id, supplier_quotation_reference, quotation_date,
     valid_until, currency_code, status, payment_terms_id, payment_terms_snapshot, delivery_terms_id,
     delivery_terms_snapshot, delivery_lead_time_days, proposed_delivery_date, discount_amount,
     delivery_charges, other_charges, charge_notes, remarks, recorded_by, created_by)
  values
    (p_supplier_id, p_requisition_id, p_quotation_request_id, p_supplier_quotation_reference,
     coalesce(p_quotation_date, current_date), p_valid_until, coalesce(p_currency_code, 'NGN'), 'received',
     p_payment_terms_id, terms, p_delivery_terms_id, delivery_terms, p_delivery_lead_time_days,
     p_proposed_delivery_date, coalesce(p_discount_amount, 0), coalesce(p_delivery_charges, 0),
     coalesce(p_other_charges, 0), p_charge_notes, p_remarks, public.current_profile_id(), public.current_profile_id())
  returning supplier_quotations.id into new_id;

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
      (new_id, line_no, product.id, product.name, (line ->> 'quantity')::numeric, unit.id,
       (line ->> 'unit_price')::numeric, coalesce(nullif(line ->> 'discount_amount', '')::numeric, 0),
       nullif(line ->> 'notes', ''));
  end loop;

  return query select q.id, q.reference from public.supplier_quotations q where q.id = new_id;
end;
$$;

comment on function public.procurement_create_quotation is
  'Creates a received supplier quotation and its lines atomically, snapshotting terms and product description.';

grant execute on function public.procurement_create_quotation(
  uuid, date, text, jsonb, uuid, uuid, text, date, uuid, uuid, int, date, numeric, numeric, numeric, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------

create or replace function public.procurement_create_purchase_order(
  p_supplier_id uuid,
  p_order_date date,
  p_currency_code text,
  p_items jsonb,
  p_selected_quotation_id uuid default null,
  p_selection_id uuid default null,
  p_expected_delivery_date date default null,
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
  p_requisition_ids uuid[] default null,
  p_internal_remarks text default null,
  p_supplier_instructions text default null
)
returns table (id uuid, reference text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
  line jsonb;
  line_no int := 0;
  product public.products;
  unit public.units_of_measure;
  supplier public.suppliers;
  terms text;
  delivery_terms text;
  requisition uuid;
  item_id uuid;
  allocation numeric(20, 6);
begin
  if not private.has_permission('procurement.purchase_order.create') then
    raise exception 'Creating a purchase order requires permission procurement.purchase_order.create'
      using errcode = 'insufficient_privilege';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A purchase order needs at least one line' using errcode = 'check_violation';
  end if;

  select * into supplier from public.suppliers where suppliers.id = p_supplier_id;
  if supplier.id is null then
    raise exception 'Supplier % does not exist', p_supplier_id using errcode = 'check_violation';
  end if;

  select pt.name into terms from public.payment_terms pt where pt.id = p_payment_terms_id;
  select dt.name into delivery_terms from public.delivery_terms dt where dt.id = p_delivery_terms_id;

  insert into public.purchase_orders
    (supplier_id, supplier_name_snapshot, selected_quotation_id, selection_id, order_date,
     expected_delivery_date, currency_code, exchange_rate, exchange_rate_type, exchange_rate_date,
     base_currency_code, payment_terms_id, payment_terms_snapshot, delivery_terms_id,
     delivery_terms_snapshot, delivery_warehouse_id, delivery_location_id, delivery_address,
     procurement_officer_employee_id, department_id, internal_remarks, supplier_instructions, created_by)
  values
    (p_supplier_id, supplier.legal_name, p_selected_quotation_id, p_selection_id,
     coalesce(p_order_date, current_date), p_expected_delivery_date, coalesce(p_currency_code, 'NGN'),
     p_exchange_rate, p_exchange_rate_type, case when p_exchange_rate is null then null else current_date end,
     p_base_currency_code, p_payment_terms_id, terms, p_delivery_terms_id, delivery_terms,
     p_delivery_warehouse_id, p_delivery_location_id, p_delivery_address,
     p_procurement_officer_employee_id, p_department_id, p_internal_remarks, p_supplier_instructions,
     public.current_profile_id())
  returning purchase_orders.id into new_id;

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
      (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
       unit_id, unit_code_snapshot, quantity, unit_price, discount_amount, additional_charges,
       tax_category_id, tax_amount, requisition_item_id, specification_notes)
    values
      (new_id, line_no, product.id, product.code, product.name, unit.id, unit.code,
       (line ->> 'quantity')::numeric, (line ->> 'unit_price')::numeric,
       coalesce(nullif(line ->> 'discount_amount', '')::numeric, 0),
       coalesce(nullif(line ->> 'additional_charges', '')::numeric, 0),
       nullif(line ->> 'tax_category_id', '')::uuid,
       coalesce(nullif(line ->> 'tax_amount', '')::numeric, 0),
       nullif(line ->> 'requisition_item_id', '')::uuid,
       nullif(line ->> 'specification_notes', ''))
    returning purchase_order_items.id into item_id;

    -- Requisition allocations are what make "one requisition split across several orders" auditable.
    if nullif(line ->> 'requisition_item_id', '') is not null then
      allocation := (line ->> 'quantity')::numeric;
      insert into public.purchase_requisition_allocations
        (requisition_item_id, purchase_order_item_id, allocated_quantity, created_by)
      values ((line ->> 'requisition_item_id')::uuid, item_id, allocation, public.current_profile_id());
    end if;
  end loop;

  if p_requisition_ids is not null then
    foreach requisition in array p_requisition_ids
    loop
      insert into public.purchase_order_requisition_links (purchase_order_id, requisition_id)
      values (new_id, requisition)
      on conflict (purchase_order_id, requisition_id) do nothing;
    end loop;
  end if;

  return query select po.id, po.reference from public.purchase_orders po where po.id = new_id;
end;
$$;

comment on function public.procurement_create_purchase_order is
  'Creates a draft purchase order, its lines and its requisition allocations atomically, snapshotting product, unit, supplier and terms.';

grant execute on function public.procurement_create_purchase_order(
  uuid, date, text, jsonb, uuid, uuid, date, numeric, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid,
  uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Goods receipts
-- ---------------------------------------------------------------------------

create or replace function public.procurement_create_goods_receipt(
  p_purchase_order_id uuid,
  p_warehouse_id uuid,
  p_receipt_date date,
  p_items jsonb,
  p_supplier_delivery_note_number text default null,
  p_delivery_reference text default null,
  p_location_id uuid default null,
  p_receiving_employee_id uuid default null,
  p_vehicle_reference text default null,
  p_transporter_name text default null,
  p_observations text default null
)
returns table (id uuid, reference text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
  line jsonb;
  line_no int := 0;
  order_row public.purchase_orders;
  po_item public.purchase_order_items;
  outstanding numeric(20, 6);
  received_before numeric(20, 6);
  received numeric(20, 6);
  accepted numeric(20, 6);
  rejected numeric(20, 6);
  quarantined numeric(20, 6);
begin
  if not private.has_permission('procurement.goods_receipt.create') then
    raise exception 'Recording a goods receipt requires permission procurement.goods_receipt.create'
      using errcode = 'insufficient_privilege';
  end if;

  select * into order_row from public.purchase_orders where purchase_orders.id = p_purchase_order_id;
  if order_row.id is null then
    raise exception 'Purchase order % does not exist', p_purchase_order_id using errcode = 'check_violation';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A goods receipt needs at least one line' using errcode = 'check_violation';
  end if;

  insert into public.goods_receipts
    (purchase_order_id, supplier_id, warehouse_id, location_id, receipt_date,
     supplier_delivery_note_number, delivery_reference, receiving_employee_id, vehicle_reference,
     transporter_name, observations, created_by)
  values
    (p_purchase_order_id, order_row.supplier_id, p_warehouse_id, p_location_id,
     coalesce(p_receipt_date, current_date), p_supplier_delivery_note_number, p_delivery_reference,
     p_receiving_employee_id, p_vehicle_reference, p_transporter_name, p_observations, public.current_profile_id())
  returning goods_receipts.id into new_id;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_no := line_no + 1;

    select * into po_item from public.purchase_order_items
     where purchase_order_items.id = (line ->> 'purchase_order_item_id')::uuid;
    if po_item.id is null or po_item.purchase_order_id <> p_purchase_order_id then
      raise exception 'Line % does not belong to this purchase order', line ->> 'purchase_order_item_id'
        using errcode = 'check_violation';
    end if;

    -- Quantity context is captured at receipt time so the document can be read years later without
    -- re-deriving it from the order as it stands today.
    select coalesce(sum(gi.received_quantity), 0)
      into received_before
      from public.goods_receipt_items gi
      join public.goods_receipts gr on gr.id = gi.goods_receipt_id
     where gi.purchase_order_item_id = po_item.id
       and gr.status in ('posted', 'approved');

    outstanding := po_item.quantity - received_before;

    received := coalesce(nullif(line ->> 'received_quantity', '')::numeric, 0);
    accepted := coalesce(nullif(line ->> 'accepted_quantity', '')::numeric, 0);
    rejected := coalesce(nullif(line ->> 'rejected_quantity', '')::numeric, 0);
    quarantined := coalesce(nullif(line ->> 'quarantined_quantity', '')::numeric, 0);

    insert into public.goods_receipt_items
      (goods_receipt_id, purchase_order_item_id, line_number, product_id, product_description, unit_id,
       unit_code_snapshot, ordered_quantity, previously_received_quantity, received_quantity,
       accepted_quantity, rejected_quantity, quarantined_quantity, rejection_reason,
       packaging_details, observations)
    values
      (new_id, po_item.id, line_no, po_item.product_id, po_item.product_description, po_item.unit_id,
       po_item.unit_code_snapshot, po_item.quantity, received_before, received, accepted, rejected,
       quarantined, nullif(line ->> 'rejection_reason', ''), nullif(line ->> 'packaging_details', ''),
       nullif(line ->> 'observations', ''));
  end loop;

  return query select gr.id, gr.reference from public.goods_receipts gr where gr.id = new_id;
end;
$$;

comment on function public.procurement_create_goods_receipt is
  'Creates a draft goods receipt and its lines atomically, capturing the ordered and previously received quantity per line. Posting remains a separate, single-use step.';

grant execute on function public.procurement_create_goods_receipt(
  uuid, uuid, date, jsonb, text, text, uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Purchase order amendments
-- ---------------------------------------------------------------------------

create or replace function public.procurement_create_amendment(
  p_purchase_order_id uuid,
  p_reason text,
  p_items jsonb,
  p_requested_employee_id uuid default null
)
returns table (id uuid, reference text, base_version int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
  line jsonb;
  order_row public.purchase_orders;
  base int;
begin
  if not private.has_permission('procurement.purchase_order.amend') then
    raise exception 'Raising an amendment requires permission procurement.purchase_order.amend'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'An amendment needs a reason of at least 10 characters' using errcode = 'check_violation';
  end if;

  select * into order_row from public.purchase_orders where purchase_orders.id = p_purchase_order_id;
  if order_row.id is null then
    raise exception 'Purchase order % does not exist', p_purchase_order_id using errcode = 'check_violation';
  end if;

  if order_row.status not in ('issued', 'partially_received', 'fully_received') then
    raise exception 'Only an issued order can be amended; % is %', order_row.reference, order_row.status
      using errcode = 'check_violation';
  end if;

  base := order_row.version;

  insert into public.purchase_order_amendments
    (purchase_order_id, reason, base_version, requested_by, requested_employee_id)
  values (p_purchase_order_id, p_reason, base, public.current_profile_id(), p_requested_employee_id)
  returning purchase_order_amendments.id into new_id;

  if p_items is not null then
    for line in select * from jsonb_array_elements(p_items)
    loop
      -- The interface asks for a change type and a new value; the apply function works on typed
      -- columns. Deriving the typed column here means the operator writes "12000", not a JSON object,
      -- and a non-numeric value for a quantity is refused at capture time rather than at apply time.
      if (line ->> 'change_type') = 'quantity'
         and nullif(line ->> 'quantity', '') is null
         and nullif(line ->> 'new_value', '') is not null
         and (line ->> 'new_value') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'A quantity change needs a number, not "%"', line ->> 'new_value'
          using errcode = 'check_violation';
      end if;
      if (line ->> 'change_type') = 'unit_price'
         and nullif(line ->> 'unit_price', '') is null
         and nullif(line ->> 'new_value', '') is not null
         and (line ->> 'new_value') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'A price change needs a number, not "%"', line ->> 'new_value'
          using errcode = 'check_violation';
      end if;

      insert into public.purchase_order_amendment_items
        (amendment_id, purchase_order_item_id, change_type, field_name, previous_value, new_value,
         product_id, quantity, unit_id, unit_price)
      values (
        new_id,
        nullif(line ->> 'purchase_order_item_id', '')::uuid,
        line ->> 'change_type',
        nullif(line ->> 'field_name', ''),
        nullif(line ->> 'previous_value', ''),
        line ->> 'new_value',
        nullif(line ->> 'product_id', '')::uuid,
        coalesce(
          nullif(line ->> 'quantity', '')::numeric,
          case when (line ->> 'change_type') = 'quantity'
                    and (line ->> 'new_value') ~ '^[0-9]+(\.[0-9]+)?$'
               then (line ->> 'new_value')::numeric end
        ),
        nullif(line ->> 'unit_id', '')::uuid,
        coalesce(
          nullif(line ->> 'unit_price', '')::numeric,
          case when (line ->> 'change_type') = 'unit_price'
                    and (line ->> 'new_value') ~ '^[0-9]+(\.[0-9]+)?$'
               then (line ->> 'new_value')::numeric end
        )
      );
    end loop;
  end if;

  return query
    select a.id, a.reference, a.base_version
      from public.purchase_order_amendments a
     where a.id = new_id;
end;
$$;

comment on function public.procurement_create_amendment is
  'Creates an amendment against the order version currently in force, with its change lines, atomically.';

grant execute on function public.procurement_create_amendment(uuid, text, jsonb, uuid) to authenticated;
