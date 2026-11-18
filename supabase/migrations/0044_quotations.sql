-- 0044 — supplier quotations and comparison
--
-- Several suppliers quote against the same requirement. Nothing here ranks by price: the platform
-- records offers, presents their commercial differences, and stores a human decision with its
-- justification. The lowest price is never applied automatically, and the selection records the
-- exact numbers that were on screen when the decision was taken.

insert into public.procurement_numbering (entity, prefix, padding, include_year, reset_yearly, description)
values ('supplier_quotation_request', 'PA-RFQ', 5, true, true, 'Supplier quotation requests')
on conflict (entity) do nothing;

create table if not exists public.supplier_quotation_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  requisition_id uuid references public.purchase_requisitions (id) on delete set null on update cascade,
  requested_by uuid references public.profiles (id) on delete set null on update cascade,
  request_date date not null default current_date,
  response_due_date date,
  scope_description text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_quotation_requests_reference_unique unique (reference),
  constraint supplier_quotation_requests_scope_present check (length(btrim(scope_description)) >= 3),
  constraint supplier_quotation_requests_due_after_request
    check (response_due_date is null or response_due_date >= request_date)
);

comment on table public.supplier_quotation_requests is
  'A request for quotation. A quotation may also be recorded without one (verbal or email sourcing), which is why the link is optional.';

create table if not exists public.supplier_quotation_requests_suppliers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.supplier_quotation_requests (id) on delete cascade on update cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint supplier_quotation_requests_suppliers_unique unique (request_id, supplier_id)
);

create table if not exists public.supplier_quotations (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  supplier_quotation_reference text,
  supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  quotation_request_id uuid references public.supplier_quotation_requests (id) on delete set null on update cascade,
  requisition_id uuid references public.purchase_requisitions (id) on delete set null on update cascade,
  quotation_date date not null default current_date,
  valid_until date,
  currency_code text not null default 'NGN',
  status text not null default 'draft',
  status_reason text,
  -- Commercial terms are snapshotted as text next to the foreign key: a payment term edited in
  -- master data next year must not silently restate what a supplier offered.
  payment_terms_id uuid references public.payment_terms (id) on delete set null on update cascade,
  payment_terms_snapshot text,
  delivery_terms_id uuid references public.delivery_terms (id) on delete set null on update cascade,
  delivery_terms_snapshot text,
  delivery_lead_time_days int,
  proposed_delivery_date date,
  discount_amount numeric(18, 2) not null default 0,
  delivery_charges numeric(18, 2) not null default 0,
  other_charges numeric(18, 2) not null default 0,
  charge_notes text,
  subtotal numeric(20, 2) not null default 0,
  total_amount numeric(20, 2) not null default 0,
  remarks text,
  recorded_by uuid references public.profiles (id) on delete set null on update cascade,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_quotations_reference_unique unique (reference),
  constraint supplier_quotations_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint supplier_quotations_status_check
    check (status in ('draft', 'received', 'under_evaluation', 'selected', 'not_selected',
                      'expired', 'withdrawn', 'rejected')),
  constraint supplier_quotations_validity_after_date
    check (valid_until is null or valid_until >= quotation_date),
  constraint supplier_quotations_lead_time_non_negative
    check (delivery_lead_time_days is null or delivery_lead_time_days >= 0),
  constraint supplier_quotations_charges_non_negative
    check (discount_amount >= 0 and delivery_charges >= 0 and other_charges >= 0),
  constraint supplier_quotations_totals_non_negative check (subtotal >= 0 and total_amount >= 0),
  constraint supplier_quotations_reason_when_terminal
    check (status not in ('rejected', 'withdrawn', 'not_selected') or status_reason is not null)
);

create index if not exists supplier_quotations_supplier_idx
  on public.supplier_quotations (supplier_id, quotation_date desc);
create index if not exists supplier_quotations_requisition_idx
  on public.supplier_quotations (requisition_id);
create index if not exists supplier_quotations_status_idx
  on public.supplier_quotations (status, valid_until);

comment on table public.supplier_quotations is
  'Recorded supplier offers. Totals are recalculated by trigger from the lines and disclosed charges.';

create table if not exists public.supplier_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.supplier_quotations (id) on delete cascade on update cascade,
  line_number int not null,
  product_id uuid not null references public.products (id) on delete restrict on update cascade,
  product_description text not null,
  quantity numeric(20, 6) not null,
  unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  unit_price numeric(18, 4) not null,
  discount_amount numeric(18, 2) not null default 0,
  line_total numeric(20, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_quotation_items_line_positive check (line_number > 0),
  constraint supplier_quotation_items_quantity_positive check (quantity > 0),
  constraint supplier_quotation_items_price_non_negative check (unit_price >= 0),
  constraint supplier_quotation_items_discount_non_negative check (discount_amount >= 0),
  constraint supplier_quotation_items_line_unique unique (quotation_id, line_number)
);

create index if not exists supplier_quotation_items_quotation_idx
  on public.supplier_quotation_items (quotation_id, line_number);

/**
 * Recomputes one line and then the quotation totals from first principles.
 *
 * `round(quantity * unit_price, 2)` is computed in NUMERIC by PostgreSQL: no JavaScript float ever
 * touches an amount. The line total is stored as well as computed so a posted document keeps the
 * exact value it was assessed on.
 */
create or replace function private.recalculate_quotation_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := coalesce(new.quotation_id, old.quotation_id);
  lines_total numeric(20, 2);
  q public.supplier_quotations;
begin
  if tg_table_name = 'supplier_quotation_items' and tg_op <> 'DELETE' then
    new.line_total := round(new.quantity * new.unit_price, 2) - new.discount_amount;
    if new.line_total < 0 then
      raise exception 'A line discount cannot exceed the line value'
        using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(sum(line_total), 0) into lines_total
    from public.supplier_quotation_items
   where quotation_id = target;

  select * into q from public.supplier_quotations where id = target;
  if q.id is null then
    return coalesce(new, old);
  end if;

  update public.supplier_quotations
     set subtotal = lines_total,
         total_amount = greatest(lines_total - discount_amount + delivery_charges + other_charges, 0)
   where id = target;

  if tg_table_name = 'supplier_quotation_items' and tg_op <> 'DELETE' then
    return new;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists supplier_quotation_items_totals on public.supplier_quotation_items;
create trigger supplier_quotation_items_totals
  before insert or update on public.supplier_quotation_items
  for each row execute function private.recalculate_quotation_totals();

drop trigger if exists supplier_quotation_items_totals_after on public.supplier_quotation_items;
create trigger supplier_quotation_items_totals_after
  after insert or update or delete on public.supplier_quotation_items
  for each row execute function private.recalculate_quotation_totals();

drop trigger if exists supplier_quotations_totals on public.supplier_quotations;
create trigger supplier_quotations_totals
  before update of discount_amount, delivery_charges, other_charges on public.supplier_quotations
  for each row execute function private.recalculate_quotation_totals();

drop trigger if exists supplier_quotation_items_set_updated_at on public.supplier_quotation_items;
create trigger supplier_quotation_items_set_updated_at
  before update on public.supplier_quotation_items
  for each row execute function private.set_updated_at();

select private.install_procurement_triggers('public.supplier_quotations', 'supplier_quotation', 'reference');

/** Lines are frozen once the quotation has been evaluated or decided. */
create or replace function private.guard_quotation_item_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status text;
begin
  select status into parent_status
    from public.supplier_quotations
   where id = coalesce(new.quotation_id, old.quotation_id);

  if parent_status in ('selected', 'not_selected', 'expired', 'withdrawn', 'rejected') then
    raise exception 'Lines of a % quotation cannot be changed', parent_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists supplier_quotation_items_write_guard on public.supplier_quotation_items;
create trigger supplier_quotation_items_write_guard
  before insert or update or delete on public.supplier_quotation_items
  for each row execute function private.guard_quotation_item_write();

-- ---------------------------------------------------------------------------
-- Comparison
-- ---------------------------------------------------------------------------

create table if not exists public.supplier_quotation_comparisons (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid references public.purchase_requisitions (id) on delete set null on update cascade,
  title text not null,
  currency_note text,
  comparison_date date not null default current_date,
  -- Currency is not converted here: comparing offers in different currencies needs an explicit
  -- rate decision, so the basis is recorded as text ("all offers NGN", "converted at 2026-11-17
  -- official rate") instead of being silently computed.
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint supplier_quotation_comparisons_title_present check (length(btrim(title)) >= 3)
);

create table if not exists public.supplier_quotation_comparison_quotes (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.supplier_quotation_comparisons (id) on delete cascade on update cascade,
  quotation_id uuid not null references public.supplier_quotations (id) on delete cascade on update cascade,
  -- Snapshot of the offer at the moment it entered the comparison, so a later edit to the
  -- quotation cannot retroactively change what was compared.
  total_at_comparison numeric(20, 2) not null,
  currency_code text not null,
  lead_time_days_at_comparison int,
  validity_at_comparison date,
  created_at timestamptz not null default now(),
  constraint supplier_quotation_comparison_quotes_unique unique (comparison_id, quotation_id),
  constraint supplier_quotation_comparison_quotes_currency_format check (currency_code ~ '^[A-Z]{3}$')
);

create table if not exists public.supplier_quotation_selections (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.supplier_quotation_comparisons (id) on delete restrict on update cascade,
  selected_quotation_id uuid not null references public.supplier_quotations (id) on delete restrict on update cascade,
  selected_supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  requisition_id uuid references public.purchase_requisitions (id) on delete set null on update cascade,
  justification text not null,
  lowest_price_quotation_id uuid references public.supplier_quotations (id) on delete set null on update cascade,
  -- Explicit, so a reviewer can see at a glance that a higher offer was chosen and why.
  selected_was_lowest boolean,
  evidence jsonb,
  decided_by uuid references public.profiles (id) on delete set null on update cascade,
  decided_employee_id uuid references public.employees (id) on delete set null on update cascade,
  decided_at timestamptz not null default now(),
  constraint supplier_quotation_selections_justification_present
    check (length(btrim(justification)) >= 10),
  constraint supplier_quotation_selections_one_per_comparison unique (comparison_id)
);

create index if not exists supplier_quotation_selections_requisition_idx
  on public.supplier_quotation_selections (requisition_id);

comment on table public.supplier_quotation_selections is
  'The recorded sourcing decision. Never derived from price: the justification and the compared evidence are mandatory.';

/**
 * Validates a selection against its comparison: the quotation must have been part of the
 * comparison, its supplier must match, and a justification is required whenever policy says so.
 */
create or replace function private.validate_quotation_selection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  competitor record;
  lowest numeric(20, 2);
begin
  if not exists (
    select 1
      from public.supplier_quotation_comparison_quotes q
     where q.comparison_id = new.comparison_id
       and q.quotation_id = new.selected_quotation_id
  ) then
    raise exception 'The selected quotation is not part of this comparison'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.supplier_quotations sq
     where sq.id = new.selected_quotation_id
       and sq.supplier_id = new.selected_supplier_id
  ) then
    raise exception 'The selected supplier does not match the selected quotation'
      using errcode = 'check_violation';
  end if;

  if private.procurement_setting_boolean('quotation_selection_requires_justification')
     and length(btrim(new.justification)) < 10 then
    raise exception 'A justification of at least 10 characters is required to select a supplier'
      using errcode = 'check_violation';
  end if;

  select min(total_at_comparison), min(total_at_comparison)
    into lowest, lowest
    from public.supplier_quotation_comparison_quotes
   where comparison_id = new.comparison_id
     and currency_code = (select currency_code from public.supplier_quotation_comparison_quotes
                           where comparison_id = new.comparison_id
                             and quotation_id = new.selected_quotation_id);

  select * into competitor
    from public.supplier_quotation_comparison_quotes
   where comparison_id = new.comparison_id
   order by total_at_comparison asc
   limit 1;

  new.lowest_price_quotation_id := coalesce(new.lowest_price_quotation_id, competitor.quotation_id);
  new.selected_was_lowest := (new.selected_quotation_id = competitor.quotation_id);
  return new;
end;
$$;

drop trigger if exists supplier_quotation_selections_validate on public.supplier_quotation_selections;
create trigger supplier_quotation_selections_validate
  before insert on public.supplier_quotation_selections
  for each row execute function private.validate_quotation_selection();

-- ---------------------------------------------------------------------------
-- Comparison view
-- ---------------------------------------------------------------------------

create or replace view public.supplier_quotation_comparison_view
with (security_invoker = true)
as
select
  cq.comparison_id,
  cq.quotation_id,
  q.reference as quotation_reference,
  q.supplier_id,
  s.legal_name as supplier_name,
  s.status as supplier_status,
  s.verification_status,
  cq.total_at_comparison,
  cq.currency_code,
  cq.lead_time_days_at_comparison,
  cq.validity_at_comparison,
  q.payment_terms_snapshot,
  q.delivery_terms_snapshot,
  q.status as quotation_status,
  (cq.total_at_comparison = min(cq.total_at_comparison) over (partition by cq.comparison_id, cq.currency_code))
    as is_lowest_price
from public.supplier_quotation_comparison_quotes cq
join public.supplier_quotations q on q.id = cq.quotation_id
join public.suppliers s on s.id = q.supplier_id;

comment on view public.supplier_quotation_comparison_view is
  'Commercial comparison of offers. is_lowest_price is evidence for a reviewer, not a selection rule.';
