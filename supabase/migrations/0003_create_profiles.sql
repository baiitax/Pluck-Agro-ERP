-- 0003 — profiles
-- Bridges a Supabase Auth identity (auth.users) to the ERP. A profile is created only by an
-- authorised provisioning path; it never grants business permissions on its own.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade on update cascade,
  employee_id uuid references public.employees (id) on delete set null on update cascade,
  display_name text,
  avatar_url text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_employee_unique unique (employee_id),
  constraint profiles_avatar_url_scheme
    check (avatar_url is null or avatar_url ~* '^https?://')
);

create index if not exists profiles_employee_id_idx on public.profiles (employee_id);
create index if not exists profiles_is_active_idx on public.profiles (is_active);

comment on table public.profiles is 'ERP account for an authenticated Supabase user. is_active=false blocks ERP access even with a valid auth session.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();
