-- 0046 — goods receipts, inspection and posting
--
-- The goods receipt is where procurement stops and inventory will begin. Phase 3 records what
-- arrived, what was accepted, what was rejected and what was quarantined, and then *posts* the
-- receipt exactly once, atomically, emitting a durable outbox event for the future inventory
-- module. It does not maintain a stock balance: accepted quantities are evidence for Phase 5, not
-- an inventory ledger.
--
-- Three invariants are enforced in the database rather than in a screen:
--   * received = accepted + rejected + quarantined, always (a CHECK constraint);
--   * a receipt may only be posted against an issued order, and only once (posting row + unique keys);
--   * concurrent postings cannot consume the same outstanding quantity twice (row lock on the order
--     inside public.post_goods_receipt).

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete restrict on update cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  supplier_delivery_note_number text,
  delivery_reference text,
  receipt_date date not null default current_date,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict on update cascade,
  location_id uuid references public.warehouse_locations (id) on delete set null on update cascade,
  receiving_employee_id uuid references public.employees (id) on delete set null on update cascade,
  vehicle_reference text,
  transporter_name text,
  status text not null default 'draft',
  status_reason text,
  inspection_status text not null default 'pending',
  observations text,
  reviewed_by uuid references public.profiles (id) on delete set null on update cascade,
  reviewed_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,
  posted_by uuid references public.profiles (id) on delete set null on update cascade,
  posted_at timestamptz,
  posting_reference text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null on update cascade,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goods_receipts_reference_unique unique (reference),
  constraint goods_receipts_posting_reference_unique unique (posting_reference),
  constraint goods_receipts_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,19}-[0-9]{3,12}$'),
  constraint goods_receipts_status_check
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'returned',
                      'posted', 'cancelled')),
  constraint goods_receipts_inspection_status_check
    check (inspection_status in ('pending', 'passed', 'failed', 'partial', 'not_required')),
  constraint goods_receipts_approved_stamped
    check (status <> 'approved' or (approved_at is not null and approved_by is not null)),
  constraint goods_receipts_posted_stamped
    check (status <> 'posted' or (posted_at is not null and posted_by is not null and posting_reference is not null)),
  constraint goods_receipts_cancelled_stamped
    check (status <> 'cancelled' or (cancelled_at is not null and status_reason is not null))
);

create index if not exists goods_receipts_po_idx on public.goods_receipts (purchase_order_id, status);
create index if not exists goods_receipts_supplier_idx on public.goods_receipts (supplier_id, receipt_date desc);
create index if not exists goods_receipts_status_idx on public.goods_receipts (status, receipt_date desc);

-- A supplier cannot deliver the same consignment note twice. Enforced where the data lives, so a
-- retry from an integration is caught as well as a duplicate entry from a form.
create unique index if not exists goods_receipts_delivery_note_unique
  on public.goods_receipts (supplier_id, supplier_delivery_note_number)
  where supplier_delivery_note_number is not null and status <> 'cancelled';

comment on table public.goods_receipts is
  'Recorded deliveries against an issued purchase order. Posting is one-time and atomic.';

create table if not exists public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts (id) on delete cascade on update cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items (id) on delete restrict on update cascade,
  line_number int not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  product_description text not null,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  unit_code_snapshot text not null,
  ordered_quantity numeric(20, 6) not null,
  previously_received_quantity numeric(20, 6) not null default 0,
  received_quantity numeric(20, 6) not null,
  accepted_quantity numeric(20, 6) not null default 0,
  rejected_quantity numeric(20, 6) not null default 0,
  quarantined_quantity numeric(20, 6) not null default 0,
  rejection_reason text,
  packaging_details text,
  observations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goods_receipt_items_line_positive check (line_number > 0),
  constraint goods_receipt_items_quantities_non_negative
    check (ordered_quantity >= 0 and previously_received_quantity >= 0 and received_quantity > 0
           and accepted_quantity >= 0 and rejected_quantity >= 0 and quarantined_quantity >= 0),
  -- The split must add up. Nothing may arrive unaccounted for.
  constraint goods_receipt_items_split_matches
    check (accepted_quantity + rejected_quantity + quarantined_quantity = received_quantity),
  constraint goods_receipt_items_rejection_reason_present
    check (rejected_quantity = 0 or (rejection_reason is not null and length(btrim(rejection_reason)) >= 3)),
  constraint goods_receipt_items_line_unique unique (goods_receipt_id, line_number),
  constraint goods_receipt_items_po_line_unique unique (goods_receipt_id, purchase_order_item_id)
);

create index if not exists goods_receipt_items_receipt_idx on public.goods_receipt_items (goods_receipt_id, line_number);

comment on table public.goods_receipt_items is
  'Delivery lines. accepted + rejected + quarantined must equal received — enforced by CHECK.';

create table if not exists public.goods_receipt_inspections (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts (id) on delete cascade on update cascade,
  goods_receipt_item_id uuid references public.goods_receipt_items (id) on delete cascade on update cascade,
  inspection_type text not null default 'quantity_and_condition',
  result text not null default 'pending',
  quantity_inspected numeric(20, 6),
  findings text,
  inspected_by uuid references public.employees (id) on delete set null on update cascade,
  inspected_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint goods_receipt_inspections_type_check
    check (inspection_type in ('quantity_and_condition', 'quality', 'documentation', 'other')),
  constraint goods_receipt_inspections_result_check
    check (result in ('pending', 'passed', 'failed', 'partial')),
  constraint goods_receipt_inspections_quantity_non_negative
    check (quantity_inspected is null or quantity_inspected >= 0)
);

create index if not exists goods_receipt_inspections_receipt_idx
  on public.goods_receipt_inspections (goods_receipt_id);

create table if not exists public.goods_receipt_postings (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts (id) on delete restrict on update cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete restrict on update cascade,
  posting_reference text not null,
  idempotency_key text not null,
  accepted_total numeric(20, 6) not null default 0,
  rejected_total numeric(20, 6) not null default 0,
  quarantined_total numeric(20, 6) not null default 0,
  posted_by uuid references public.profiles (id) on delete set null on update cascade,
  posted_at timestamptz not null default now(),
  constraint goods_receipt_postings_receipt_unique unique (goods_receipt_id),
  constraint goods_receipt_postings_reference_unique unique (posting_reference),
  constraint goods_receipt_postings_idempotency_unique unique (idempotency_key),
  constraint goods_receipt_postings_totals_non_negative
    check (accepted_total >= 0 and rejected_total >= 0 and quarantined_total >= 0)
);

comment on table public.goods_receipt_postings is
  'One row per posted receipt. The unique constraints make double posting impossible, not merely unlikely.';

drop trigger if exists goods_receipt_postings_immutable on public.goods_receipt_postings;
create trigger goods_receipt_postings_immutable
  before update or delete on public.goods_receipt_postings
  for each row execute function private.block_procurement_history_mutation();

-- ---------------------------------------------------------------------------
-- Integration outbox
-- ---------------------------------------------------------------------------
-- The inventory ledger belongs to a later phase. Until it exists, a posted receipt must not claim
-- that stock moved. It writes a durable, idempotent event instead, and says so in the interface.

create table if not exists public.procurement_integration_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  constraint procurement_integration_outbox_key_unique unique (idempotency_key),
  constraint procurement_integration_outbox_status_check
    check (status in ('pending', 'dispatched', 'failed', 'consumed')),
  constraint procurement_integration_outbox_attempts_non_negative check (attempts >= 0)
);

create index if not exists procurement_integration_outbox_status_idx
  on public.procurement_integration_outbox (status, created_at);
create index if not exists procurement_integration_outbox_entity_idx
  on public.procurement_integration_outbox (entity_type, entity_id);

comment on table public.procurement_integration_outbox is
  'Durable handoff events (for example procurement.goods_receipt.posted). status pending means NO consumer has recorded it: stock has not been updated.';

-- ---------------------------------------------------------------------------
-- Receipt guards
-- ---------------------------------------------------------------------------

create or replace function private.goods_receipt_is_locked(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('submitted', 'under_review', 'approved', 'posted', 'rejected', 'cancelled');
$$;

create or replace function private.guard_goods_receipt_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mutable text[] := array['status', 'status_reason', 'inspection_status', 'reviewed_by',
                          'reviewed_at', 'approved_by', 'approved_at', 'posted_by', 'posted_at',
                          'posting_reference', 'cancelled_at', 'cancelled_by', 'updated_at', 'updated_by'];
  changed text[];
begin
  if not private.goods_receipt_is_locked(old.status) then
    return new;
  end if;
  if new.status is distinct from old.status and new.status = 'draft' then
    return new;
  end if;

  select coalesce(array_agg(key order by key), array[]::text[])
    into changed
    from jsonb_each(to_jsonb(new)) as e(key, value)
   where (to_jsonb(old) -> key) is distinct from value
     and key <> all (mutable);

  if array_length(changed, 1) > 0 then
    raise exception 'Goods receipt % is % and cannot be edited (attempted: %)', old.reference, old.status,
      array_to_string(changed, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists goods_receipts_edit_guard on public.goods_receipts;
create trigger goods_receipts_edit_guard
  before update on public.goods_receipts
  for each row execute function private.guard_goods_receipt_edit();

create or replace function private.guard_goods_receipt_item_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
begin
  select status into parent_status
    from public.goods_receipts where id = coalesce(new.goods_receipt_id, old.goods_receipt_id);
  if parent_status is null then
    return coalesce(new, old);
  end if;
  if private.goods_receipt_is_locked(parent_status) then
    raise exception 'Receipt lines cannot be changed while the receipt is %', parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists goods_receipt_items_write_guard on public.goods_receipt_items;
create trigger goods_receipt_items_write_guard
  before insert or update or delete on public.goods_receipt_items
  for each row execute function private.guard_goods_receipt_item_write();

drop trigger if exists goods_receipt_items_set_updated_at on public.goods_receipt_items;
create trigger goods_receipt_items_set_updated_at
  before update on public.goods_receipt_items
  for each row execute function private.set_updated_at();

select private.install_procurement_triggers('public.goods_receipts', 'goods_receipt', 'reference');

/**
 * Validates a receipt line against the order it belongs to, when the receipt is submitted.
 *
 * Checks the rules the specification lists explicitly: the line must belong to the same order, the
 * receipt must be for the order's supplier, and the quantity may not exceed what is outstanding
 * plus the configured tolerance (default zero).
 */
create or replace function private.validate_goods_receipt_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  line_po uuid;
  receipt_po uuid;
  receipt_status text;
  receipt_supplier uuid;
  po_supplier uuid;
  outstanding numeric(20, 6);
  received_before numeric(20, 6);
  tolerance numeric;
  allowed numeric(20, 6);
begin
  select purchase_order_id, status, supplier_id
    into receipt_po, receipt_status, receipt_supplier
    from public.goods_receipts where id = new.goods_receipt_id;

  if receipt_status = 'draft' then
    return new;
  end if;

  select purchase_order_id into line_po
    from public.purchase_order_items where id = new.purchase_order_item_id;

  if line_po is distinct from receipt_po then
    raise exception 'Receipt line % does not belong to purchase order of this receipt', new.line_number
      using errcode = 'check_violation';
  end if;

  select supplier_id into po_supplier from public.purchase_orders where id = receipt_po;
  if po_supplier is distinct from receipt_supplier then
    raise exception 'The receipt supplier does not match the purchase order supplier'
      using errcode = 'check_violation';
  end if;

  select ordered_quantity, received_quantity, outstanding_quantity
    into new.ordered_quantity, received_before, outstanding
    from public.purchase_order_receipt_status
   where purchase_order_item_id = new.purchase_order_item_id;

  new.previously_received_quantity := received_before;

  tolerance := coalesce(private.procurement_setting_numeric('excess_receipt_tolerance_percent'), 0);
  allowed := outstanding + (outstanding * tolerance / 100);

  if new.received_quantity > allowed then
    raise exception 'Receiving % against line % exceeds the outstanding quantity % (tolerance % percent)',
      new.received_quantity, new.line_number, outstanding, tolerance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists goods_receipt_items_validate on public.goods_receipt_items;
create trigger goods_receipt_items_validate
  before insert or update on public.goods_receipt_items
  for each row execute function private.validate_goods_receipt_line();

-- ---------------------------------------------------------------------------
-- Atomic posting
-- ---------------------------------------------------------------------------

/**
 * Posts a goods receipt exactly once and emits the inventory handoff event.
 *
 * Steps, all inside one transaction:
 *   1. take the receipt and its purchase order under a row lock (serialises competing postings);
 *   2. return the existing posting when this receipt — or this idempotency key — was already posted;
 *   3. refuse anything that is not approved, or whose order is not issuable from;
 *   4. re-validate the outstanding quantities against the *locked* order, so a receipt validated
 *      hours ago cannot over-receive after another receipt posted in the meantime;
 *   5. write the posting row, the outbox event and the resulting order status.
 *
 * Excess delivery beyond the configured tolerance is refused unless the caller explicitly allows it
 * *and* holds procurement.goods_receipt.approve — the exception is then visible in the posting row
 * and in the audit trail.
 */
create or replace function public.post_goods_receipt(
  p_receipt_id uuid,
  p_idempotency_key text,
  p_allow_excess boolean default false
)
returns table (posting_reference text, already_posted boolean, outbox_event_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  receipt public.goods_receipts;
  order_row public.purchase_orders;
  existing public.goods_receipt_postings;
  line record;
  outstanding numeric(20, 6);
  tolerance numeric;
  allowed numeric(20, 6);
  accepted_total numeric(20, 6) := 0;
  rejected_total numeric(20, 6) := 0;
  quarantined_total numeric(20, 6) := 0;
  new_reference text;
  event_id uuid;
  items jsonb;
  any_outstanding boolean;
  any_received boolean;
begin
  if auth.uid() is null then
    raise exception 'Posting a goods receipt requires an authenticated user for attribution'
      using errcode = 'insufficient_privilege';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'A posting idempotency key of at least 8 characters is required'
      using errcode = 'check_violation';
  end if;

  -- Serialise on the receipt first, then on the order: always the same order, so two postings
  -- cannot deadlock each other.
  select * into receipt from public.goods_receipts where id = p_receipt_id for update;
  if receipt.id is null then
    raise exception 'Goods receipt % not found', p_receipt_id using errcode = 'no_data_found';
  end if;

  select * into existing from public.goods_receipt_postings where goods_receipt_id = p_receipt_id;
  if existing.id is not null then
    return query select existing.posting_reference, true, null::uuid;
    return;
  end if;

  select * into existing from public.goods_receipt_postings where idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return query select existing.posting_reference, true, null::uuid;
    return;
  end if;

  select * into order_row from public.purchase_orders where id = receipt.purchase_order_id for update;
  if order_row.id is null then
    raise exception 'The purchase order of this receipt no longer exists' using errcode = 'check_violation';
  end if;

  if receipt.status <> 'approved' then
    raise exception 'Only an approved goods receipt can be posted (this one is %)', receipt.status
      using errcode = 'check_violation';
  end if;

  if order_row.status not in ('issued', 'partially_received', 'fully_received') then
    raise exception 'Purchase order % is %, so it cannot receive goods', order_row.reference, order_row.status
      using errcode = 'check_violation';
  end if;

  tolerance := coalesce(private.procurement_setting_numeric('excess_receipt_tolerance_percent'), 0);

  for line in
    select * from public.goods_receipt_items where goods_receipt_id = p_receipt_id order by line_number
  loop
    select s.outstanding_quantity into outstanding
      from public.purchase_order_receipt_status s
     where s.purchase_order_item_id = line.purchase_order_item_id;

    allowed := outstanding + (outstanding * tolerance / 100);

    if line.received_quantity > allowed then
      if not p_allow_excess then
        raise exception 'Line % would over-receive: % received against % outstanding. Authorise an excess delivery to continue.',
          line.line_number, line.received_quantity, outstanding
          using errcode = 'check_violation';
      end if;
      if not private.has_permission('procurement.goods_receipt.approve') then
        raise exception 'Authorising an excess delivery requires procurement.goods_receipt.approve'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    accepted_total := accepted_total + line.accepted_quantity;
    rejected_total := rejected_total + line.rejected_quantity;
    quarantined_total := quarantined_total + line.quarantined_quantity;
  end loop;

  new_reference := private.next_procurement_reference('goods_receipt_posting');

  insert into public.goods_receipt_postings
    (goods_receipt_id, purchase_order_id, posting_reference, idempotency_key,
     accepted_total, rejected_total, quarantined_total, posted_by, posted_at)
  values
    (p_receipt_id, order_row.id, new_reference, p_idempotency_key,
     accepted_total, rejected_total, quarantined_total, auth.uid(), now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'goods_receipt_item_id', i.id,
           'purchase_order_item_id', i.purchase_order_item_id,
           'product_id', i.product_id,
           'unit_id', i.unit_id,
           'received_quantity', i.received_quantity,
           'accepted_quantity', i.accepted_quantity,
           'rejected_quantity', i.rejected_quantity,
           'quarantined_quantity', i.quarantined_quantity
         ) order by i.line_number), '[]'::jsonb)
    into items
    from public.goods_receipt_items i
   where i.goods_receipt_id = p_receipt_id;

  insert into public.procurement_integration_outbox
    (event_type, entity_type, entity_id, idempotency_key, payload, status)
  values
    ('procurement.goods_receipt.posted', 'goods_receipt', p_receipt_id,
     'grn-posted:' || p_receipt_id::text,
     jsonb_build_object(
       'event', 'procurement.goods_receipt.posted',
       'goods_receipt_id', p_receipt_id,
       'goods_receipt_reference', receipt.reference,
       'posting_reference', new_reference,
       'purchase_order_id', order_row.id,
       'purchase_order_reference', order_row.reference,
       'supplier_id', receipt.supplier_id,
       'warehouse_id', receipt.warehouse_id,
       'location_id', receipt.location_id,
       'receipt_date', receipt.receipt_date,
       'posted_at', now(),
       'currency_code', order_row.currency_code,
       'items', items
     ),
     'pending')
  returning id into event_id;

  update public.goods_receipts
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         posting_reference = new_reference,
         updated_by = auth.uid()
   where id = p_receipt_id;

  -- Derive the order status from the receipts that now exist. `fully_received` is only reached when
  -- every line is complete; the status guard declares these edges.
  select exists (select 1 from public.purchase_order_receipt_status
                  where purchase_order_id = order_row.id and outstanding_quantity > 0)
    into any_outstanding;
  select exists (select 1 from public.purchase_order_receipt_status
                  where purchase_order_id = order_row.id and received_quantity > 0)
    into any_received;

  if not any_outstanding then
    update public.purchase_orders set status = 'fully_received', updated_by = auth.uid()
     where id = order_row.id and status <> 'fully_received';
  elsif any_received then
    update public.purchase_orders set status = 'partially_received', updated_by = auth.uid()
     where id = order_row.id and status = 'issued';
  end if;

  return query select new_reference, false, event_id;
end;
$$;

comment on function public.post_goods_receipt(uuid, text, boolean) is
  'Atomic, idempotent goods receipt posting. Locks the receipt and its purchase order, refuses over-receipt, writes the posting row and the inventory outbox event.';

revoke all on function public.post_goods_receipt(uuid, text, boolean) from public;
grant execute on function public.post_goods_receipt(uuid, text, boolean) to authenticated;

-- A posting reference needs its own counter; add it after the numbering table exists.
insert into public.procurement_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values ('goods_receipt_posting', 'PA-PST', 6, true, true, 'Goods receipt posting references')
on conflict (entity) do nothing;

-- ---------------------------------------------------------------------------
-- Receipt-derived quantities (views, never stored)
-- ---------------------------------------------------------------------------

create or replace view public.purchase_order_receipt_status
with (security_invoker = true)
as
select
  i.id as purchase_order_item_id,
  i.purchase_order_id,
  i.product_id,
  i.quantity as ordered_quantity,
  coalesce(sum(gi.received_quantity) filter (where gr.status = 'posted'), 0)::numeric(20, 6) as received_quantity,
  coalesce(sum(gi.accepted_quantity) filter (where gr.status = 'posted'), 0)::numeric(20, 6) as accepted_quantity,
  coalesce(sum(gi.rejected_quantity) filter (where gr.status = 'posted'), 0)::numeric(20, 6) as rejected_quantity,
  coalesce(sum(gi.quarantined_quantity) filter (where gr.status = 'posted'), 0)::numeric(20, 6) as quarantined_quantity,
  greatest(
    i.quantity - coalesce(sum(gi.received_quantity) filter (where gr.status = 'posted'), 0),
    0
  )::numeric(20, 6) as outstanding_quantity
from public.purchase_order_items i
left join public.goods_receipt_items gi on gi.purchase_order_item_id = i.id
left join public.goods_receipts gr on gr.id = gi.goods_receipt_id
group by i.id;

create or replace view public.purchase_order_summary
with (security_invoker = true)
as
select
  po.id as purchase_order_id,
  po.reference,
  po.supplier_id,
  po.supplier_name_snapshot,
  po.status,
  po.currency_code,
  po.total_amount,
  po.order_date,
  po.expected_delivery_date,
  po.issued_at,
  po.department_id,
  count(i.id)::int as line_count,
  coalesce(sum(s.ordered_quantity), 0)::numeric(20, 6) as ordered_quantity,
  coalesce(sum(s.received_quantity), 0)::numeric(20, 6) as received_quantity,
  coalesce(sum(s.outstanding_quantity), 0)::numeric(20, 6) as outstanding_quantity,
  coalesce(sum(s.rejected_quantity), 0)::numeric(20, 6) as rejected_quantity,
  coalesce(sum(s.quarantined_quantity), 0)::numeric(20, 6) as quarantined_quantity,
  case
    when po.status in ('issued', 'partially_received')
         and po.expected_delivery_date is not null
         and po.expected_delivery_date < current_date
    then true else false
  end as is_overdue
from public.purchase_orders po
left join public.purchase_order_items i on i.purchase_order_id = po.id
left join public.purchase_order_receipt_status s on s.purchase_order_item_id = i.id
group by po.id;

comment on view public.purchase_order_summary is
  'Order-level received/outstanding arithmetic plus an overdue flag derived from dates. Nothing here is stored.';
