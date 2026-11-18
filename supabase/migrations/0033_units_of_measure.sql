-- 0033 — units of measurement and conversion rules
--
-- Why this is load-bearing: procurement may buy in tonnes, the factory may consume kilograms,
-- and export may ship bags. Every conversion must be explicit, effective-dated, decimal-safe and
-- attributable — never an assumption that "a bag is 25 kg".

create table if not exists public.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  symbol text,
  category text not null,
  precision int not null default 3,
  is_base_unit boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_of_measure_code_unique unique (code),
  constraint units_of_measure_code_format check (code ~ '^[A-Za-z][A-Za-z0-9²³/_-]{0,11}$'),
  constraint units_of_measure_category_check
    check (category in ('MASS', 'VOLUME', 'COUNT', 'LENGTH', 'AREA', 'TIME', 'PACKAGING', 'OTHER')),
  constraint units_of_measure_precision_range check (precision between 0 and 6),
  constraint units_of_measure_name_present check (length(btrim(name)) > 0)
);

create index if not exists units_of_measure_category_idx on public.units_of_measure (category, is_active);

comment on table public.units_of_measure is
  'Unit registry. Only active units may be assigned to products or used in new conversions.';

-- Exactly one base unit per category (kg for MASS, L for VOLUME, ...). A category with no base
-- unit is allowed (PACKAGING, OTHER) because those are counted, not converted.
create unique index if not exists units_of_measure_single_base_idx
  on public.units_of_measure (category)
  where is_base_unit;

create table if not exists public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  from_unit_id uuid not null references public.units_of_measure (id) on delete cascade on update cascade,
  to_unit_id uuid not null references public.units_of_measure (id) on delete cascade on update cascade,
  conversion_factor numeric(24, 12) not null,
  conversion_method text not null default 'multiply',
  -- NULL = a standard physical conversion valid everywhere. Set = valid only for that product
  -- (for example 1 bag = 25 kg for one packaging configuration).
  product_id uuid,
  effective_from date not null default current_date,
  effective_until date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_conversions_distinct_units check (from_unit_id <> to_unit_id),
  constraint unit_conversions_factor_positive check (conversion_factor > 0),
  constraint unit_conversions_method_check check (conversion_method in ('multiply', 'divide')),
  constraint unit_conversions_period_valid
    check (effective_until is null or effective_until >= effective_from)
);

-- One live rule per (from, to, product, start date). uuid_nil stands in for "no product" so the
-- constraint works for standard conversions too.
create unique index if not exists unit_conversions_unique_idx
  on public.unit_conversions (from_unit_id, to_unit_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);

create index if not exists unit_conversions_from_idx on public.unit_conversions (from_unit_id, is_active);
create index if not exists unit_conversions_product_idx on public.unit_conversions (product_id, is_active);

comment on table public.unit_conversions is
  'Effective-dated conversion rules. product_id NULL = standard physical conversion; product_id set = product-specific (e.g. 1 bag = 25 kg for that product only).';

/**
 * Rejects conversion rules that cannot be true.
 *
 * A standard conversion (no product) must stay inside one unit category: mass to mass, volume to
 * volume. A product-specific conversion may cross categories (packaging to mass) because that is
 * exactly what a verified bag weight is. The two units still have to be different units.
 */
create or replace function private.validate_unit_conversion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  from_category text;
  to_category text;
  from_active boolean;
  to_active boolean;
begin
  select category, is_active into from_category, from_active
    from public.units_of_measure where id = new.from_unit_id;
  select category, is_active into to_category, to_active
    from public.units_of_measure where id = new.to_unit_id;

  if from_category is null or to_category is null then
    raise exception 'Both units must exist before a conversion can be defined'
      using errcode = 'foreign_key_violation';
  end if;

  if not from_active or not to_active then
    raise exception 'Conversions may only use active units'
      using errcode = 'check_violation';
  end if;

  if new.product_id is null and from_category <> to_category then
    raise exception 'A standard % → % conversion is not meaningful. Cross-category conversions must name a product.',
      from_category, to_category
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists unit_conversions_validate on public.unit_conversions;
create trigger unit_conversions_validate
  before insert or update on public.unit_conversions
  for each row execute function private.validate_unit_conversion();

drop trigger if exists unit_conversions_set_updated_at on public.unit_conversions;
create trigger unit_conversions_set_updated_at
  before update on public.unit_conversions
  for each row execute function private.set_updated_at();
