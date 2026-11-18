-- 0037 — duplicate review, import staging, legacy provenance and data-quality indicators

-- ---------------------------------------------------------------------------
-- Duplicate candidates
-- ---------------------------------------------------------------------------
-- Candidate pairs are evidence, not action: nothing is merged automatically, and a merge is a
-- separate, audited operation that later phases can implement once referential checks exist.

create table if not exists public.master_data_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  record_a_id uuid not null,
  record_b_id uuid not null,
  record_a_label text,
  record_b_label text,
  match_score numeric(5, 2) not null,
  matched_fields text[] not null default '{}',
  status text not null default 'open',
  resolution_notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint master_data_duplicate_candidates_distinct check (record_a_id <> record_b_id),
  constraint master_data_duplicate_candidates_ordered check (record_a_id < record_b_id),
  constraint master_data_duplicate_candidates_entity_check
    check (entity_type in ('supplier', 'customer', 'product')),
  constraint master_data_duplicate_candidates_score_range check (match_score between 0 and 100),
  constraint master_data_duplicate_candidates_status_check
    check (status in ('open', 'confirmed_duplicate', 'not_duplicate', 'deferred', 'merged')),
  constraint master_data_duplicate_candidates_unique unique (entity_type, record_a_id, record_b_id)
);

create index if not exists master_data_duplicate_candidates_status_idx
  on public.master_data_duplicate_candidates (entity_type, status, match_score desc);

comment on table public.master_data_duplicate_candidates is
  'Potential duplicates awaiting human review. A row here never changes master data.';

-- ---------------------------------------------------------------------------
-- Import staging
-- ---------------------------------------------------------------------------
-- Every uploaded row is persisted with its own verdict, so a rejected row is auditable rather
-- than silently dropped. `batch_key` makes a retry idempotent.

create table if not exists public.master_data_import_jobs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  file_name text not null,
  batch_key text not null,
  status text not null default 'uploaded',
  total_rows int not null default 0,
  accepted_rows int not null default 0,
  rejected_rows int not null default 0,
  imported_rows int not null default 0,
  duplicate_rows int not null default 0,
  error_summary jsonb,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_data_import_jobs_entity_check
    check (entity_type in ('supplier', 'customer', 'product', 'unit_of_measure', 'payment_term', 'currency')),
  constraint master_data_import_jobs_status_check
    check (status in ('uploaded', 'validated', 'awaiting_confirmation', 'imported', 'failed', 'cancelled')),
  constraint master_data_import_jobs_batch_unique unique (batch_key),
  constraint master_data_import_jobs_counts_valid
    check (accepted_rows + rejected_rows <= total_rows and imported_rows <= accepted_rows)
);

create index if not exists master_data_import_jobs_status_idx
  on public.master_data_import_jobs (entity_type, status, created_at desc);

drop trigger if exists master_data_import_jobs_set_updated_at on public.master_data_import_jobs;
create trigger master_data_import_jobs_set_updated_at
  before update on public.master_data_import_jobs
  for each row execute function private.set_updated_at();

create table if not exists public.master_data_import_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.master_data_import_jobs (id) on delete cascade on update cascade,
  row_number int not null,
  raw_data jsonb not null,
  status text not null default 'pending',
  errors jsonb,
  target_id uuid,
  created_at timestamptz not null default now(),
  constraint master_data_import_rows_status_check
    check (status in ('pending', 'accepted', 'rejected', 'imported', 'skipped_duplicate')),
  constraint master_data_import_rows_row_positive check (row_number >= 1),
  constraint master_data_import_rows_unique unique (job_id, row_number)
);

create index if not exists master_data_import_rows_job_idx
  on public.master_data_import_rows (job_id, status);

comment on table public.master_data_import_rows is
  'One row per uploaded line, with its own verdict and errors. Rejected rows are retained for review.';

-- ---------------------------------------------------------------------------
-- Legacy provenance
-- ---------------------------------------------------------------------------
-- Phase 2 does not touch the live legacy database. It only makes the new schema capable of
-- holding the mapping, so a future migration is a data exercise rather than a re-design.

create table if not exists public.legacy_record_references (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'legacy_php_mysql',
  source_table text not null,
  source_record_id text not null,
  target_entity text not null,
  target_record_id uuid,
  migration_batch_id text,
  migration_status text not null default 'pending',
  migrated_at timestamptz,
  reconciliation_notes text,
  created_at timestamptz not null default now(),
  constraint legacy_record_references_unique unique (source_system, source_table, source_record_id),
  constraint legacy_record_references_status_check
    check (migration_status in ('pending', 'mapped', 'imported', 'reconciled', 'skipped', 'conflict'))
);

create index if not exists legacy_record_references_target_idx
  on public.legacy_record_references (target_entity, target_record_id);
create index if not exists legacy_record_references_batch_idx
  on public.legacy_record_references (migration_batch_id, migration_status);

-- ---------------------------------------------------------------------------
-- Data-quality indicators
-- ---------------------------------------------------------------------------
-- The indicators are a view, not a dashboard invention: every number the UI shows is
-- `select count(*)` from this view, so an indicator can be argued with by querying the database.

-- `security_invoker = true` makes the view run with the caller's rights, so the row-level policies
-- on suppliers, customers and products apply to the indicators too. Without it the view would leak
-- counts of rows the caller cannot read.
create or replace view public.master_data_quality_issues
with (security_invoker = true) as
  select 'supplier'::text as entity_type,
         'missing_contact'::text as indicator,
         'Suppliers without any contact detail (phone or email)'::text as description,
         'warning'::text as severity,
         count(*)::int as record_count
    from public.suppliers s
   where s.status <> 'archived'
     and s.phone is null and s.email is null
     and not exists (select 1 from public.supplier_contacts c where c.supplier_id = s.id and c.is_active)
  union all
  select 'supplier', 'unverified', 'Suppliers never verified', 'warning',
         count(*)::int
    from public.suppliers where verification_status = 'unverified' and status <> 'archived'
  union all
  select 'supplier', 'missing_category', 'Suppliers without a primary category', 'info',
         count(*)::int
    from public.suppliers where primary_category_id is null and status <> 'archived'
  union all
  select 'supplier', 'stale_verification', 'Verified suppliers whose verification is over a year old', 'warning',
         count(*)::int
    from public.suppliers
   where verification_status = 'verified' and status <> 'archived'
     and (last_verification_date is null or last_verification_date < current_date - interval '1 year')
  union all
  select 'supplier', 'expired_document', 'Supplier documents past their expiry date', 'critical',
         count(*)::int
    from public.supplier_documents where expires_on is not null and expires_on < current_date
  union all
  select 'customer', 'missing_contact', 'Customers without a primary contact', 'warning',
         count(*)::int
    from public.customers c
   where c.status <> 'archived'
     and not exists (select 1 from public.customer_contacts cc where cc.customer_id = c.id and cc.is_active)
  union all
  select 'customer', 'missing_country', 'Customers without a country of registration', 'warning',
         count(*)::int
    from public.customers where registration_country is null and status <> 'archived'
  union all
  select 'customer', 'missing_address', 'Customers without any address', 'info',
         count(*)::int
    from public.customers c
   where c.status <> 'archived'
     and not exists (select 1 from public.customer_addresses a where a.customer_id = c.id)
  union all
  select 'customer', 'credit_not_assessed', 'Active customers with no credit assessment on file', 'info',
         count(*)::int
    from public.customers c
   where c.status = 'active'
     and not exists (select 1 from public.customer_credit_profiles p where p.customer_id = c.id)
  union all
  select 'product', 'inactive_base_unit', 'Products whose base unit has been deactivated', 'critical',
         count(*)::int
    from public.products p
    join public.units_of_measure u on u.id = p.base_unit_id
   where not u.is_active and p.status <> 'archived'
  union all
  select 'product', 'missing_specification', 'Active products with no specification recorded', 'warning',
         count(*)::int
    from public.products p
   where p.status = 'active'
     and not exists (select 1 from public.product_specifications s where s.product_id = p.id)
  union all
  select 'product', 'missing_packaging', 'Active products with no packaging configuration', 'info',
         count(*)::int
    from public.products p
   where p.status = 'active'
     and not exists (select 1 from public.product_packaging k where k.product_id = p.id and k.is_active)
  union all
  select 'product', 'missing_category', 'Products in an inactive category', 'warning',
         count(*)::int
    from public.products p
    join public.product_categories c on c.id = p.category_id
   where not c.is_active and p.status <> 'archived'
  union all
  select 'warehouse', 'missing_site', 'Warehouses not linked to a site', 'warning',
         count(*)::int
    from public.warehouses where site_id is null and is_active
  union all
  select 'warehouse', 'missing_manager', 'Active warehouses without a manager', 'info',
         count(*)::int
    from public.warehouses where manager_employee_id is null and is_active
  union all
  select 'exchange_rate', 'missing_rate', 'Active currencies with no approved exchange rate', 'warning',
         count(*)::int
    from public.currencies c
   where c.is_active
     and not exists (select 1 from public.exchange_rates r where r.status = 'approved')
  union all
  select 'reference_data', 'missing_payment_terms', 'Suppliers without payment terms assigned', 'info',
         count(*)::int
    from public.suppliers where payment_terms_id is null and status = 'active'
  union all
  select 'reference_data', 'no_payment_terms_defined', 'No active payment term is configured', 'warning',
         (case when exists (select 1 from public.payment_terms where is_active) then 0 else 1 end)::int;

comment on view public.master_data_quality_issues is
  'Data-quality indicators computed from live rows. The dashboard counts this view; nothing is estimated.';
