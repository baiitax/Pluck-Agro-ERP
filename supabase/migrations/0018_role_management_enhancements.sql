-- 0018 — role management enhancements
-- Roles gain a category for grouping, and system roles are protected against deletion and
-- code changes.

alter table public.roles
  add column if not exists category text not null default 'custom',
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

alter table public.roles
  add constraint roles_category_check
    check (category in ('system', 'executive', 'administration', 'operations', 'commercial', 'finance', 'assurance', 'custom'));

create index if not exists roles_category_idx on public.roles (category);

create or replace function private.protect_system_role()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.is_system_role then
    raise exception 'System role % cannot be deleted; deactivate it instead', old.code
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.is_system_role and new.code <> old.code then
    raise exception 'The code of a system role cannot be changed'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists roles_protect_system_role on public.roles;
create trigger roles_protect_system_role
  before update or delete on public.roles
  for each row execute function private.protect_system_role();

-- A role that is still actively assigned cannot be deleted.
create or replace function private.protect_assigned_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_assignments int;
begin
  if tg_op = 'DELETE' then
    select count(*) into active_assignments
    from public.user_roles where role_id = old.id and is_active;

    if active_assignments > 0 then
      raise exception 'Role % is assigned to % active account(s); deactivate it instead', old.code, active_assignments
        using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists roles_protect_assigned on public.roles;
create trigger roles_protect_assigned
  before delete on public.roles
  for each row execute function private.protect_assigned_role();
