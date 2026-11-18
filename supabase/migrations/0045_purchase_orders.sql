-- 0045 — purchase orders, versions and amendments
--
-- A purchase order is the first document that commits Pluck Agro to spend money with a supplier, so
-- the schema makes three things hard:
--   * approval and issue are distinct states, and only an issued order may be received against;
--   * the approved document is immutable — a change is a versioned amendment, never an overwrite;
--   * every commercial value that a master record could later change is snapshotted on the order.
--
-- Received quantities are *derived* from posted goods receipts (see the views at the end). They are
-- not stored on the order, so they cannot disagree with the receipts that justify them.

insert into public.procurement_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values ('purchase_order_version', 'PA-POV', 3, false, false, 'Issued purchase order versions')
on conflict (entity) do nothing;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  -- Snapshot of the supplier name at the time of ordering: a later legal-name correction must not
  -- restate a document the supplier already holds.
  supplier_name_snapshot text not null,
  selected_quotation_id uuid references public.supplier_quotations (id) on delete set null on update cascade,
  selection_id uuid references public.supplier_quotation_selections (id) on delete set null on update cascade,
  order_date date not null default current_date,
  expected_delivery_date date,
  currency_code text not null default 'NGN',
  -- Exchange-rate snapshot (spec §4.4). The rate id, the rate itself and its type are all stored,
  -- so a later correction to today's rate never rewrites an issued order's basis.
  exchange_rate numeric(24, 10),
  exchange_rate_id uuid references public.exchange_rates (id) on delete set null on update cascade,
  exchange_rate_type text,
  exchange_rate_date date,
  base_currency_code text,
  payment_terms_id uuid references public.payment_terms (id) on delete set null on update cascade,
  payment_terms_snapshot text,
  delivery_terms_id uuid references public.delivery_terms (id) on delete set null on update cascade,
  delivery_terms_snapshot text,
  delivery_warehouse_id uuid references public.warehouses (id) on delete set null on update cascade,
  delivery_location_id uuid references public.warehouse_locations (id) on delete set null on update cascade,
  delivery_address text,
  procurement_officer_employee_id uuid references public.employees (id) on delete set null on update cascade,
  department_id uuid references public.departments (id) on delete set null on update cascade,
  status text not null default 'draft',
  status_reason text,
  subtotal numeric(20, 2) not null default 0,
  discount_total numeric(20, 2) not null default 0,
  charges_total numeric(20, 2) not null default 0,
  tax_total numeric(20, 2) not null default 0,
  total_amount numeric(20, 2) not null default 0,
  internal_remarks text,
  supplier_instructions text,
  version int not null default 1,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  issued_at timestamptz,
  issued_by uuid references public.profiles (id) on delete set null on update cascade,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null on update cascade,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null on update cascade,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_reference_unique unique (reference),
  constraint purchase_orders_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,19}-[0-9]{3,12}$'),
  constraint purchase_orders_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint purchase_orders_base_currency_format
    check (base_currency_code is null or base_currency_code ~ '^[A-Z]{3}$'),
  constraint purchase_orders_exchange_rate_positive
    check (exchange_rate is null or exchange_rate > 0),
  constraint purchase_orders_version_positive check (version > 0),
  constraint purchase_orders_status_check
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'issued',
                      'partially_received', 'fully_received', 'amendment_pending', 'closed',
                      'cancelled')),
  constraint purchase_orders_amounts_non_negative
    check (subtotal >= 0 and discount_total >= 0 and charges_total >= 0 and tax_total >= 0
           and total_amount >= 0),
  constraint purchase_orders_issue_stamped
    check (status not in ('issued', 'partially_received', 'fully_received', 'closed')
           or (issued_at is not null and issued_by is not null)),
  constraint purchase_orders_cancel_stamped
    check (status <> 'cancelled' or (cancelled_at is not null and status_reason is not null)),
  constraint purchase_orders_delivery_date_after_order
    check (expected_delivery_date is null or expected_delivery_date >= order_date)
);

create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id, status);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status, expected_delivery_date);
create index if not exists purchase_orders_department_idx on public.purchase_orders (department_id);
create index if not exists purchase_orders_date_idx on public.purchase_orders (order_date desc);

comment on table public.purchase_orders is
  'Committed supplier orders. An approved version is immutable; changes go through purchase_order_amendments.';

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade on update cascade,
  line_number int not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  -- Snapshots (spec §4.4): description, unit code and tax reference as they were on this order.
  product_code_snapshot text not null,
  product_description text not null,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  unit_code_snapshot text not null,
  quantity numeric(20, 6) not null,
  unit_price numeric(18, 4) not null,
  discount_amount numeric(18, 2) not null default 0,
  additional_charges numeric(18, 2) not null default 0,
  tax_category_id uuid references public.tax_categories (id) on delete set null on update cascade,
  tax_amount numeric(18, 2) not null default 0,
  line_total numeric(20, 2) not null default 0,
  requisition_item_id uuid references public.purchase_requisition_items (id) on delete set null on update cascade,
  specification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_items_line_positive check (line_number > 0),
  constraint purchase_order_items_quantity_positive check (quantity > 0),
  constraint purchase_order_items_price_non_negative check (unit_price >= 0),
  constraint purchase_order_items_discount_non_negative
    check (discount_amount >= 0 and additional_charges >= 0 and tax_amount >= 0),
  constraint purchase_order_items_line_unique unique (purchase_order_id, line_number)
);

create index if not exists purchase_order_items_po_idx
  on public.purchase_order_items (purchase_order_id, line_number);
create index if not exists purchase_order_items_product_idx on public.purchase_order_items (product_id);

comment on table public.purchase_order_items is
  'Ordered lines with frozen product, unit and tax snapshots. line_total = round(qty * price, 2) - discount + charges + tax.';

-- The requisition allocation table was created in 0043 without this key because the purchase-order
-- line did not exist yet. Adding it here completes the traceability chain.
alter table public.purchase_requisition_allocations
  drop constraint if exists purchase_requisition_allocations_purchase_order_item_fkey;
alter table public.purchase_requisition_allocations
  add constraint purchase_requisition_allocations_purchase_order_item_fkey
    foreign key (purchase_order_item_id) references public.purchase_order_items (id)
    on delete cascade on update cascade;

create table if not exists public.purchase_order_requisition_links (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade on update cascade,
  requisition_id uuid not null references public.purchase_requisitions (id) on delete restrict on update cascade,
  created_at timestamptz not null default now(),
  constraint purchase_order_requisition_links_unique unique (purchase_order_id, requisition_id)
);

comment on table public.purchase_order_requisition_links is
  'Which requisitions an order serves. A requisition may be split over several orders and an order may consolidate several requisitions.';

create table if not exists public.purchase_order_versions (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade on update cascade,
  version int not null,
  reference text not null,
  status_at_snapshot text not null,
  total_amount numeric(20, 2) not null,
  currency_code text not null,
  snapshot jsonb not null,
  reason text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint purchase_order_versions_unique unique (purchase_order_id, version),
  constraint purchase_order_versions_version_positive check (version > 0)
);

comment on table public.purchase_order_versions is
  'Immutable snapshot of the order at each issue. The current version is the highest version number.';

create or replace function private.block_purchase_order_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Purchase order versions are immutable' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists purchase_order_versions_immutable on public.purchase_order_versions;
create trigger purchase_order_versions_immutable
  before update or delete on public.purchase_order_versions
  for each row execute function private.block_purchase_order_version_mutation();

-- ---------------------------------------------------------------------------
-- Amendments
-- ---------------------------------------------------------------------------

create table if not exists public.purchase_order_amendments (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade on update cascade,
  status text not null default 'draft',
  status_reason text,
  reason text not null,
  requested_by uuid references public.profiles (id) on delete set null on update cascade,
  requested_employee_id uuid references public.employees (id) on delete set null on update cascade,
  requested_at timestamptz not null default now(),
  base_version int not null,
  resulting_version int,
  previous_total numeric(20, 2),
  new_total numeric(20, 2),
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_amendments_reference_unique unique (reference),
  constraint purchase_order_amendments_reason_present check (length(btrim(reason)) >= 10),
  constraint purchase_order_amendments_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'applied', 'cancelled')),
  constraint purchase_order_amendments_base_version_positive check (base_version > 0)
);

create index if not exists purchase_order_amendments_po_idx
  on public.purchase_order_amendments (purchase_order_id, requested_at desc);

create table if not exists public.purchase_order_amendment_items (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.purchase_order_amendments (id) on delete cascade on update cascade,
  purchase_order_item_id uuid references public.purchase_order_items (id) on delete cascade on update cascade,
  change_type text not null,
  field_name text,
  previous_value text,
  new_value text,
  product_id uuid references public.products (id) on delete restrict on update cascade,
  quantity numeric(20, 6),
  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  unit_price numeric(18, 4),
  created_at timestamptz not null default now(),
  constraint purchase_order_amendment_items_type_check
    check (change_type in ('quantity', 'unit_price', 'product', 'add_line', 'remove_line',
                           'delivery_date', 'payment_terms', 'delivery_terms',
                           'destination', 'other')),
  constraint purchase_order_amendment_items_quantity_positive
    check (quantity is null or quantity > 0),
  constraint purchase_order_amendment_items_price_non_negative
    check (unit_price is null or unit_price >= 0)
);

create index if not exists purchase_order_amendment_items_idx
  on public.purchase_order_amendment_items (amendment_id);

select private.install_procurement_triggers('public.purchase_order_amendments', 'purchase_order_amendment', 'reference');

-- ---------------------------------------------------------------------------
-- Supplier eligibility exceptions
-- ---------------------------------------------------------------------------
-- Rule: an unverified, blocked or inactive supplier may not be used for new procurement unless an
-- authorised exception exists. The exception is an explicit, expiring, justified record — not a
-- checkbox — and the reason a blocked supplier is used is then auditable.

create table if not exists public.procurement_supplier_exceptions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  scope text not null default 'purchase_order',
  justification text not null,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_employee_id uuid references public.employees (id) on delete set null on update cascade,
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint procurement_supplier_exceptions_scope_check
    check (scope in ('purchase_order', 'quotation', 'advance')),
  constraint procurement_supplier_exceptions_justification_present
    check (length(btrim(justification)) >= 10)
);

create index if not exists procurement_supplier_exceptions_supplier_idx
  on public.procurement_supplier_exceptions (supplier_id, scope, is_active);

/** True when an active, unexpired exception exists for this supplier and scope. */
create or replace function private.supplier_exception_active(p_supplier_id uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.procurement_supplier_exceptions e
     where e.supplier_id = p_supplier_id
       and e.scope = p_scope
       and e.is_active
       and (e.expires_at is null or e.expires_at > now())
  );
$$;

revoke all on function private.supplier_exception_active(uuid, text) from public;

/** Refuses a purchase order for a supplier that is not active and verified, without an exception. */
create or replace function private.guard_supplier_procurable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  supplier record;
begin
  select id, status, verification_status, legal_name into supplier
    from public.suppliers where id = new.supplier_id;

  if supplier.id is null then
    raise exception 'The selected supplier no longer exists' using errcode = 'check_violation';
  end if;

  if supplier.status <> 'active' or supplier.verification_status <> 'verified' then
    if not private.supplier_exception_active(new.supplier_id, 'purchase_order') then
      raise exception 'Supplier % is % with verification %, so it cannot be ordered from. Record an authorised procurement exception first.',
        supplier.legal_name, supplier.status, supplier.verification_status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_orders_supplier_guard on public.purchase_orders;
create trigger purchase_orders_supplier_guard
  before insert or update of supplier_id on public.purchase_orders
  for each row execute function private.guard_supplier_procurable();

-- ---------------------------------------------------------------------------
-- Purchase order guards
-- ---------------------------------------------------------------------------

/** Statuses in which an order's content is frozen. */
create or replace function private.purchase_order_is_locked(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('submitted', 'under_review', 'approved', 'issued', 'partially_received',
                      'fully_received', 'amendment_pending', 'closed', 'cancelled');
$$;

/**
 * Refuses content edits to an order that has left draft.
 *
 * Receipt-derived status moves and workflow stamps remain writable, because the lifecycle must be
 * able to advance; the commercial content does not. A change goes through an amendment, which
 * creates a new version and leaves the approved one in purchase_order_versions.
 */
create or replace function private.guard_purchase_order_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mutable text[] := array['status', 'status_reason', 'version', 'submitted_at', 'submitted_by',
                          'approved_at', 'approved_by', 'issued_at', 'issued_by', 'closed_at',
                          'closed_by', 'cancelled_at', 'cancelled_by', 'updated_at', 'updated_by'];
  changed text[];
begin
  if not private.purchase_order_is_locked(old.status) then
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('draft') then
    return new;
  end if;
  -- Only public.apply_purchase_order_amendment() sets this flag, and it performs its own
  -- validations (base version, approval, received-quantity impact) before writing.
  if coalesce(current_setting('pluck.amendment_applied', true), 'off') = 'on' then
    return new;
  end if;

  select coalesce(array_agg(key order by key), array[]::text[])
    into changed
    from jsonb_each(to_jsonb(new)) as e(key, value)
   where (to_jsonb(old) -> key) is distinct from value
     and key <> all (mutable);

  if array_length(changed, 1) > 0 then
    raise exception 'Purchase order % is % and cannot be edited (attempted: %). Raise an amendment instead.',
      old.reference, old.status, array_to_string(changed, ', ')
      using errcode = 'check_violation';
  end if;

  -- Read-only values may only change as part of an explicitly applied amendment.
  if new.total_amount is distinct from old.total_amount
     and coalesce(current_setting('pluck.amendment_applied', true), 'off') <> 'on' then
    raise exception 'The total of purchase order % can only change through an applied amendment', old.reference
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_orders_edit_guard on public.purchase_orders;
create trigger purchase_orders_edit_guard
  before update on public.purchase_orders
  for each row execute function private.guard_purchase_order_edit();

/** Lines may only be written while the parent order is editable. */
create or replace function private.guard_purchase_order_item_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  amendment_mode boolean := coalesce(current_setting('pluck.amendment_applied', true), 'off') = 'on';
begin
  select status into parent_status
    from public.purchase_orders
   where id = coalesce(new.purchase_order_id, old.purchase_order_id);

  if parent_status is null or amendment_mode then
    return coalesce(new, old);
  end if;

  if private.purchase_order_is_locked(parent_status) then
    raise exception 'Purchase order lines cannot be changed while the order is %', parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists purchase_order_items_write_guard on public.purchase_order_items;
create trigger purchase_order_items_write_guard
  before insert or update or delete on public.purchase_order_items
  for each row execute function private.guard_purchase_order_item_write();

/**
 * Recomputes line totals and the order totals from the lines.
 *
 * In amendment mode the order is already locked, so the header totals must still be allowed to
 * move; that is exactly why the totals are recalculated here from the lines rather than accepted
 * from the caller.
 */
create or replace function private.recalculate_purchase_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
  sums record;
begin
  if tg_table_name = 'purchase_order_items' and tg_op <> 'DELETE' then
    new.line_total := round(new.quantity * new.unit_price, 2)
                      - new.discount_amount + new.additional_charges + new.tax_amount;
    if new.line_total < 0 then
      raise exception 'A line discount cannot exceed the line value of the purchase order line'
        using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(sum(round(quantity * unit_price, 2)), 0) as goods,
         coalesce(sum(discount_amount), 0) as discounts,
         coalesce(sum(additional_charges), 0) as charges,
         coalesce(sum(tax_amount), 0) as taxes,
         coalesce(sum(line_total), 0) as total
    into sums
    from public.purchase_order_items
   where purchase_order_id = target;

  perform set_config('pluck.totals_recalculation', 'on', true);

  update public.purchase_orders
     set subtotal = sums.goods,
         discount_total = sums.discounts,
         charges_total = sums.charges,
         tax_total = sums.taxes,
         total_amount = sums.total
   where id = target;

  perform set_config('pluck.totals_recalculation', 'off', true);

  if tg_table_name = 'purchase_order_items' and tg_op <> 'DELETE' then
    return new;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists purchase_order_items_totals on public.purchase_order_items;
create trigger purchase_order_items_totals
  before insert or update on public.purchase_order_items
  for each row execute function private.recalculate_purchase_order_totals();

drop trigger if exists purchase_order_items_totals_after on public.purchase_order_items;
create trigger purchase_order_items_totals_after
  after insert or update or delete on public.purchase_order_items
  for each row execute function private.recalculate_purchase_order_totals();

drop trigger if exists purchase_order_items_set_updated_at on public.purchase_order_items;
create trigger purchase_order_items_set_updated_at
  before update on public.purchase_order_items
  for each row execute function private.set_updated_at();

select private.install_procurement_triggers('public.purchase_orders', 'purchase_order', 'reference');

/** A submission needs at least one line and no line may reference an archived product. */
create or replace function private.validate_purchase_order_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  line_count int;
  stale_product text;
begin
  if new.status <> 'submitted' or old.status = 'submitted' then
    return new;
  end if;

  select count(*) into line_count from public.purchase_order_items where purchase_order_id = new.id;
  if line_count = 0 then
    raise exception 'A purchase order needs at least one line before it can be submitted'
      using errcode = 'check_violation';
  end if;

  select p.name into stale_product
    from public.purchase_order_items i
    join public.products p on p.id = i.product_id
   where i.purchase_order_id = new.id
     and p.status not in ('active')
   limit 1;

  if stale_product is not null then
    raise exception 'Product % is not active, so it cannot appear on a submitted purchase order', stale_product
      using errcode = 'check_violation';
  end if;

  new.submitted_at := coalesce(new.submitted_at, now());
  new.submitted_by := coalesce(new.submitted_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists purchase_orders_submission_guard on public.purchase_orders;
create trigger purchase_orders_submission_guard
  before update on public.purchase_orders
  for each row execute function private.validate_purchase_order_submission();

/**
 * Snapshots the order as an immutable version whenever the issued document changes.
 *
 * Two things trigger a snapshot: the moment the order is issued, and every later version bump (an
 * applied amendment). Both are needed — an amendment that changed the agreed quantity without
 * leaving a snapshot would make "what the supplier was told" unanswerable for the new version.
 *
 * The snapshot contains everything a printed order shows, so that question stays answerable years
 * later even if the master data behind it changed.
 */
create or replace function private.snapshot_purchase_order_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  doc jsonb;
  issuing boolean;
  new_version boolean;
begin
  issuing := new.status = 'issued' and old.status is distinct from 'issued';
  new_version := new.version is distinct from old.version;

  if not issuing and not new_version then
    return new;
  end if;

  if issuing then
    new.issued_at := coalesce(new.issued_at, now());
    new.issued_by := coalesce(new.issued_by, auth.uid());

    -- Issuing an order without recording who issued it would make the document unattributable
    -- forever, so the stamp is required rather than silently left null.
    if new.issued_by is null then
      raise exception 'Issuing a purchase order requires an authenticated user for attribution'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select jsonb_build_object(
           'header', to_jsonb(new),
           'lines', coalesce((
             select jsonb_agg(to_jsonb(i) order by i.line_number)
               from public.purchase_order_items i
              where i.purchase_order_id = new.id), '[]'::jsonb),
           'requisitions', coalesce((
             select jsonb_agg(jsonb_build_object('id', l.requisition_id, 'reference', r.reference))
               from public.purchase_order_requisition_links l
               join public.purchase_requisitions r on r.id = l.requisition_id
              where l.purchase_order_id = new.id), '[]'::jsonb)
         ) into doc;

  insert into public.purchase_order_versions
    (purchase_order_id, version, reference, status_at_snapshot, total_amount, currency_code, snapshot, reason, created_by)
  values
    (new.id, new.version, new.reference, new.status, new.total_amount, new.currency_code, doc,
     case when issuing then 'Issued version' else 'Version after amendment' end, auth.uid())
  on conflict (purchase_order_id, version) do nothing;

  return new;
end;
$$;

drop trigger if exists purchase_orders_snapshot_version on public.purchase_orders;
create trigger purchase_orders_snapshot_version
  before update on public.purchase_orders
  for each row execute function private.snapshot_purchase_order_version();

drop trigger if exists purchase_orders_amounts_recalc_guard on public.purchase_orders;
create trigger purchase_orders_amounts_recalc_guard
  before update of subtotal, total_amount, discount_total, charges_total, tax_total on public.purchase_orders
  for each row execute function private.guard_purchase_order_edit();

