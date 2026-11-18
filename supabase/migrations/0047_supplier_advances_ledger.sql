-- 0047 — supplier advances, ledger and reconciliation
--
-- Money leaves Pluck Agro here, so two boundaries are held firmly:
--   * an advance is not an expense and not a settlement of a payable. It is a recorded
--     disbursement to a supplier that will later be applied against invoices — by Finance.
--   * a purchase order total is a commitment, never an accounts-payable balance. The ledger below
--     reports ordered value, received value, invoiced value, paid value and advance balance
--     separately and never adds them into one "payable" figure.
--
-- Cash confirmation belongs to Treasury. Until that integration exists an advance stops at
-- `payment_pending` unless a user with the permission records the treasury reference, and the row
-- records who confirmed it and when.

create table if not exists public.supplier_advances (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  supplier_name_snapshot text not null,
  advance_reference text,
  transaction_date date not null default current_date,
  amount numeric(20, 2) not null,
  currency_code text not null default 'NGN',
  exchange_rate numeric(24, 10),
  exchange_rate_id uuid references public.exchange_rates (id) on delete set null on update cascade,
  base_currency_code text,
  amount_base numeric(20, 2),
  payment_method text not null default 'bank_transfer',
  purchase_order_id uuid references public.purchase_orders (id) on delete set null on update cascade,
  purchase_requisition_id uuid references public.purchase_requisitions (id) on delete set null on update cascade,
  purpose text,
  status text not null default 'draft',
  status_reason text,
  outstanding_amount numeric(20, 2) not null default 0,
  requested_by uuid references public.profiles (id) on delete set null on update cascade,
  requested_employee_id uuid references public.employees (id) on delete set null on update cascade,
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null on update cascade,
  approved_at timestamptz,
  treasury_confirmed_by uuid references public.profiles (id) on delete set null on update cascade,
  treasury_confirmed_at timestamptz,
  treasury_confirmation_reference text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_advances_reference_unique unique (reference),
  constraint supplier_advances_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,19}-[0-9]{3,12}$'),
  constraint supplier_advances_amount_positive check (amount > 0),
  constraint supplier_advances_outstanding_valid check (outstanding_amount >= 0 and outstanding_amount <= amount),
  constraint supplier_advances_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint supplier_advances_base_currency_format
    check (base_currency_code is null or base_currency_code ~ '^[A-Z]{3}$'),
  constraint supplier_advances_exchange_rate_positive check (exchange_rate is null or exchange_rate > 0),
  constraint supplier_advances_payment_method_check
    check (payment_method in ('bank_transfer', 'cash', 'cheque', 'mobile_money', 'offset', 'other')),
  constraint supplier_advances_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'payment_pending', 'paid',
                      'partially_applied', 'fully_applied', 'cancelled')),
  constraint supplier_advances_paid_stamped
    check (status not in ('paid', 'partially_applied', 'fully_applied')
           or (treasury_confirmed_at is not null and treasury_confirmed_by is not null))
);

-- Which company account paid, and the bank reference, live in their own table for the same reason
-- supplier banking does in Phase 2: a permission-gated table returns no rows at all to an
-- unauthorised reader, whereas a hidden column is one API call away from being read.
create table if not exists public.supplier_advance_payment_details (
  advance_id uuid primary key references public.supplier_advances (id) on delete cascade on update cascade,
  paying_bank_account_id uuid references public.supplier_bank_accounts (id) on delete set null on update cascade,
  paying_account_note text,
  payment_reference text,
  approved_amount numeric(20, 2),
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.supplier_advance_payment_details is
  'Sensitive disbursement details for a supplier advance. Requires procurement.supplier_advance_payment.view for every operation including SELECT.';

create index if not exists supplier_advances_supplier_idx on public.supplier_advances (supplier_id, status);
create index if not exists supplier_advances_status_idx on public.supplier_advances (status, transaction_date desc);

comment on table public.supplier_advances is
  'Recorded supplier disbursements awaiting application against invoices. Not an expense, not a payable settlement.';

create table if not exists public.supplier_advance_applications (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.supplier_advances (id) on delete cascade on update cascade,
  target_type text not null default 'supplier_invoice',
  target_reference text not null,
  applied_amount numeric(20, 2) not null,
  applied_at date not null default current_date,
  confirmation_status text not null default 'pending',
  confirmed_by uuid references public.profiles (id) on delete set null on update cascade,
  confirmed_at timestamptz,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint supplier_advance_applications_amount_positive check (applied_amount > 0),
  constraint supplier_advance_applications_target_check
    check (target_type in ('supplier_invoice', 'purchase_order', 'credit_note', 'other')),
  constraint supplier_advance_applications_confirmation_check
    check (confirmation_status in ('pending', 'confirmed', 'rejected')),
  constraint supplier_advance_applications_confirmed_stamped
    check (confirmation_status <> 'confirmed' or confirmed_at is not null)
);

create index if not exists supplier_advance_applications_advance_idx
  on public.supplier_advance_applications (advance_id);

comment on table public.supplier_advance_applications is
  'Applications of an advance against a document. Untrusted until Finance confirms, so confirmation_status is explicit.';

create table if not exists public.supplier_transaction_references (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  transaction_type text not null,
  transaction_id uuid,
  transaction_reference text not null,
  transaction_date date not null,
  amount numeric(20, 2) not null,
  currency_code text not null default 'NGN',
  source text not null default 'procurement',
  legacy_source_system text,
  legacy_record_id text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  constraint supplier_transaction_references_type_check
    check (transaction_type in ('purchase_order', 'goods_receipt', 'supplier_advance', 'supplier_payment',
                                'credit_note', 'adjustment', 'supplier_invoice')),
  constraint supplier_transaction_references_source_check
    check (source in ('procurement', 'finance_import', 'legacy_import', 'manual')),
  constraint supplier_transaction_references_amount_non_negative check (amount >= 0),
  constraint supplier_transaction_references_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  -- One reference per supplier, type and date: a re-import of the same payment cannot double-count
  -- the supplier's balance.
  constraint supplier_transaction_references_unique
    unique (supplier_id, transaction_type, transaction_reference)
);

create index if not exists supplier_transaction_references_supplier_idx
  on public.supplier_transaction_references (supplier_id, transaction_date desc);

comment on table public.supplier_transaction_references is
  'Supplier payment, invoice and credit references — recorded manually or imported. Procurement does not create accounting entries from these.';

create table if not exists public.supplier_reconciliations (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  supplier_id uuid not null references public.suppliers (id) on delete restrict on update cascade,
  period_start date not null,
  period_end date not null,
  currency_code text not null default 'NGN',
  status text not null default 'draft',
  status_reason text,
  ordered_amount numeric(20, 2) not null default 0,
  received_amount numeric(20, 2) not null default 0,
  invoiced_amount numeric(20, 2) not null default 0,
  paid_amount numeric(20, 2) not null default 0,
  advance_balance numeric(20, 2) not null default 0,
  difference_amount numeric(20, 2) not null default 0,
  notes text,
  prepared_by uuid references public.profiles (id) on delete set null on update cascade,
  prepared_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null on update cascade,
  reviewed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null on update cascade,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_reconciliations_reference_unique unique (reference),
  constraint supplier_reconciliations_period_valid check (period_end >= period_start),
  constraint supplier_reconciliations_status_check
    check (status in ('draft', 'submitted', 'reviewed', 'closed', 'disputed')),
  constraint supplier_reconciliations_currency_format check (currency_code ~ '^[A-Z]{3}$')
);

create index if not exists supplier_reconciliations_supplier_idx
  on public.supplier_reconciliations (supplier_id, period_end desc);

create table if not exists public.supplier_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.supplier_reconciliations (id) on delete cascade on update cascade,
  transaction_type text not null,
  transaction_id uuid,
  transaction_reference text not null,
  transaction_date date not null,
  amount numeric(20, 2) not null,
  is_matched boolean not null default false,
  match_notes text,
  created_at timestamptz not null default now(),
  constraint supplier_reconciliation_items_type_check
    check (transaction_type in ('purchase_order', 'goods_receipt', 'supplier_advance', 'supplier_payment',
                                'credit_note', 'adjustment', 'supplier_invoice'))
);

create index if not exists supplier_reconciliation_items_reconciliation_idx
  on public.supplier_reconciliation_items (reconciliation_id);

select private.install_procurement_triggers('public.supplier_advances', 'supplier_advance', 'reference');
select private.install_procurement_triggers('public.supplier_reconciliations', 'supplier_reconciliation', 'reference');

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

/** Advances are not ordered from suppliers, so they follow the order-level eligibility rule. */
create or replace function private.guard_advance_supplier_eligible()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  supplier record;
begin
  select legal_name, status, verification_status into supplier
    from public.suppliers where id = new.supplier_id;
  if supplier.legal_name is null then
    raise exception 'The selected supplier no longer exists' using errcode = 'check_violation';
  end if;
  if (supplier.status <> 'active' or supplier.verification_status <> 'verified')
     and not private.supplier_exception_active(new.supplier_id, 'advance') then
    raise exception 'Supplier % is % with verification %, so an advance cannot be recorded. Record an authorised exception first.',
      supplier.legal_name, supplier.status, supplier.verification_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_advances_supplier_guard on public.supplier_advances;
create trigger supplier_advances_supplier_guard
  before insert or update of supplier_id on public.supplier_advances
  for each row execute function private.guard_advance_supplier_eligible();

/**
 * Keeps the advance balance and status honest.
 *
 * outstanding = amount − confirmed applications. Applications still pending Finance confirmation do
 * not reduce the balance, because procurement cannot declare money applied on Finance's behalf.
 * The status only advances along declared edges, so the lifecycle guard still applies.
 */
create or replace function private.recalculate_advance_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := coalesce(new.advance_id, old.advance_id);
  advance_row public.supplier_advances;
  confirmed numeric(20, 2);
  outstanding numeric(20, 2);
  next_status text;
begin
  select * into advance_row from public.supplier_advances where id = target;
  if advance_row.id is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(applied_amount), 0) into confirmed
    from public.supplier_advance_applications
   where advance_id = target and confirmation_status = 'confirmed';

  if confirmed > advance_row.amount then
    raise exception 'Confirmed applications (%) exceed the advance amount (%)', confirmed, advance_row.amount
      using errcode = 'check_violation';
  end if;

  outstanding := advance_row.amount - confirmed;

  next_status := advance_row.status;
  if advance_row.status in ('paid', 'partially_applied', 'fully_applied') then
    if outstanding = advance_row.amount then
      next_status := 'paid';
    elsif outstanding > 0 then
      next_status := 'partially_applied';
    else
      next_status := 'fully_applied';
    end if;
  end if;

  update public.supplier_advances
     set outstanding_amount = outstanding,
         status = next_status
   where id = target;

  return coalesce(new, old);
end;
$$;


/**
 * Keeps `outstanding_amount` true at every stage of an advance's life.
 *
 * The balance is derived from confirmed applications, so it must be recomputed when the advance
 * itself changes — not only when an application is added. Without this, a freshly treasury-confirmed
 * advance would report an outstanding balance of zero and look fully applied to anyone reading the
 * supplier position.
 */
create or replace function private.sync_advance_outstanding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  confirmed_amount numeric(20, 2);
begin
  select coalesce(sum(applied_amount), 0)
    into confirmed_amount
    from public.supplier_advance_applications
   where advance_id = new.id
     and confirmation_status = 'confirmed';

  new.outstanding_amount := new.amount - confirmed_amount;
  return new;
end;
$$;

drop trigger if exists supplier_advances_outstanding_sync on public.supplier_advances;
create trigger supplier_advances_outstanding_sync
  before insert or update of amount, status on public.supplier_advances
  for each row execute function private.sync_advance_outstanding();

drop trigger if exists supplier_advance_applications_balance on public.supplier_advance_applications;
create trigger supplier_advance_applications_balance
  after insert or update or delete on public.supplier_advance_applications
  for each row execute function private.recalculate_advance_balance();

/** Treasury confirmation is a distinct act; it stamps the advance and lets the lifecycle move. */
create or replace function private.confirm_advance_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid' and old.status <> 'paid' then
    if new.treasury_confirmed_at is null or new.treasury_confirmation_reference is null then
      raise exception 'Marking an advance paid requires a treasury confirmation reference and timestamp'
        using errcode = 'check_violation';
    end if;
    new.treasury_confirmed_by := coalesce(new.treasury_confirmed_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_advances_confirmation on public.supplier_advances;
create trigger supplier_advances_confirmation
  before update on public.supplier_advances
  for each row execute function private.confirm_advance_payment();

-- ---------------------------------------------------------------------------
-- Supplier ledger and balances
-- ---------------------------------------------------------------------------
-- One chronological timeline per supplier, built from the documents themselves rather than from a
-- denormalised log, so it cannot disagree with the transactions it lists.

create or replace view public.supplier_ledger
with (security_invoker = true)
as
select
  po.supplier_id,
  'purchase_order'::text as activity_type,
  po.id as activity_id,
  po.reference as activity_reference,
  po.order_date as activity_date,
  po.total_amount as amount,
  po.currency_code,
  po.status
from public.purchase_orders po
union all
select
  gr.supplier_id,
  'goods_receipt'::text,
  gr.id,
  gr.reference,
  gr.receipt_date,
  null::numeric(20, 2),
  po.currency_code,
  gr.status
from public.goods_receipts gr
join public.purchase_orders po on po.id = gr.purchase_order_id
union all
select
  ad.supplier_id,
  'supplier_advance'::text,
  ad.id,
  ad.reference,
  ad.transaction_date,
  ad.amount,
  ad.currency_code,
  ad.status
from public.supplier_advances ad
union all
select
  tr.supplier_id,
  tr.transaction_type,
  tr.id,
  tr.transaction_reference,
  tr.transaction_date,
  tr.amount,
  tr.currency_code,
  tr.source
from public.supplier_transaction_references tr;

comment on view public.supplier_ledger is
  'Chronological supplier activity. Each row carries the id of the original document so the timeline always links back.';

/**
 * Supplier position, with each figure labelled for what it is — one row per supplier per currency.
 *
 * The figures are grouped by currency on purpose. Pluck Agro buys in more than one currency, and
 * adding naira to dollars would produce a number that is arithmetically valid and commercially
 * meaningless. The screen that shows this lists the currencies side by side.
 *
 * `ordered_amount` is a commitment, not a payable. `confirmed_payable` is deliberately null when no
 * supplier invoice has been recorded: procurement has no authority to state a payable that Finance
 * has not invoiced. `unreconciled_difference` is the gap an accountant still has to explain.
 */
create or replace view public.supplier_balances
with (security_invoker = true)
as
with ordered as (
  select supplier_id, currency_code, sum(total_amount) as amount
    from public.purchase_orders
   where status not in ('cancelled', 'rejected', 'draft')
   group by supplier_id, currency_code
),
received as (
  select gr.supplier_id,
         po.currency_code,
         sum(gi.accepted_quantity * poi.unit_price) as amount
    from public.goods_receipts gr
    join public.goods_receipt_items gi on gi.goods_receipt_id = gr.id
    join public.purchase_order_items poi on poi.id = gi.purchase_order_item_id
    join public.purchase_orders po on po.id = gr.purchase_order_id
   where gr.status = 'posted'
   group by gr.supplier_id, po.currency_code
),
referenced as (
  select supplier_id,
         currency_code,
         sum(amount) filter (where transaction_type = 'supplier_invoice') as invoiced,
         sum(amount) filter (where transaction_type = 'supplier_payment') as paid
    from public.supplier_transaction_references
   group by supplier_id, currency_code
),
advances as (
  select supplier_id, currency_code, sum(outstanding_amount) as balance
    from public.supplier_advances
   where status in ('paid', 'partially_applied', 'fully_applied')
   group by supplier_id, currency_code
),
currency_codes as (
  select supplier_id, currency_code from ordered
  union
  select supplier_id, currency_code from received
  union
  select supplier_id, currency_code from referenced
  union
  select supplier_id, currency_code from advances
)
select
  s.id as supplier_id,
  s.legal_name,
  s.reference,
  s.status as supplier_status,
  c.currency_code,
  coalesce(o.amount, 0)::numeric(20, 2) as ordered_amount,
  coalesce(r.amount, 0)::numeric(20, 2) as received_value,
  coalesce(x.invoiced, 0)::numeric(20, 2) as invoiced_amount,
  coalesce(x.paid, 0)::numeric(20, 2) as paid_amount,
  coalesce(a.balance, 0)::numeric(20, 2) as advance_balance,
  case when coalesce(x.invoiced, 0) > 0
       then (coalesce(x.invoiced, 0) - coalesce(x.paid, 0))::numeric(20, 2)
       else null end as confirmed_payable,
  case when coalesce(x.invoiced, 0) > 0
       then (coalesce(x.invoiced, 0) - coalesce(x.paid, 0) - coalesce(r.amount, 0)
             + coalesce(a.balance, 0))::numeric(20, 2)
       else null end as unreconciled_difference
from public.suppliers s
join currency_codes c on c.supplier_id = s.id
left join ordered o on o.supplier_id = s.id and o.currency_code = c.currency_code
left join received r on r.supplier_id = s.id and r.currency_code = c.currency_code
left join referenced x on x.supplier_id = s.id and x.currency_code = c.currency_code
left join advances a on a.supplier_id = s.id and a.currency_code = c.currency_code;

comment on view public.supplier_balances is
  'Supplier position per currency. ordered_amount is a commitment; confirmed_payable is null until an invoice is recorded. No figure here is an accounting balance.';
