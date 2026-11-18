-- 0009 — security helper functions
--
-- All helpers are SECURITY DEFINER with a fixed search_path so that RLS policies can consult
-- authorization tables without recursive policy evaluation. They are read-only, expose no
-- row data, and are executable only by the `authenticated` role.

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
  limit 1;
$$;

create or replace function private.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.current_profile_id() is not null;
$$;

create or replace function private.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    private.is_active_profile()
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r
        on r.id = ur.role_id
       and r.is_active
      join public.role_permissions rp
        on rp.role_id = r.id
      join public.permissions p
        on p.id = rp.permission_id
      where ur.user_id = auth.uid()
        and ur.is_active
        and (ur.expires_at is null or ur.expires_at > now())
        and p.code = permission_code
    ),
    false
  );
$$;

create or replace function private.has_role(role_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    private.is_active_profile()
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r
        on r.id = ur.role_id
       and r.is_active
      where ur.user_id = auth.uid()
        and ur.is_active
        and (ur.expires_at is null or ur.expires_at > now())
        and r.code = role_code
    ),
    false
  );
$$;

create or replace function private.current_user_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct p.code order by p.code), array[]::text[])
  from public.user_roles ur
  join public.roles r
    on r.id = ur.role_id
   and r.is_active
  join public.role_permissions rp
    on rp.role_id = r.id
  join public.permissions p
    on p.id = rp.permission_id
  where ur.user_id = auth.uid()
    and ur.is_active
    and (ur.expires_at is null or ur.expires_at > now())
    and private.is_active_profile();
$$;

-- Public, read-only wrappers used by the application and by tests.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.current_profile_id(); $$;

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.is_active_profile(); $$;

create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.has_permission(permission_code); $$;

create or replace function public.has_role(role_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.has_role(role_code); $$;

create or replace function public.current_user_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.current_user_permissions(); $$;

revoke all on function private.current_profile_id() from public;
revoke all on function private.is_active_profile() from public;
revoke all on function private.has_permission(text) from public;
revoke all on function private.has_role(text) from public;
revoke all on function private.current_user_permissions() from public;

revoke all on function public.current_profile_id() from public;
revoke all on function public.is_active_profile() from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.has_role(text) from public;
revoke all on function public.current_user_permissions() from public;

-- Guard: non-administrators cannot change privileged columns on their own profile row,
-- even if a future policy is widened. Runs for every role except service-role sessions
-- (which carry no auth.uid()).
create or replace function private.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not private.has_permission('users.manage') then
    new.employee_id := old.employee_id;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function private.guard_profile_privileged_columns();
