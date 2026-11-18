-- 0031 — supplier master registry
--
-- A supplier is one authoritative record referenced by procurement, expenses, finance and
-- quality. Names are never used as keys. Banking data lives in its own table so that ordinary
-- supplier-directory access cannot read it at all (RLS in 0038), not merely hide it in a form.
--
-- supplier_product_categories is created in 0034 because it references product_categories,
-- which must exist first.

create table if not exists public.supplier_categories (
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
  constraint supplier_categories_code_unique unique (code),
  constraint supplier_categories_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint supplier_categories_name_present check (length(btrim(name)) > 1)
);

create index if not exists supplier_categories_active_idx on public.supplier_categories (is_active, sort_order);

comment on table public.supplier_categories is
  'Configurable supplier classifications. A supplier may hold several.';

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  legal_name text not null,
  trading_name text,
  supplier_type text not null default 'company',
  primary_category_id uuid references public.supplier_categories (id) on delete set null,
  registration_number text,
  tax_identification_number text,
  registration_country text,
  date_registered date,
  status text not null default 'draft',
  status_reason text,
  description text,
  -- Contact details kept on the supplier itself are the "primary contact summary" shown in
  -- lists; the full multi-contact record lives in supplier_contacts.
  contact_person text,
  contact_position text,
  phone text,
  alternate_phone text,
  email text,
  website text,
  preferred_channel text,
  -- Commercial defaults
  preferred_currency_code text,
  payment_terms_id uuid,
  delivery_terms_id uuid,
  internal_reference text,
  procurement_officer_employee_id uuid references public.employees (id) on delete set null,
  relationship_manager_employee_id uuid references public.employees (id) on delete set null,
  -- Verification and onboarding
  onboarding_date date,
  last_verification_date date,
  verification_status text not null default 'unverified',
  verification_notes text,
  -- Internal management
  risk_category text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_reference_unique unique (reference),
  constraint suppliers_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,15}-[0-9]{3,12}$'),
  constraint suppliers_legal_name_present check (length(btrim(legal_name)) > 1),
  constraint suppliers_status_check
    check (status in ('draft', 'submitted', 'under_review', 'rejected', 'verified', 'active', 'inactive', 'blocked', 'archived')),
  constraint suppliers_verification_status_check
    check (verification_status in ('unverified', 'pending', 'verified', 'failed')),
  constraint suppliers_type_check
    check (supplier_type in ('company', 'individual', 'partnership', 'cooperative', 'government', 'other')),
  constraint suppliers_email_format check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint suppliers_currency_format check (preferred_currency_code is null or preferred_currency_code ~ '^[A-Z]{3}$'),
  constraint suppliers_website_format check (website is null or website ~* '^https?://'),
  constraint suppliers_archived_immutable_reason
    check (status <> 'archived' or status_reason is not null)
);

create index if not exists suppliers_status_idx on public.suppliers (status);
create index if not exists suppliers_category_idx on public.suppliers (primary_category_id);
create index if not exists suppliers_legal_name_idx on public.suppliers (lower(legal_name));
create index if not exists suppliers_registration_idx on public.suppliers (registration_number);
create index if not exists suppliers_tax_id_idx on public.suppliers (tax_identification_number);
create index if not exists suppliers_email_idx on public.suppliers (lower(email));
create index if not exists suppliers_phone_idx on public.suppliers (phone);

comment on table public.suppliers is
  'Supplier master record. Presence in this table does not imply approval for procurement: only status = active does.';

select private.install_master_triggers('public.suppliers', 'supplier');

-- Multiple classifications per supplier (spec §5.1).
create table if not exists public.supplier_category_assignments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  category_id uuid not null references public.supplier_categories (id) on delete cascade on update cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supplier_category_assignments_unique unique (supplier_id, category_id)
);

create index if not exists supplier_category_assignments_category_idx
  on public.supplier_category_assignments (category_id);

create table if not exists public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  name text not null,
  position text,
  department text,
  phone text,
  alternate_phone text,
  email text,
  preferred_channel text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_contacts_name_present check (length(btrim(name)) > 1),
  constraint supplier_contacts_email_format check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists supplier_contacts_supplier_idx on public.supplier_contacts (supplier_id, is_active);
-- At most one primary contact per supplier.
create unique index if not exists supplier_contacts_primary_unique_idx
  on public.supplier_contacts (supplier_id)
  where is_primary and is_active;

create table if not exists public.supplier_addresses (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  address_type text not null default 'registered',
  label text,
  country text not null,
  state_region text,
  local_government text,
  city text,
  street text,
  postal_code text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_primary boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_addresses_type_check
    check (address_type in ('registered', 'operational', 'collection_point', 'delivery', 'correspondence')),
  constraint supplier_addresses_country_present check (length(btrim(country)) > 1),
  constraint supplier_addresses_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint supplier_addresses_longitude_range check (longitude is null or longitude between -180 and 180)
);

create index if not exists supplier_addresses_supplier_idx on public.supplier_addresses (supplier_id, address_type);
create unique index if not exists supplier_addresses_primary_unique_idx
  on public.supplier_addresses (supplier_id)
  where is_primary;

create table if not exists public.supplier_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  bank_name text not null,
  account_holder_name text not null,
  account_number text not null,
  branch_name text,
  bank_identifier text,
  country text,
  currency_code text not null default 'NGN',
  verification_status text not null default 'unverified',
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_bank_accounts_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint supplier_bank_accounts_verification_check
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  constraint supplier_bank_accounts_number_present check (length(btrim(account_number)) >= 4),
  constraint supplier_bank_accounts_unique unique (supplier_id, account_number, bank_identifier)
);

create index if not exists supplier_bank_accounts_supplier_idx on public.supplier_bank_accounts (supplier_id, is_active);

comment on table public.supplier_bank_accounts is
  'Sensitive. Read requires master_data.supplier_banking.view; RLS denies everyone else. Account numbers are masked in the UI and never logged.';

create table if not exists public.supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  document_type text not null,
  title text not null,
  reference_number text,
  issued_on date,
  expires_on date,
  -- Storage object location only. No public URL is ever persisted, so a leaked row cannot
  -- become a leaked document.
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supplier_documents_type_check
    check (document_type in ('business_registration', 'tax', 'identification', 'quality_certificate', 'certification', 'other')),
  constraint supplier_documents_title_present check (length(btrim(title)) > 1),
  constraint supplier_documents_expiry_order check (expires_on is null or issued_on is null or expires_on >= issued_on),
  constraint supplier_documents_no_public_url
    check (storage_path is null or storage_path !~* '^https?://')
);

create index if not exists supplier_documents_supplier_idx on public.supplier_documents (supplier_id, document_type);
create index if not exists supplier_documents_expiry_idx on public.supplier_documents (expires_on);
