-- 0043 — purchase requisitions
--
-- The requisition is the only procurement document an ordinary employee creates. It states a
-- need; it does not commit money. Everything downstream (quotation, purchase order, receipt)
-- references it by UUID, and the requested quantity is traced to the orders that consume it
-- through `purchase_requisition_allocations` (the foreign key to the purchase-order line is added
-- in 0045, once that table exists).
--
-- Quantities are NUMERIC(20,6) like every other quantity in the system. Estimated prices are
-- NUMERIC(18,4) and are explicitly labelled "estimate": a requisition total is never a commitment.

create table if not exists public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  requesting_employee_id uuid not null references public.employees (id) on delete restrict on update cascade,
  department_id uuid not null references public.departments (id) on delete restrict on update cascade,
  requisition_date date not null default current_date,
  required_delivery_date date not null,
  purpose text not null,
  justification text,
  priority text not null default 'normal',
  status text not null default 'draft',
  status_reason text,
  -- Commercial context. A preferred supplier is a preference, not a decision; the supplier is
  -- chosen on the quotation comparison.
  preferred_supplier_id uuid references public.suppliers (id) on delete set null on update cascade,
  suggested_warehouse_id uuid references public.warehouses (id) on delete set null on update cascade,
  suggested_location_id uuid references public.warehouse_locations (id) on delete set null on update cascade,
  currency_code text not null default 'NGN',
  estimated_total numeric(20, 2),
  notes text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null on update cascade,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_requisitions_reference_unique unique (reference),
  constraint purchase_requisitions_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,19}-[0-9]{3,12}$'),
  constraint purchase_requisitions_purpose_present check (length(btrim(purpose)) >= 3),
  constraint purchase_requisitions_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint purchase_requisitions_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint purchase_requisitions_status_check
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled',
                      'processing', 'partially_fulfilled', 'fulfilled')),
  constraint purchase_requisitions_dates_ordered
    check (required_delivery_date >= requisition_date),
  constraint purchase_requisitions_estimate_non_negative
    check (estimated_total is null or estimated_total >= 0),
  constraint purchase_requisitions_cancelled_stamped
    check (status <> 'cancelled' or (cancelled_at is not null and status_reason is not null))
);

create index if not exists purchase_requisitions_status_idx
  on public.purchase_requisitions (status, required_delivery_date);
create index if not exists purchase_requisitions_department_idx
  on public.purchase_requisitions (department_id, status);
create index if not exists purchase_requisitions_requester_idx
  on public.purchase_requisitions (requesting_employee_id, status);
create index if not exists purchase_requisitions_date_idx
  on public.purchase_requisitions (requisition_date desc);

comment on table public.purchase_requisitions is
  'Internal purchasing needs. Approving a requisition authorises sourcing; it commits nothing and creates no order.';

create table if not exists public.purchase_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions (id) on delete cascade on update cascade,
  line_number int not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  -- Snapshot of what was requested. A later product rename must not rewrite history.
  product_description text not null,
  quantity numeric(20, 6) not null,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  estimated_unit_price numeric(18, 4),
  specification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_requisition_items_line_positive check (line_number > 0),
  constraint purchase_requisition_items_quantity_positive check (quantity > 0),
  constraint purchase_requisition_items_price_non_negative
    check (estimated_unit_price is null or estimated_unit_price >= 0),
  constraint purchase_requisition_items_line_unique unique (requisition_id, line_number)
);

create index if not exists purchase_requisition_items_requisition_idx
  on public.purchase_requisition_items (requisition_id, line_number);
create index if not exists purchase_requisition_items_product_idx
  on public.purchase_requisition_items (product_id);

comment on table public.purchase_requisition_items is
  'Requested lines. product_description is a snapshot taken when the line is written.';

-- Allocations trace a requested quantity to the purchase-order lines that satisfy it. A
-- requisition may be split across several orders and an order may consolidate several
-- requisitions; without this table neither claim is verifiable.
create table if not exists public.purchase_requisition_allocations (
  id uuid primary key default gen_random_uuid(),
  requisition_item_id uuid not null references public.purchase_requisition_items (id) on delete cascade on update cascade,
  purchase_order_item_id uuid,
  allocated_quantity numeric(20, 6) not null,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint purchase_requisition_allocations_quantity_positive check (allocated_quantity > 0)
);

create index if not exists purchase_requisition_allocations_item_idx
  on public.purchase_requisition_allocations (requisition_item_id);
create index if not exists purchase_requisition_allocations_po_item_idx
  on public.purchase_requisition_allocations (purchase_order_item_id);

comment on table public.purchase_requisition_allocations is
  'Quantity traceability between requisition lines and purchase-order lines. The purchase_order_item_id foreign key is added in 0045.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

/** Statuses in which a requisition header and its lines are frozen. */
create or replace function private.requisition_is_locked(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('submitted', 'under_review', 'approved', 'rejected', 'cancelled',
                      'processing', 'partially_fulfilled', 'fulfilled');
$$;

/**
 * Refuses edits to a requisition that has left draft.
 *
 * Workflow columns stay writable because the lifecycle itself must move (the status guard decides
 * whether a move is legal). Everything a human could use to change the *content* of an approved
 * request is frozen, so "approved" means the approved text.
 */
create or replace function private.guard_requisition_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mutable text[] := array['status', 'status_reason', 'submitted_at', 'submitted_by',
                          'approved_at', 'approved_by', 'cancelled_at', 'cancelled_by',
                          'updated_at', 'updated_by', 'estimated_total'];
  changed text[];
begin
  if not private.requisition_is_locked(old.status) then
    return new;
  end if;
  -- Re-opening is itself a transition (rejected -> draft), declared in the transition table.
  if new.status is distinct from old.status and new.status in ('draft') then
    return new;
  end if;

  select coalesce(array_agg(key order by key), array[]::text[])
    into changed
    from jsonb_each(to_jsonb(new)) as e(key, value)
   where (to_jsonb(old) -> key) is distinct from value
     and key <> all (mutable);

  if array_length(changed, 1) > 0 then
    raise exception 'A requisition in status % cannot be edited (attempted: %). Reopen it first.',
      old.status, array_to_string(changed, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_requisitions_edit_guard on public.purchase_requisitions;
create trigger purchase_requisitions_edit_guard
  before update on public.purchase_requisitions
  for each row execute function private.guard_requisition_edit();

/** Lines may only be written while the parent requisition is editable. */
create or replace function private.guard_requisition_item_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  target_id uuid := coalesce(new.requisition_id, old.requisition_id);
begin
  select status into parent_status from public.purchase_requisitions where id = target_id;
  if parent_status is null then
    return coalesce(new, old);
  end if;
  if private.requisition_is_locked(parent_status) then
    raise exception 'Requisition lines cannot be changed while the requisition is %', parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists purchase_requisition_items_write_guard on public.purchase_requisition_items;
create trigger purchase_requisition_items_write_guard
  before insert or update or delete on public.purchase_requisition_items
  for each row execute function private.guard_requisition_item_write();

/**
 * A requisition may only be submitted when it has lines and its dates are coherent.
 * Checked at the transition rather than only in the form, because a submission also arrives from
 * the approval queue and from any future integration.
 */
create or replace function private.validate_requisition_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_count int;
begin
  if new.status <> 'submitted' or old.status = 'submitted' then
    return new;
  end if;

  select count(*) into item_count
    from public.purchase_requisition_items
   where requisition_id = new.id;

  if item_count = 0 then
    raise exception 'A requisition needs at least one line before it can be submitted'
      using errcode = 'check_violation';
  end if;

  if new.required_delivery_date < current_date then
    raise exception 'The required delivery date (%) has already passed', new.required_delivery_date
      using errcode = 'check_violation';
  end if;

  new.submitted_at := coalesce(new.submitted_at, now());
  new.submitted_by := coalesce(new.submitted_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists purchase_requisitions_submission_guard on public.purchase_requisitions;
create trigger purchase_requisitions_submission_guard
  before update on public.purchase_requisitions
  for each row execute function private.validate_requisition_submission();

/** Keeps the header estimate in step with the lines without trusting the browser. */
create or replace function private.recalculate_requisition_estimate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := coalesce(new.requisition_id, old.requisition_id);
  total numeric(20, 2);
begin
  select sum(round(quantity * coalesce(estimated_unit_price, 0), 2))
    into total
    from public.purchase_requisition_items
   where requisition_id = target;

  update public.purchase_requisitions
     set estimated_total = coalesce(total, 0)
   where id = target;

  return coalesce(new, old);
end;
$$;

drop trigger if exists purchase_requisition_items_estimate on public.purchase_requisition_items;
create trigger purchase_requisition_items_estimate
  after insert or update or delete on public.purchase_requisition_items
  for each row execute function private.recalculate_requisition_estimate();

drop trigger if exists purchase_requisition_items_set_updated_at on public.purchase_requisition_items;
create trigger purchase_requisition_items_set_updated_at
  before update on public.purchase_requisition_items
  for each row execute function private.set_updated_at();

select private.install_procurement_triggers('public.purchase_requisitions', 'purchase_requisition', 'reference');

-- ---------------------------------------------------------------------------
-- Requisition fulfilment view
-- ---------------------------------------------------------------------------
-- Derived, never stored: allocated / ordered / remaining quantities are computed from the lines
-- so they cannot drift from the allocation records that justify them.

create or replace view public.purchase_requisition_fulfilment
with (security_invoker = true)
as
select
  r.id as requisition_id,
  r.reference,
  r.status,
  r.department_id,
  r.requesting_employee_id,
  r.required_delivery_date,
  count(i.id)::int as line_count,
  coalesce(sum(i.quantity), 0)::numeric(20, 6) as requested_quantity,
  coalesce(sum(a.allocated_quantity), 0)::numeric(20, 6) as allocated_quantity,
  (coalesce(sum(i.quantity), 0) - coalesce(sum(a.allocated_quantity), 0))::numeric(20, 6)
    as outstanding_quantity
from public.purchase_requisitions r
left join public.purchase_requisition_items i on i.requisition_id = r.id
left join public.purchase_requisition_allocations a on a.requisition_item_id = i.id
group by r.id;

comment on view public.purchase_requisition_fulfilment is
  'Per-requisition fulfilment arithmetic, computed from lines and allocations. Never stored, so it cannot drift.';
