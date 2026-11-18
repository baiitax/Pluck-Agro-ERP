-- 0032 — customer master registry
--
-- Mirrors the supplier design: UUID keys, readable reference, configurable categories,
-- multi-contact and multi-address support, and credit information isolated in its own table so
-- it cannot be read through an ordinary customer query.
--
-- Customer lifecycle status is master-data lifecycle only. It is NOT a sales opportunity or CRM
-- pipeline status, and nothing here authorizes a credit sale.

create table if not exists public.customer_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_categories_code_unique unique (code),
  constraint customer_categories_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint customer_categories_name_present check (length(btrim(name)) > 1)
);

create index if not exists customer_categories_active_idx on public.customer_categories (is_active, sort_order);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  legal_name text not null,
  trading_name text,
  customer_type text not null default 'direct_buyer',
  primary_category_id uuid references public.customer_categories (id) on delete set null,
  registration_number text,
  tax_identification_number text,
  registration_country text,
  status text not null default 'lead',
  status_reason text,
  description text,
  website text,
  relationship_start_date date,
  -- Commercial profile
  preferred_currency_code text,
  payment_terms_id uuid,
  delivery_terms_id uuid,
  preferred_language text,
  sales_representative_employee_id uuid references public.employees (id) on delete set null,
  relationship_manager_employee_id uuid references public.employees (id) on delete set null,
  commercial_notes text,
  notes text,
  -- Primary contact summary (full records live in customer_contacts)
  contact_name text,
  contact_email text,
  contact_phone text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_reference_unique unique (reference),
  constraint customers_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,15}-[0-9]{3,12}$'),
  constraint customers_legal_name_present check (length(btrim(legal_name)) > 1),
  constraint customers_status_check
    check (status in ('lead', 'prospect', 'onboarding', 'verified', 'active', 'inactive', 'blocked', 'archived')),
  constraint customers_type_check
    check (customer_type in ('direct_buyer', 'importer', 'distributor', 'manufacturer', 'wholesaler',
                             'retailer', 'trading_company', 'agent', 'domestic_buyer', 'other')),
  constraint customers_currency_format check (preferred_currency_code is null or preferred_currency_code ~ '^[A-Z]{3}$'),
  constraint customers_website_format check (website is null or website ~* '^https?://'),
  constraint customers_contact_email_format
    check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint customers_archived_immutable_reason check (status <> 'archived' or status_reason is not null)
);

create index if not exists customers_status_idx on public.customers (status);
create index if not exists customers_category_idx on public.customers (primary_category_id);
create index if not exists customers_legal_name_idx on public.customers (lower(legal_name));
create index if not exists customers_registration_idx on public.customers (registration_number);
create index if not exists customers_country_idx on public.customers (registration_country);

comment on table public.customers is
  'Customer master record. Credit limits are held separately in customer_credit_profiles and never authorize trade on their own.';

select private.install_master_triggers('public.customers', 'customer');

create table if not exists public.customer_category_assignments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade on update cascade,
  category_id uuid not null references public.customer_categories (id) on delete cascade on update cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_category_assignments_unique unique (customer_id, category_id)
);

create index if not exists customer_category_assignments_category_idx
  on public.customer_category_assignments (category_id);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade on update cascade,
  name text not null,
  job_title text,
  department text,
  email text,
  phone text,
  whatsapp_number text,
  preferred_language text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contacts_name_present check (length(btrim(name)) > 1),
  constraint customer_contacts_email_format check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint customer_contacts_department_check
    check (department is null or department in ('purchasing', 'finance', 'quality', 'logistics', 'management', 'other'))
);

create index if not exists customer_contacts_customer_idx on public.customer_contacts (customer_id, is_active);
create unique index if not exists customer_contacts_primary_unique_idx
  on public.customer_contacts (customer_id)
  where is_primary and is_active;

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade on update cascade,
  address_type text not null default 'registered',
  label text,
  country text not null,
  state_region text,
  city text,
  street text,
  postal_code text,
  is_primary boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_type_check
    check (address_type in ('registered', 'billing', 'delivery', 'warehouse', 'correspondence')),
  constraint customer_addresses_country_present check (length(btrim(country)) > 1)
);

create index if not exists customer_addresses_customer_idx on public.customer_addresses (customer_id, address_type);
create unique index if not exists customer_addresses_primary_unique_idx
  on public.customer_addresses (customer_id)
  where is_primary;

-- Credit reference data. Prepared for a future credit-management phase; it does not grant
-- credit and it is not consulted by any workflow in Phase 2 because no sales workflow exists.
create table if not exists public.customer_credit_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade on update cascade,
  credit_limit numeric(18, 2),
  credit_currency_code text,
  credit_review_date date,
  credit_status text not null default 'not_assessed',
  risk_category text,
  credit_notes text,
  assessed_by uuid references public.profiles (id) on delete set null,
  assessed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_credit_profiles_unique unique (customer_id),
  constraint customer_credit_profiles_limit_non_negative check (credit_limit is null or credit_limit >= 0),
  constraint customer_credit_profiles_currency_format
    check (credit_currency_code is null or credit_currency_code ~ '^[A-Z]{3}$'),
  constraint customer_credit_profiles_status_check
    check (credit_status in ('not_assessed', 'pending_review', 'approved', 'suspended', 'withdrawn'))
);

comment on table public.customer_credit_profiles is
  'Sensitive. Read requires master_data.customer_credit.view. A stored limit is reference data only; it never authorizes a credit sale.';

create table if not exists public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade on update cascade,
  document_type text not null,
  title text not null,
  reference_number text,
  issued_on date,
  expires_on date,
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_documents_type_check
    check (document_type in ('company_registration', 'tax', 'onboarding', 'importer_licence', 'compliance_certificate', 'other')),
  constraint customer_documents_title_present check (length(btrim(title)) > 1),
  constraint customer_documents_expiry_order check (expires_on is null or issued_on is null or expires_on >= issued_on),
  constraint customer_documents_no_public_url check (storage_path is null or storage_path !~* '^https?://')
);

create index if not exists customer_documents_customer_idx on public.customer_documents (customer_id, document_type);
