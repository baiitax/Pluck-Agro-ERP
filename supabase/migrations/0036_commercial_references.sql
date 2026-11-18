-- 0036 — currencies, exchange rates and commercial reference data
--
-- Reference data is factual and standardised where a standard exists (ISO 4217 currency codes,
-- Incoterms editions). Values that represent company policy or market fact — tax rates, exchange
-- rates, payment terms actually offered — are NOT seeded. See 0039 for exactly what is seeded
-- and why.

create table if not exists public.currencies (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  symbol text,
  decimal_places int not null default 2,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint currencies_code_unique unique (code),
  constraint currencies_code_format check (code ~ '^[A-Z]{3}$'),
  constraint currencies_decimal_places_range check (decimal_places between 0 and 4),
  constraint currencies_name_present check (length(btrim(name)) > 1)
);

create index if not exists currencies_active_idx on public.currencies (is_active);

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency_code text not null,
  quote_currency_code text not null,
  exchange_rate numeric(24, 10) not null,
  rate_date date not null default current_date,
  effective_from date not null default current_date,
  effective_until date,
  rate_source text,
  rate_type text not null default 'official',
  status text not null default 'approved',
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exchange_rates_currencies_distinct check (base_currency_code <> quote_currency_code),
  constraint exchange_rates_code_format
    check (base_currency_code ~ '^[A-Z]{3}$' and quote_currency_code ~ '^[A-Z]{3}$'),
  constraint exchange_rates_rate_positive check (exchange_rate > 0),
  constraint exchange_rates_period_valid
    check (effective_until is null or effective_until >= effective_from),
  constraint exchange_rates_type_check
    check (rate_type in ('official', 'treasury', 'commercial', 'customs', 'other')),
  constraint exchange_rates_status_check
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'superseded'))
);

-- One rate per pair, type and date. Re-rating means a new row, never an edit of history.
create unique index if not exists exchange_rates_unique_idx
  on public.exchange_rates (base_currency_code, quote_currency_code, rate_type, rate_date);
create index if not exists exchange_rates_lookup_idx
  on public.exchange_rates (base_currency_code, quote_currency_code, rate_type, effective_from desc);

comment on table public.exchange_rates is
  'Effective-dated rates. A rate row is never rewritten: superseding means a new row, so historical applied rates stay reproducible.';

create table if not exists public.payment_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  payment_days int,
  payment_type text not null default 'credit',
  is_active boolean not null default true,
  is_seeded_template boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_terms_code_unique unique (code),
  constraint payment_terms_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint payment_terms_name_present check (length(btrim(name)) > 1),
  constraint payment_terms_days_non_negative check (payment_days is null or payment_days >= 0),
  constraint payment_terms_type_check
    check (payment_type in ('advance', 'cash_on_delivery', 'immediate', 'credit', 'custom'))
);

create index if not exists payment_terms_active_idx on public.payment_terms (is_active);

comment on column public.payment_terms.is_seeded_template is
  'True for the illustrative terms shipped inactive by 0039. Activating one is a commercial decision, not an edit.';

create table if not exists public.delivery_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  term_kind text not null default 'incoterm',
  edition text,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_terms_code_unique unique (code),
  constraint delivery_terms_code_format check (code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,19}$'),
  constraint delivery_terms_name_present check (length(btrim(name)) > 1),
  constraint delivery_terms_kind_check check (term_kind in ('incoterm', 'domestic', 'other'))
);

comment on table public.delivery_terms is
  'Delivery terms. Incoterms and domestic/internal terms share one table (term_kind), avoiding a duplicate incoterms table with identical columns.';

create index if not exists delivery_terms_kind_idx on public.delivery_terms (term_kind, is_active);

create table if not exists public.tax_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  country text,
  tax_type text,
  is_active boolean not null default true,
  effective_from date,
  effective_until date,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_categories_code_unique unique (code),
  constraint tax_categories_code_format check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint tax_categories_name_present check (length(btrim(name)) > 1),
  constraint tax_categories_period_valid
    check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

comment on table public.tax_categories is
  'Tax categories as reference definitions only. No rate is stored and nothing in Phase 2 computes tax.';

-- Supplier and customer commercial defaults can now be tied to real reference rows.
alter table public.suppliers
  drop constraint if exists suppliers_payment_terms_fk,
  drop constraint if exists suppliers_delivery_terms_fk;
alter table public.suppliers
  add constraint suppliers_payment_terms_fk
    foreign key (payment_terms_id) references public.payment_terms (id) on delete set null on update cascade,
  add constraint suppliers_delivery_terms_fk
    foreign key (delivery_terms_id) references public.delivery_terms (id) on delete set null on update cascade;

alter table public.customers
  drop constraint if exists customers_payment_terms_fk,
  drop constraint if exists customers_delivery_terms_fk;
alter table public.customers
  add constraint customers_payment_terms_fk
    foreign key (payment_terms_id) references public.payment_terms (id) on delete set null on update cascade,
  add constraint customers_delivery_terms_fk
    foreign key (delivery_terms_id) references public.delivery_terms (id) on delete set null on update cascade;
