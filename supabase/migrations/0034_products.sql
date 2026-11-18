-- 0034 — product and commodity catalogue
--
-- Five separate concepts, deliberately not collapsed (spec §7):
--   product category  → products → variants/grades → specifications & typed attributes → packaging
-- A variation of a product is a variant of it, not an unrelated product. Values that matter
-- operationally (base unit, packaging net weight) are typed columns, not free text.

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  parent_category_id uuid references public.product_categories (id) on delete restrict on update cascade,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_code_unique unique (code),
  constraint product_categories_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint product_categories_name_present check (length(btrim(name)) > 1),
  constraint product_categories_not_own_parent check (parent_category_id is null or parent_category_id <> id)
);

create index if not exists product_categories_parent_idx on public.product_categories (parent_category_id, sort_order);

/** Refuses a product-category hierarchy that loops back on itself. */
create or replace function private.prevent_product_category_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cursor_id uuid := new.parent_category_id;
  depth int := 0;
begin
  if new.parent_category_id is null then
    return new;
  end if;

  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Product category hierarchy cannot contain a cycle'
        using errcode = 'check_violation';
    end if;
    depth := depth + 1;
    if depth > 32 then
      raise exception 'Product category hierarchy is too deep or already cyclic'
        using errcode = 'check_violation';
    end if;
    select parent_category_id into cursor_id from public.product_categories where id = cursor_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists product_categories_cycle_guard on public.product_categories;
create trigger product_categories_cycle_guard
  before insert or update of parent_category_id on public.product_categories
  for each row execute function private.prevent_product_category_cycle();

drop trigger if exists product_categories_set_updated_at on public.product_categories;
create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function private.set_updated_at();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  code text not null,
  name text not null,
  short_description text,
  description text,
  category_id uuid not null references public.product_categories (id) on delete restrict on update cascade,
  product_type text not null default 'raw_material',
  status text not null default 'draft',
  status_reason text,
  brand text,
  internal_reference text,
  barcode text,
  -- Units (spec §7.2 D). Base unit is mandatory; the rest are optional operational views.
  base_unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  purchase_unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  storage_unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  sales_unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  production_unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  origin text,
  processing_method text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_reference_unique unique (reference),
  constraint products_code_unique unique (code),
  constraint products_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9-]{1,15}-[0-9]{3,12}$'),
  constraint products_code_format check (code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$'),
  constraint products_name_present check (length(btrim(name)) > 1),
  constraint products_type_check
    check (product_type in ('raw_material', 'finished_good', 'semi_finished', 'by_product', 'waste',
                            'packaging', 'consumable', 'service')),
  constraint products_status_check
    check (status in ('draft', 'active', 'inactive', 'discontinued', 'archived')),
  constraint products_archived_immutable_reason check (status <> 'archived' or status_reason is not null)
);

create index if not exists products_category_idx on public.products (category_id, status);
create index if not exists products_status_idx on public.products (status);
create index if not exists products_name_idx on public.products (lower(name));
create index if not exists products_type_idx on public.products (product_type);

comment on table public.products is
  'Product master record. Only status = active may be used by future operational transactions.';

select private.install_master_triggers('public.products', 'product');

-- The base unit defines how every quantity of this product is stored. Changing it silently would
-- re-interpret history, so it is frozen as soon as the product leaves draft. A later phase that
-- has transactions to preserve must add an approved-change path; this phase refuses instead of
-- pretending the change is safe.
create or replace function private.guard_product_base_unit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.base_unit_id is distinct from old.base_unit_id and old.status <> 'draft' then
    raise exception 'The base unit of product % cannot change after it leaves draft (current status: %). Create a replacement product instead.',
      old.code, old.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists products_base_unit_guard on public.products;
create trigger products_base_unit_guard
  before update of base_unit_id on public.products
  for each row execute function private.guard_product_base_unit();

-- Now that products exist, the product-scoped conversion FK can be completed.
alter table public.unit_conversions
  drop constraint if exists unit_conversions_product_fk;
alter table public.unit_conversions
  add constraint unit_conversions_product_fk
    foreign key (product_id) references public.products (id) on delete cascade on update cascade;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  product_id uuid not null references public.products (id) on delete cascade on update cascade,
  code text not null,
  name text not null,
  grade text,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_reference_unique unique (reference),
  constraint product_variants_code_unique unique (product_id, code),
  constraint product_variants_name_present check (length(btrim(name)) > 0)
);

create index if not exists product_variants_product_idx on public.product_variants (product_id, is_active);
create unique index if not exists product_variants_default_unique_idx
  on public.product_variants (product_id) where is_default;

select private.install_master_triggers('public.product_variants', 'product_variant');

-- Typed attribute definitions (spec §7.2 C). Attributes are configured per category instead of
-- every product carrying one enormous form.
create table if not exists public.product_attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  data_type text not null,
  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  options jsonb,
  is_required boolean not null default false,
  applies_to_category_id uuid references public.product_categories (id) on delete cascade on update cascade,
  sort_order int not null default 0,
  is_active boolean not null default true,
  description text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_attribute_definitions_code_unique unique (code),
  constraint product_attribute_definitions_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint product_attribute_definitions_type_check
    check (data_type in ('text', 'number', 'boolean', 'date', 'enum')),
  constraint product_attribute_definitions_enum_options
    check (data_type <> 'enum' or (options is not null and jsonb_typeof(options) = 'array')),
  constraint product_attribute_definitions_unit_only_for_number
    check (unit_id is null or data_type = 'number')
);

create index if not exists product_attribute_definitions_category_idx
  on public.product_attribute_definitions (applies_to_category_id, sort_order);

create table if not exists public.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade on update cascade,
  variant_id uuid references public.product_variants (id) on delete cascade on update cascade,
  attribute_id uuid not null references public.product_attribute_definitions (id) on delete cascade on update cascade,
  value_text text,
  value_number numeric(24, 6),
  value_boolean boolean,
  value_date date,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_attribute_values_unique_idx
  on public.product_attribute_values (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute_id);
create index if not exists product_attribute_values_product_idx on public.product_attribute_values (product_id);

/** Keeps attribute values honest: exactly one typed column, matching the definition's data type. */
create or replace function private.validate_product_attribute_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  def_type text;
  def_options jsonb;
  provided int;
begin
  select data_type, options into def_type, def_options
    from public.product_attribute_definitions where id = new.attribute_id;

  if def_type is null then
    raise exception 'Unknown product attribute definition'
      using errcode = 'foreign_key_violation';
  end if;

  provided := num_nonnulls(new.value_text, new.value_number, new.value_boolean, new.value_date);
  if provided <> 1 then
    raise exception 'Provide exactly one value for attribute %, matching its data type %', new.attribute_id, def_type
      using errcode = 'check_violation';
  end if;

  if (def_type = 'text' and new.value_text is null)
     or (def_type = 'number' and new.value_number is null)
     or (def_type = 'boolean' and new.value_boolean is null)
     or (def_type = 'date' and new.value_date is null) then
    raise exception 'Attribute value type does not match the definition (%)', def_type
      using errcode = 'check_violation';
  end if;

  if def_type = 'enum' and (def_options is null or not (def_options ? new.value_text)) then
    raise exception 'Value is not one of the permitted options for this attribute'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists product_attribute_values_validate on public.product_attribute_values;
create trigger product_attribute_values_validate
  before insert or update on public.product_attribute_values
  for each row execute function private.validate_product_attribute_value();

-- Structured specifications for critical quality parameters (typed, with a unit).
create table if not exists public.product_specifications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade on update cascade,
  variant_id uuid references public.product_variants (id) on delete cascade on update cascade,
  name text not null,
  specification_type text not null default 'text',
  value_text text,
  value_number numeric(24, 6),
  unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  is_critical boolean not null default false,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_specifications_name_present check (length(btrim(name)) > 0),
  constraint product_specifications_type_check
    check (specification_type in ('text', 'number', 'range', 'boolean')),
  constraint product_specifications_value_present
    check (value_text is not null or value_number is not null),
  constraint product_specifications_unit_only_for_number
    check (unit_id is null or specification_type = 'number')
);

create index if not exists product_specifications_product_idx on public.product_specifications (product_id, is_critical);

create table if not exists public.product_packaging (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade on update cascade,
  variant_id uuid references public.product_variants (id) on delete cascade on update cascade,
  packaging_type text not null,
  packaging_material text,
  package_unit_id uuid not null references public.units_of_measure (id) on delete restrict on update cascade,
  net_quantity numeric(18, 4),
  gross_weight numeric(18, 4),
  quantity_unit_id uuid references public.units_of_measure (id) on delete restrict on update cascade,
  package_count int,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_packaging_type_present check (length(btrim(packaging_type)) > 0),
  constraint product_packaging_net_positive check (net_quantity is null or net_quantity > 0),
  constraint product_packaging_gross_positive check (gross_weight is null or gross_weight > 0),
  constraint product_packaging_net_requires_unit check (net_quantity is null or quantity_unit_id is not null),
  constraint product_packaging_gross_gte_net
    check (gross_weight is null or net_quantity is null or quantity_unit_id is null or gross_weight >= net_quantity),
  constraint product_packaging_count_positive check (package_count is null or package_count > 0)
);

create index if not exists product_packaging_product_idx on public.product_packaging (product_id, is_active);
create unique index if not exists product_packaging_default_unique_idx
  on public.product_packaging (product_id) where is_default;

-- Approved commodity categories per supplier (spec §5.2 D). Created here because it needs both
-- tables to exist.
create table if not exists public.supplier_product_categories (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade on update cascade,
  product_category_id uuid not null references public.product_categories (id) on delete cascade on update cascade,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supplier_product_categories_unique unique (supplier_id, product_category_id)
);

create index if not exists supplier_product_categories_category_idx
  on public.supplier_product_categories (product_category_id);
