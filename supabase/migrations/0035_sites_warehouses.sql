-- 0035 — business sites, warehouses and storage locations
--
-- Location master data only. There are no stock balances and no inventory movements in Phase 2:
-- a warehouse record is not evidence that stock exists, and nothing in the UI will suggest it.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  site_code text not null,
  name text not null,
  site_type text not null default 'other',
  description text,
  country text not null,
  state_region text,
  city text,
  address text,
  contact_person text,
  contact_phone text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_reference_unique unique (reference),
  constraint sites_code_unique unique (site_code),
  constraint sites_code_format check (site_code ~ '^[A-Za-z0-9][A-Za-z0-9-]{1,19}$'),
  constraint sites_name_present check (length(btrim(name)) > 1),
  constraint sites_country_present check (length(btrim(country)) > 1),
  constraint sites_type_check
    check (site_type in ('head_office', 'factory', 'warehouse', 'collection_center', 'branch',
                         'external_partner_location', 'other'))
);

create index if not exists sites_type_idx on public.sites (site_type, is_active);
create index if not exists sites_country_idx on public.sites (country);

select private.install_master_triggers('public.sites', 'site');

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  warehouse_code text not null,
  name text not null,
  description text,
  warehouse_type text not null default 'general_storage',
  site_id uuid references public.sites (id) on delete set null on update cascade,
  country text,
  state_region text,
  city text,
  address text,
  manager_employee_id uuid references public.employees (id) on delete set null,
  contact_phone text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouses_reference_unique unique (reference),
  constraint warehouses_code_unique unique (warehouse_code),
  constraint warehouses_code_format check (warehouse_code ~ '^[A-Za-z0-9][A-Za-z0-9-]{1,19}$'),
  constraint warehouses_name_present check (length(btrim(name)) > 1),
  constraint warehouses_type_check
    check (warehouse_type in ('raw_material', 'finished_goods', 'production', 'packaging', 'waste',
                              'general_storage', 'transit', 'external_storage'))
);

create index if not exists warehouses_site_idx on public.warehouses (site_id, is_active);
create index if not exists warehouses_type_idx on public.warehouses (warehouse_type);

comment on table public.warehouses is
  'Warehouse registry only. No stock balances exist in Phase 2; inventory arrives in a later phase.';

select private.install_master_triggers('public.warehouses', 'warehouse');

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade on update cascade,
  parent_location_id uuid references public.warehouse_locations (id) on delete restrict on update cascade,
  location_code text not null,
  name text not null,
  location_type text not null default 'zone',
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_locations_reference_unique unique (reference),
  constraint warehouse_locations_code_unique unique (warehouse_id, location_code),
  constraint warehouse_locations_code_format check (location_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$'),
  constraint warehouse_locations_name_present check (length(btrim(name)) > 0),
  constraint warehouse_locations_type_check
    check (location_type in ('zone', 'section', 'aisle', 'rack', 'shelf', 'bin', 'floor_area')),
  constraint warehouse_locations_not_own_parent check (parent_location_id is null or parent_location_id <> id)
);

create index if not exists warehouse_locations_warehouse_idx on public.warehouse_locations (warehouse_id, parent_location_id);

select private.install_master_triggers('public.warehouse_locations', 'warehouse_location');

/** Refuses a storage-location hierarchy that loops, and refuses parents in another warehouse. */
create or replace function private.guard_warehouse_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cursor_id uuid := new.parent_location_id;
  parent_warehouse uuid;
  depth int := 0;
begin
  if new.parent_location_id is null then
    return new;
  end if;

  select warehouse_id into parent_warehouse
    from public.warehouse_locations where id = new.parent_location_id;

  if parent_warehouse is distinct from new.warehouse_id then
    raise exception 'A storage location may only be nested inside its own warehouse'
      using errcode = 'check_violation';
  end if;

  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Storage location hierarchy cannot contain a cycle'
        using errcode = 'check_violation';
    end if;
    depth := depth + 1;
    if depth > 32 then
      raise exception 'Storage location hierarchy is too deep or already cyclic'
        using errcode = 'check_violation';
    end if;
    select parent_location_id into cursor_id from public.warehouse_locations where id = cursor_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists warehouse_locations_guard on public.warehouse_locations;
create trigger warehouse_locations_guard
  before insert or update of parent_location_id, warehouse_id on public.warehouse_locations
  for each row execute function private.guard_warehouse_location();
