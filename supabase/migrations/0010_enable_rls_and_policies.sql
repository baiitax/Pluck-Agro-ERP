-- 0010 — Row Level Security
--
-- Every table exposed to the Supabase API has RLS enabled and explicit policies.
-- Default posture: deny. Access requires both an active ERP profile and the relevant
-- permission. Application-level checks (services/authorization) are a second, independent
-- layer — neither layer is trusted alone.

alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.approval_limits enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

-- ---------------------------------------------------------------- departments
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists departments_manage on public.departments;
create policy departments_manage on public.departments
  for all to authenticated
  using (private.has_permission('departments.manage'))
  with check (private.has_permission('departments.manage'));

-- ---------------------------------------------------------------- employees
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    private.has_permission('employees.view')
    or (
      private.is_active_profile()
      and id = (select p.employee_id from public.profiles p where p.id = auth.uid())
    )
  );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (private.has_permission('employees.create'));

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (private.has_permission('employees.update'))
  with check (private.has_permission('employees.update'));

-- No delete policy: employee records are never hard-deleted through the API.

-- ---------------------------------------------------------------- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or private.has_permission('users.view')
    or private.has_permission('employees.view')
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (private.has_permission('users.manage'))
  with check (private.has_permission('users.manage'));

-- Profile creation is a provisioning operation performed by a trusted server path.
drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (private.has_permission('users.manage'));

-- ---------------------------------------------------------------- roles / permissions
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists roles_manage on public.roles;
create policy roles_manage on public.roles
  for all to authenticated
  using (private.has_permission('roles.manage'))
  with check (private.has_permission('roles.manage'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists permissions_manage on public.permissions;
create policy permissions_manage on public.permissions
  for update to authenticated
  using (private.has_permission('roles.manage'))
  with check (private.has_permission('roles.manage'));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists role_permissions_manage on public.role_permissions;
create policy role_permissions_manage on public.role_permissions
  for all to authenticated
  using (private.has_permission('roles.manage'))
  with check (private.has_permission('roles.manage'));

-- ---------------------------------------------------------------- user_roles
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    (user_id = auth.uid() and private.is_active_profile())
    or private.has_permission('users.manage')
  );

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (private.has_permission('users.manage') and user_id <> auth.uid());

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles
  for update to authenticated
  using (private.has_permission('users.manage') and user_id <> auth.uid())
  with check (private.has_permission('users.manage') and user_id <> auth.uid());

-- No delete policy: assignments are revoked (is_active = false), never deleted.

-- ---------------------------------------------------------------- approval_limits
drop policy if exists approval_limits_select on public.approval_limits;
create policy approval_limits_select on public.approval_limits
  for select to authenticated
  using (
    (user_id = auth.uid() and private.is_active_profile())
    or private.has_permission('users.manage')
  );

drop policy if exists approval_limits_manage on public.approval_limits;
create policy approval_limits_manage on public.approval_limits
  for all to authenticated
  using (private.has_permission('users.manage'))
  with check (private.has_permission('users.manage'));

-- ---------------------------------------------------------------- audit_logs
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.has_permission('audit.view'));

-- Intentionally no insert/update/delete policies. Writes use a trusted server path.

-- ---------------------------------------------------------------- system_settings
drop policy if exists system_settings_select on public.system_settings;
create policy system_settings_select on public.system_settings
  for select to authenticated
  using (private.has_permission('settings.view') and not is_sensitive);

drop policy if exists system_settings_update on public.system_settings;
create policy system_settings_update on public.system_settings
  for update to authenticated
  using (private.has_permission('settings.manage'))
  with check (private.has_permission('settings.manage'));
