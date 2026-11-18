-- 0001 — departments
-- Organizational foundation. Departments are referenced by employees and, later, by
-- cost centres, approval routing and reporting scopes.

-- gen_random_uuid() is part of core PostgreSQL 13+, so no extension is required.

create schema if not exists private;
comment on schema private is 'Internal helper schema. Not exposed through the Supabase API.';

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_not_blank check (length(btrim(name)) > 0),
  constraint departments_code_not_blank check (length(btrim(code)) > 0),
  constraint departments_code_upper check (code = upper(code)),
  constraint departments_name_unique unique (name),
  constraint departments_code_unique unique (code)
);

comment on table public.departments is 'Company departments. Referenced by employees and later approval/reporting scopes.';

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function private.set_updated_at();
