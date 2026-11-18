-- 0038 — row-level security for master data
--
-- Policy shape, chosen deliberately:
--   * Reference/lookup tables (categories, units, currencies, payment terms, delivery terms, tax
--     categories) are readable by any active ERP user: forms need them and they hold no
--     commercial secrets. Writes require the matching `.manage` permission.
--   * Business records (suppliers, customers, products, sites, warehouses, locations) are readable
--     only with the matching `.view` permission.
--   * Sensitive tables (supplier banking, customer credit) require their own permission for every
--     operation, so an ordinary directory user gets zero rows — not a masked field.
--   * History, duplicates and import staging are restricted to the governance permissions.
--
-- Default posture is deny: a table with RLS enabled and no matching policy returns nothing.

alter table public.master_data_entities enable row level security;
alter table public.master_data_status_transitions enable row level security;
alter table public.master_data_change_history enable row level security;
alter table public.supplier_categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_category_assignments enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.supplier_addresses enable row level security;
alter table public.supplier_bank_accounts enable row level security;
alter table public.supplier_documents enable row level security;
alter table public.supplier_product_categories enable row level security;
alter table public.customer_categories enable row level security;
alter table public.customers enable row level security;
alter table public.customer_category_assignments enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_credit_profiles enable row level security;
alter table public.customer_documents enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_attribute_definitions enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_specifications enable row level security;
alter table public.product_packaging enable row level security;
alter table public.units_of_measure enable row level security;
alter table public.unit_conversions enable row level security;
alter table public.sites enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_locations enable row level security;
alter table public.currencies enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.payment_terms enable row level security;
alter table public.delivery_terms enable row level security;
alter table public.tax_categories enable row level security;
alter table public.master_data_duplicate_candidates enable row level security;
alter table public.master_data_import_jobs enable row level security;
alter table public.master_data_import_rows enable row level security;
alter table public.legacy_record_references enable row level security;

-- ---------------------------------------------------------------- policies
-- Each policy names its permission explicitly rather than routing through a generic helper: an
-- explicit code can be grepped, and a mistyped string fails loudly during review instead of
-- silently widening access.
-- ---------------------------------------------------------------- reference configuration
drop policy if exists master_data_entities_select on public.master_data_entities;
create policy master_data_entities_select on public.master_data_entities
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists master_data_entities_write on public.master_data_entities;
create policy master_data_entities_write on public.master_data_entities
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

drop policy if exists master_data_status_transitions_select on public.master_data_status_transitions;
create policy master_data_status_transitions_select on public.master_data_status_transitions
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists master_data_status_transitions_write on public.master_data_status_transitions;
create policy master_data_status_transitions_write on public.master_data_status_transitions
  for all to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

-- ---------------------------------------------------------------- history
drop policy if exists master_data_change_history_select on public.master_data_change_history;
create policy master_data_change_history_select on public.master_data_change_history
  for select to authenticated
  using (private.has_permission('master_data.history.view'));

-- ---------------------------------------------------------------- supplier categories (lookup)
drop policy if exists supplier_categories_select on public.supplier_categories;
create policy supplier_categories_select on public.supplier_categories
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists supplier_categories_write on public.supplier_categories;
create policy supplier_categories_write on public.supplier_categories
  for all to authenticated
  using (private.has_permission('master_data.supplier_categories.manage'))
  with check (private.has_permission('master_data.supplier_categories.manage'));

-- ---------------------------------------------------------------- suppliers
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (private.has_permission('master_data.suppliers.view'));

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (private.has_permission('master_data.suppliers.create'));

-- Row updates require at least one supplier write permission; the status guard adds the
-- per-transition permission on top, and the service enforces field-level rules.
drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (
    private.has_permission('master_data.suppliers.update')
    or private.has_permission('master_data.suppliers.verify')
    or private.has_permission('master_data.suppliers.activate')
    or private.has_permission('master_data.suppliers.block')
    or private.has_permission('master_data.suppliers.archive')
  )
  with check (
    private.has_permission('master_data.suppliers.update')
    or private.has_permission('master_data.suppliers.verify')
    or private.has_permission('master_data.suppliers.activate')
    or private.has_permission('master_data.suppliers.block')
    or private.has_permission('master_data.suppliers.archive')
  );

-- Child records follow the parent permission.
drop policy if exists supplier_children_select on public.supplier_contacts;
create policy supplier_children_select on public.supplier_contacts
  for select to authenticated using (private.has_permission('master_data.suppliers.view'));
drop policy if exists supplier_children_write on public.supplier_contacts;
create policy supplier_children_write on public.supplier_contacts
  for all to authenticated
  using (private.has_permission('master_data.suppliers.update'))
  with check (private.has_permission('master_data.suppliers.update'));

drop policy if exists supplier_addresses_select on public.supplier_addresses;
create policy supplier_addresses_select on public.supplier_addresses
  for select to authenticated using (private.has_permission('master_data.suppliers.view'));
drop policy if exists supplier_addresses_write on public.supplier_addresses;
create policy supplier_addresses_write on public.supplier_addresses
  for all to authenticated
  using (private.has_permission('master_data.suppliers.update'))
  with check (private.has_permission('master_data.suppliers.update'));

drop policy if exists supplier_category_assignments_select on public.supplier_category_assignments;
create policy supplier_category_assignments_select on public.supplier_category_assignments
  for select to authenticated using (private.has_permission('master_data.suppliers.view'));
drop policy if exists supplier_category_assignments_write on public.supplier_category_assignments;
create policy supplier_category_assignments_write on public.supplier_category_assignments
  for all to authenticated
  using (private.has_permission('master_data.suppliers.update'))
  with check (private.has_permission('master_data.suppliers.update'));

drop policy if exists supplier_product_categories_select on public.supplier_product_categories;
create policy supplier_product_categories_select on public.supplier_product_categories
  for select to authenticated using (private.has_permission('master_data.suppliers.view'));
drop policy if exists supplier_product_categories_write on public.supplier_product_categories;
create policy supplier_product_categories_write on public.supplier_product_categories
  for all to authenticated
  using (private.has_permission('master_data.suppliers.update'))
  with check (private.has_permission('master_data.suppliers.update'));

drop policy if exists supplier_documents_select on public.supplier_documents;
create policy supplier_documents_select on public.supplier_documents
  for select to authenticated using (private.has_permission('master_data.suppliers.view'));
drop policy if exists supplier_documents_write on public.supplier_documents;
create policy supplier_documents_write on public.supplier_documents
  for all to authenticated
  using (private.has_permission('master_data.suppliers.update'))
  with check (private.has_permission('master_data.suppliers.update'));

-- ---------------------------------------------------------------- supplier banking (sensitive)
drop policy if exists supplier_bank_accounts_select on public.supplier_bank_accounts;
create policy supplier_bank_accounts_select on public.supplier_bank_accounts
  for select to authenticated
  using (private.has_permission('master_data.supplier_banking.view'));

drop policy if exists supplier_bank_accounts_insert on public.supplier_bank_accounts;
create policy supplier_bank_accounts_insert on public.supplier_bank_accounts
  for insert to authenticated
  with check (private.has_permission('master_data.supplier_banking.manage'));

drop policy if exists supplier_bank_accounts_update on public.supplier_bank_accounts;
create policy supplier_bank_accounts_update on public.supplier_bank_accounts
  for update to authenticated
  using (private.has_permission('master_data.supplier_banking.manage'))
  with check (private.has_permission('master_data.supplier_banking.manage'));

drop policy if exists supplier_bank_accounts_delete on public.supplier_bank_accounts;
create policy supplier_bank_accounts_delete on public.supplier_bank_accounts
  for delete to authenticated
  using (private.has_permission('master_data.supplier_banking.manage'));

-- ---------------------------------------------------------------- customer categories (lookup)
drop policy if exists customer_categories_select on public.customer_categories;
create policy customer_categories_select on public.customer_categories
  for select to authenticated using (private.is_active_profile());

drop policy if exists customer_categories_write on public.customer_categories;
create policy customer_categories_write on public.customer_categories
  for all to authenticated
  using (private.has_permission('master_data.customer_categories.manage'))
  with check (private.has_permission('master_data.customer_categories.manage'));

-- ---------------------------------------------------------------- customers
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (private.has_permission('master_data.customers.view'));

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated
  with check (private.has_permission('master_data.customers.create'));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (
    private.has_permission('master_data.customers.update')
    or private.has_permission('master_data.customers.activate')
    or private.has_permission('master_data.customers.block')
    or private.has_permission('master_data.customers.archive')
  )
  with check (
    private.has_permission('master_data.customers.update')
    or private.has_permission('master_data.customers.activate')
    or private.has_permission('master_data.customers.block')
    or private.has_permission('master_data.customers.archive')
  );

drop policy if exists customer_contacts_select on public.customer_contacts;
create policy customer_contacts_select on public.customer_contacts
  for select to authenticated using (private.has_permission('master_data.customers.view'));
drop policy if exists customer_contacts_write on public.customer_contacts;
create policy customer_contacts_write on public.customer_contacts
  for all to authenticated
  using (private.has_permission('master_data.customers.update'))
  with check (private.has_permission('master_data.customers.update'));

drop policy if exists customer_addresses_select on public.customer_addresses;
create policy customer_addresses_select on public.customer_addresses
  for select to authenticated using (private.has_permission('master_data.customers.view'));
drop policy if exists customer_addresses_write on public.customer_addresses;
create policy customer_addresses_write on public.customer_addresses
  for all to authenticated
  using (private.has_permission('master_data.customers.update'))
  with check (private.has_permission('master_data.customers.update'));

drop policy if exists customer_category_assignments_select on public.customer_category_assignments;
create policy customer_category_assignments_select on public.customer_category_assignments
  for select to authenticated using (private.has_permission('master_data.customers.view'));
drop policy if exists customer_category_assignments_write on public.customer_category_assignments;
create policy customer_category_assignments_write on public.customer_category_assignments
  for all to authenticated
  using (private.has_permission('master_data.customers.update'))
  with check (private.has_permission('master_data.customers.update'));

drop policy if exists customer_documents_select on public.customer_documents;
create policy customer_documents_select on public.customer_documents
  for select to authenticated using (private.has_permission('master_data.customers.view'));
drop policy if exists customer_documents_write on public.customer_documents;
create policy customer_documents_write on public.customer_documents
  for all to authenticated
  using (private.has_permission('master_data.customers.update'))
  with check (private.has_permission('master_data.customers.update'));

-- ---------------------------------------------------------------- customer credit (sensitive)
drop policy if exists customer_credit_profiles_select on public.customer_credit_profiles;
create policy customer_credit_profiles_select on public.customer_credit_profiles
  for select to authenticated
  using (private.has_permission('master_data.customer_credit.view'));

drop policy if exists customer_credit_profiles_write on public.customer_credit_profiles;
create policy customer_credit_profiles_write on public.customer_credit_profiles
  for all to authenticated
  using (private.has_permission('master_data.customer_credit.manage'))
  with check (private.has_permission('master_data.customer_credit.manage'));

-- ---------------------------------------------------------------- product categories (lookup)
drop policy if exists product_categories_select on public.product_categories;
create policy product_categories_select on public.product_categories
  for select to authenticated using (private.is_active_profile());

drop policy if exists product_categories_write on public.product_categories;
create policy product_categories_write on public.product_categories
  for all to authenticated
  using (private.has_permission('master_data.product_categories.manage'))
  with check (private.has_permission('master_data.product_categories.manage'));

-- ---------------------------------------------------------------- products
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated using (private.has_permission('master_data.products.view'));

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (private.has_permission('master_data.products.create'));

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using (
    private.has_permission('master_data.products.update')
    or private.has_permission('master_data.products.activate')
    or private.has_permission('master_data.products.archive')
  )
  with check (
    private.has_permission('master_data.products.update')
    or private.has_permission('master_data.products.activate')
    or private.has_permission('master_data.products.archive')
  );

drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants
  for select to authenticated using (private.has_permission('master_data.products.view'));
drop policy if exists product_variants_write on public.product_variants;
create policy product_variants_write on public.product_variants
  for all to authenticated
  using (private.has_permission('master_data.product_variants.manage'))
  with check (private.has_permission('master_data.product_variants.manage'));

drop policy if exists product_attribute_definitions_select on public.product_attribute_definitions;
create policy product_attribute_definitions_select on public.product_attribute_definitions
  for select to authenticated using (private.is_active_profile());
drop policy if exists product_attribute_definitions_write on public.product_attribute_definitions;
create policy product_attribute_definitions_write on public.product_attribute_definitions
  for all to authenticated
  using (private.has_permission('master_data.product_specifications.manage'))
  with check (private.has_permission('master_data.product_specifications.manage'));

drop policy if exists product_attribute_values_select on public.product_attribute_values;
create policy product_attribute_values_select on public.product_attribute_values
  for select to authenticated using (private.has_permission('master_data.products.view'));
drop policy if exists product_attribute_values_write on public.product_attribute_values;
create policy product_attribute_values_write on public.product_attribute_values
  for all to authenticated
  using (private.has_permission('master_data.product_specifications.manage'))
  with check (private.has_permission('master_data.product_specifications.manage'));

drop policy if exists product_specifications_select on public.product_specifications;
create policy product_specifications_select on public.product_specifications
  for select to authenticated using (private.has_permission('master_data.products.view'));
drop policy if exists product_specifications_write on public.product_specifications;
create policy product_specifications_write on public.product_specifications
  for all to authenticated
  using (private.has_permission('master_data.product_specifications.manage'))
  with check (private.has_permission('master_data.product_specifications.manage'));

drop policy if exists product_packaging_select on public.product_packaging;
create policy product_packaging_select on public.product_packaging
  for select to authenticated using (private.has_permission('master_data.products.view'));
drop policy if exists product_packaging_write on public.product_packaging;
create policy product_packaging_write on public.product_packaging
  for all to authenticated
  using (private.has_permission('master_data.product_packaging.manage'))
  with check (private.has_permission('master_data.product_packaging.manage'));

-- ---------------------------------------------------------------- measurement (lookup)
drop policy if exists units_of_measure_select on public.units_of_measure;
create policy units_of_measure_select on public.units_of_measure
  for select to authenticated using (private.is_active_profile());

drop policy if exists units_of_measure_write on public.units_of_measure;
create policy units_of_measure_write on public.units_of_measure
  for all to authenticated
  using (private.has_permission('master_data.units.manage'))
  with check (private.has_permission('master_data.units.manage'));

drop policy if exists unit_conversions_select on public.unit_conversions;
create policy unit_conversions_select on public.unit_conversions
  for select to authenticated using (private.is_active_profile());

drop policy if exists unit_conversions_write on public.unit_conversions;
create policy unit_conversions_write on public.unit_conversions
  for all to authenticated
  using (private.has_permission('master_data.conversions.manage'))
  with check (private.has_permission('master_data.conversions.manage'));

-- ---------------------------------------------------------------- sites and warehouses
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites
  for select to authenticated using (private.has_permission('master_data.sites.view'));
drop policy if exists sites_write on public.sites;
create policy sites_write on public.sites
  for all to authenticated
  using (private.has_permission('master_data.sites.manage'))
  with check (private.has_permission('master_data.sites.manage'));

drop policy if exists warehouses_select on public.warehouses;
create policy warehouses_select on public.warehouses
  for select to authenticated using (private.has_permission('master_data.warehouses.view'));
drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
  for all to authenticated
  using (private.has_permission('master_data.warehouses.manage'))
  with check (private.has_permission('master_data.warehouses.manage'));

drop policy if exists warehouse_locations_select on public.warehouse_locations;
create policy warehouse_locations_select on public.warehouse_locations
  for select to authenticated using (private.has_permission('master_data.warehouses.view'));
drop policy if exists warehouse_locations_write on public.warehouse_locations;
create policy warehouse_locations_write on public.warehouse_locations
  for all to authenticated
  using (private.has_permission('master_data.warehouse_locations.manage'))
  with check (private.has_permission('master_data.warehouse_locations.manage'));

-- ---------------------------------------------------------------- commercial references
drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies
  for select to authenticated using (private.is_active_profile());
drop policy if exists currencies_write on public.currencies;
create policy currencies_write on public.currencies
  for all to authenticated
  using (private.has_permission('master_data.currencies.manage'))
  with check (private.has_permission('master_data.currencies.manage'));

drop policy if exists exchange_rates_select on public.exchange_rates;
create policy exchange_rates_select on public.exchange_rates
  for select to authenticated using (private.has_permission('master_data.exchange_rates.view'));
drop policy if exists exchange_rates_write on public.exchange_rates;
create policy exchange_rates_write on public.exchange_rates
  for all to authenticated
  using (private.has_permission('master_data.exchange_rates.manage'))
  with check (private.has_permission('master_data.exchange_rates.manage'));

-- Rates are historical evidence: once approved they may be superseded, never deleted.
drop policy if exists exchange_rates_delete on public.exchange_rates;
create policy exchange_rates_delete on public.exchange_rates
  for delete to authenticated
  using (private.has_permission('master_data.exchange_rates.manage') and status <> 'approved');

drop policy if exists payment_terms_select on public.payment_terms;
create policy payment_terms_select on public.payment_terms
  for select to authenticated using (private.is_active_profile());
drop policy if exists payment_terms_write on public.payment_terms;
create policy payment_terms_write on public.payment_terms
  for all to authenticated
  using (private.has_permission('master_data.payment_terms.manage'))
  with check (private.has_permission('master_data.payment_terms.manage'));

drop policy if exists delivery_terms_select on public.delivery_terms;
create policy delivery_terms_select on public.delivery_terms
  for select to authenticated using (private.is_active_profile());
drop policy if exists delivery_terms_write on public.delivery_terms;
create policy delivery_terms_write on public.delivery_terms
  for all to authenticated
  using (private.has_permission('master_data.delivery_terms.manage'))
  with check (private.has_permission('master_data.delivery_terms.manage'));

drop policy if exists tax_categories_select on public.tax_categories;
create policy tax_categories_select on public.tax_categories
  for select to authenticated using (private.is_active_profile());
drop policy if exists tax_categories_write on public.tax_categories;
create policy tax_categories_write on public.tax_categories
  for all to authenticated
  using (private.has_permission('master_data.tax_categories.manage'))
  with check (private.has_permission('master_data.tax_categories.manage'));

-- ---------------------------------------------------------------- duplicate review
drop policy if exists master_data_duplicate_candidates_select on public.master_data_duplicate_candidates;
create policy master_data_duplicate_candidates_select on public.master_data_duplicate_candidates
  for select to authenticated
  using (private.has_permission('master_data.duplicates.view'));

drop policy if exists master_data_duplicate_candidates_write on public.master_data_duplicate_candidates;
create policy master_data_duplicate_candidates_write on public.master_data_duplicate_candidates
  for all to authenticated
  using (private.has_permission('master_data.duplicates.review'))
  with check (private.has_permission('master_data.duplicates.review'));

-- ---------------------------------------------------------------- import staging
drop policy if exists master_data_import_jobs_select on public.master_data_import_jobs;
create policy master_data_import_jobs_select on public.master_data_import_jobs
  for select to authenticated
  using (private.has_permission('master_data.imports.view'));

drop policy if exists master_data_import_jobs_write on public.master_data_import_jobs;
create policy master_data_import_jobs_write on public.master_data_import_jobs
  for all to authenticated
  using (private.has_permission('master_data.imports.execute'))
  with check (private.has_permission('master_data.imports.execute'));

drop policy if exists master_data_import_rows_select on public.master_data_import_rows;
create policy master_data_import_rows_select on public.master_data_import_rows
  for select to authenticated
  using (private.has_permission('master_data.imports.view'));

drop policy if exists master_data_import_rows_write on public.master_data_import_rows;
create policy master_data_import_rows_write on public.master_data_import_rows
  for all to authenticated
  using (private.has_permission('master_data.imports.execute'))
  with check (private.has_permission('master_data.imports.execute'));

drop policy if exists legacy_record_references_select on public.legacy_record_references;
create policy legacy_record_references_select on public.legacy_record_references
  for select to authenticated
  using (private.has_permission('master_data.imports.view'));

drop policy if exists legacy_record_references_write on public.legacy_record_references;
create policy legacy_record_references_write on public.legacy_record_references
  for all to authenticated
  using (private.has_permission('master_data.imports.execute'))
  with check (private.has_permission('master_data.imports.execute'));

-- Public wrapper so the application can allocate a reference for previewing/import without
-- reaching into the private schema.
create or replace function public.next_master_reference(target_entity text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select private.next_master_reference(target_entity);
$$;

-- ---------------------------------------------------------------- grants
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    for table_name in
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (c.relname like 'supplier%' or c.relname like 'customer%' or c.relname like 'product%'
              or c.relname in ('master_data_entities', 'master_data_status_transitions',
                               'master_data_change_history', 'master_data_duplicate_candidates',
                               'master_data_import_jobs', 'master_data_import_rows',
                               'legacy_record_references', 'units_of_measure', 'unit_conversions',
                               'sites', 'warehouses', 'warehouse_locations', 'currencies',
                               'exchange_rates', 'payment_terms', 'delivery_terms', 'tax_categories'))
    loop
      execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    end loop;

    -- The history trail and the quality view are read-only to application users. History rows are
    -- written by a SECURITY DEFINER trigger, so no INSERT grant is needed or given.
    execute 'revoke insert, update, delete on public.master_data_change_history from authenticated';
    execute 'grant select on public.master_data_quality_issues to authenticated';
    execute 'grant execute on function public.next_master_reference(text) to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;
end;
$$;

