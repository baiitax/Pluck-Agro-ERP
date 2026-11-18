-- 0015 — permission scheme v2 (module.resource.action) with permission scopes
--
-- Phase 0 used two-segment codes (module.action). Phase 1 adopts the granular
-- module.resource.action scheme and adds scope-aware grants.
--
-- Existing permission rows are replaced by the Phase 1 seed (0025). Role → permission grants
-- cascade away with them and are re-created by 0027. No live deployment existed at the time of
-- this migration, so this is a controlled re-scheme rather than a data migration.

alter table public.permissions drop constraint if exists permissions_module_action_unique;
alter table public.permissions drop constraint if exists permissions_code_matches_parts;
alter table public.permissions drop constraint if exists permissions_code_format;
alter table public.permissions drop constraint if exists permissions_action_check;

alter table public.permissions add column if not exists resource text;

-- Clear legacy catalogue; role_permissions rows cascade (FK on delete cascade).
delete from public.permissions;

alter table public.permissions alter column resource set not null;

alter table public.permissions
  add constraint permissions_code_format
    check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$'),
  add constraint permissions_code_matches_parts
    check (code = module || '.' || resource || '.' || action),
  add constraint permissions_module_resource_action_unique unique (module, resource, action),
  add constraint permissions_action_check
    check (action in (
      'view', 'create', 'update', 'delete', 'submit', 'approve', 'reject', 'cancel',
      'export', 'print', 'manage', 'configure', 'post', 'adjust', 'deactivate',
      'invite', 'activate', 'suspend', 'revoke', 'assign'
    ));

comment on column public.permissions.resource is 'Resource within the module, e.g. employee, department, roles.';

-- ---------------------------------------------------------------------------
-- Permission scopes
-- ---------------------------------------------------------------------------
alter table public.role_permissions
  add column if not exists scope_type text not null default 'GLOBAL';

alter table public.role_permissions
  add constraint role_permissions_scope_type_check
    check (scope_type in ('GLOBAL', 'DEPARTMENT', 'OWN_RECORDS', 'ASSIGNED_RECORDS', 'LOCATION', 'WAREHOUSE', 'ENTITY'));

create index if not exists role_permissions_scope_idx on public.role_permissions (scope_type);

-- ---------------------------------------------------------------------------
-- Scope-aware authorization helpers
-- ---------------------------------------------------------------------------

-- Global permission check: only GLOBAL-scoped grants satisfy it, so a department-scoped
-- grant can never leak into an organisation-wide decision.
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
      join public.roles r on r.id = ur.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id = auth.uid()
        and ur.is_active
        and (ur.expires_at is null or ur.expires_at > now())
        and p.code = permission_code
        and rp.scope_type = 'GLOBAL'
    ),
    false
  );
$$;

-- Scoped permission check for a specific department. Grants with scope DEPARTMENT satisfy the
-- check only for the caller's own department (foundation for Phase 2+ departmental rules).
create or replace function private.has_scoped_permission(permission_code text, target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    private.is_active_profile()
    and (
      private.has_permission(permission_code)
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id and r.is_active
        join public.role_permissions rp on rp.role_id = r.id
        join public.permissions p on p.id = rp.permission_id
        join public.profiles pr on pr.id = ur.user_id
        join public.employees e on e.id = pr.employee_id
        where ur.user_id = auth.uid()
          and ur.is_active
          and (ur.expires_at is null or ur.expires_at > now())
          and p.code = permission_code
          and rp.scope_type = 'DEPARTMENT'
          and target_department_id is not null
          and e.department_id = target_department_id
      )
    ),
    false
  );
$$;

-- Current user's employee id, used by self-service and delegation checks.
create or replace function private.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.employee_id
  from public.profiles p
  where p.id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.has_scoped_permission(permission_code text, target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.has_scoped_permission(permission_code, target_department_id); $$;

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select private.current_employee_id(); $$;

revoke all on function private.has_scoped_permission(text, uuid) from public;
revoke all on function private.current_employee_id() from public;
revoke all on function public.has_scoped_permission(text, uuid) from public;
revoke all on function public.current_employee_id() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.has_scoped_permission(text, uuid) to authenticated';
    execute 'grant execute on function public.current_employee_id() to authenticated';
    execute 'grant execute on function private.has_scoped_permission(text, uuid) to authenticated';
    execute 'grant execute on function private.current_employee_id() to authenticated';
  end if;
end;
$$;
