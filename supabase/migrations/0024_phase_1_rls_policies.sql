-- 0024 — Phase 1 RLS policies
--
-- Recreates every Phase 0 policy against the new module.resource.action permission codes and
-- adds policies for the Phase 1 tables. Default posture remains deny.

alter table public.employee_positions enable row level security;
alter table public.employee_department_history enable row level security;
alter table public.employee_emergency_contacts enable row level security;
alter table public.approval_authorities enable row level security;
alter table public.approval_delegations enable row level security;
alter table public.segregation_of_duties_rules enable row level security;
alter table public.sod_overrides enable row level security;
alter table public.access_review_records enable row level security;
alter table public.account_activity enable row level security;

-- ---------------------------------------------------------------- departments
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists departments_manage on public.departments;
drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  for insert to authenticated
  with check (private.has_permission('employees.department.create'));

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update to authenticated
  using (private.has_permission('employees.department.update'))
  with check (private.has_permission('employees.department.update'));

-- ---------------------------------------------------------------- employees
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    private.has_permission('employees.employee.view')
    or (private.is_active_profile() and id = private.current_employee_id())
  );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (private.has_permission('employees.employee.create'));

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (private.has_permission('employees.employee.update'))
  with check (private.has_permission('employees.employee.update'));

-- ---------------------------------------------------------------- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or private.has_permission('access.accounts.view')
    or private.has_permission('access.assignments.view')
    or private.has_permission('employees.employee.view')
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (
    private.has_permission('access.accounts.activate')
    or private.has_permission('access.accounts.suspend')
    or private.has_permission('access.accounts.deactivate')
    or private.has_permission('access.assignments.manage')
  )
  with check (
    private.has_permission('access.accounts.activate')
    or private.has_permission('access.accounts.suspend')
    or private.has_permission('access.accounts.deactivate')
    or private.has_permission('access.assignments.manage')
  );

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (private.has_permission('access.accounts.invite'));

-- ---------------------------------------------------------------- roles & permissions
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists roles_manage on public.roles;
drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (private.has_permission('access.roles.create'));

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (private.has_permission('access.roles.update'))
  with check (private.has_permission('access.roles.update'));

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (private.has_permission('access.roles.update'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists permissions_manage on public.permissions;
create policy permissions_manage on public.permissions
  for update to authenticated
  using (private.has_permission('access.permissions.manage'))
  with check (private.has_permission('access.permissions.manage'));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists role_permissions_manage on public.role_permissions;
create policy role_permissions_manage on public.role_permissions
  for all to authenticated
  using (private.has_permission('access.permissions.manage'))
  with check (private.has_permission('access.permissions.manage'));

-- ---------------------------------------------------------------- user_roles
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or private.has_permission('access.assignments.view'));

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (private.has_permission('access.roles.assign') and user_id <> auth.uid());

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles
  for update to authenticated
  using (private.has_permission('access.roles.assign') and user_id <> auth.uid())
  with check (private.has_permission('access.roles.assign') and user_id <> auth.uid());

-- ---------------------------------------------------------------- approval_limits (Phase 0)
drop policy if exists approval_limits_select on public.approval_limits;
create policy approval_limits_select on public.approval_limits
  for select to authenticated
  using (user_id = auth.uid() or private.has_permission('access.assignments.manage'));

drop policy if exists approval_limits_manage on public.approval_limits;
create policy approval_limits_manage on public.approval_limits
  for all to authenticated
  using (private.has_permission('access.assignments.manage'))
  with check (private.has_permission('access.assignments.manage'));

-- ---------------------------------------------------------------- audit_logs
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (private.has_permission('governance.audit.view'));

-- ---------------------------------------------------------------- system_settings
drop policy if exists system_settings_select on public.system_settings;
create policy system_settings_select on public.system_settings
  for select to authenticated
  using (private.has_permission('settings.system.view') and not is_sensitive);

drop policy if exists system_settings_update on public.system_settings;
create policy system_settings_update on public.system_settings
  for update to authenticated
  using (private.has_permission('settings.system.manage'))
  with check (private.has_permission('settings.system.manage'));

-- ---------------------------------------------------------------- employee_positions
drop policy if exists employee_positions_select on public.employee_positions;
create policy employee_positions_select on public.employee_positions
  for select to authenticated
  using (private.is_active_profile());

drop policy if exists employee_positions_insert on public.employee_positions;
create policy employee_positions_insert on public.employee_positions
  for insert to authenticated
  with check (private.has_permission('employees.position.create'));

drop policy if exists employee_positions_update on public.employee_positions;
create policy employee_positions_update on public.employee_positions
  for update to authenticated
  using (private.has_permission('employees.position.update'))
  with check (private.has_permission('employees.position.update'));

-- ---------------------------------------------------------------- employee_department_history
drop policy if exists employee_history_select on public.employee_department_history;
create policy employee_history_select on public.employee_department_history
  for select to authenticated
  using (
    private.has_permission('employees.history.view')
    or private.has_permission('employees.employee.view')
  );

-- No write policies: history is written only by the trusted trigger.

-- ---------------------------------------------------------------- employee_emergency_contacts
drop policy if exists employee_emergency_contacts_select on public.employee_emergency_contacts;
create policy employee_emergency_contacts_select on public.employee_emergency_contacts
  for select to authenticated
  using (
    private.has_permission('employees.employee.update')
    or private.has_permission('governance.audit.view')
  );

drop policy if exists employee_emergency_contacts_write on public.employee_emergency_contacts;
create policy employee_emergency_contacts_write on public.employee_emergency_contacts
  for all to authenticated
  using (private.has_permission('employees.employee.update'))
  with check (private.has_permission('employees.employee.update'));

-- ---------------------------------------------------------------- approval_authorities
drop policy if exists approval_authorities_select on public.approval_authorities;
create policy approval_authorities_select on public.approval_authorities
  for select to authenticated
  using (
    private.has_permission('governance.approvals.view')
    or employee_id = private.current_employee_id()
  );

drop policy if exists approval_authorities_manage on public.approval_authorities;
create policy approval_authorities_manage on public.approval_authorities
  for all to authenticated
  using (private.has_permission('governance.approvals.configure'))
  with check (private.has_permission('governance.approvals.configure'));

-- ---------------------------------------------------------------- approval_delegations
drop policy if exists approval_delegations_select on public.approval_delegations;
create policy approval_delegations_select on public.approval_delegations
  for select to authenticated
  using (
    private.has_permission('governance.delegations.view')
    or delegator_employee_id = private.current_employee_id()
    or delegate_employee_id = private.current_employee_id()
  );

drop policy if exists approval_delegations_insert on public.approval_delegations;
create policy approval_delegations_insert on public.approval_delegations
  for insert to authenticated
  with check (private.has_permission('governance.delegations.configure'));

drop policy if exists approval_delegations_update on public.approval_delegations;
create policy approval_delegations_update on public.approval_delegations
  for update to authenticated
  using (
    private.has_permission('governance.delegations.configure')
    or private.has_permission('governance.delegations.approve')
    or private.has_permission('governance.delegations.revoke')
  )
  with check (
    private.has_permission('governance.delegations.configure')
    or private.has_permission('governance.delegations.approve')
    or private.has_permission('governance.delegations.revoke')
  );

-- ---------------------------------------------------------------- segregation of duties
drop policy if exists sod_rules_select on public.segregation_of_duties_rules;
create policy sod_rules_select on public.segregation_of_duties_rules
  for select to authenticated
  using (
    private.has_permission('governance.sod.view')
    or private.has_permission('governance.approvals.view')
  );

drop policy if exists sod_rules_manage on public.segregation_of_duties_rules;
create policy sod_rules_manage on public.segregation_of_duties_rules
  for all to authenticated
  using (private.has_permission('governance.sod.configure'))
  with check (private.has_permission('governance.sod.configure'));

drop policy if exists sod_overrides_select on public.sod_overrides;
create policy sod_overrides_select on public.sod_overrides
  for select to authenticated
  using (private.has_permission('governance.sod.view'));

drop policy if exists sod_overrides_manage on public.sod_overrides;
create policy sod_overrides_manage on public.sod_overrides
  for all to authenticated
  using (private.has_permission('governance.sod.configure'))
  with check (private.has_permission('governance.sod.configure'));

-- ---------------------------------------------------------------- access reviews
drop policy if exists access_reviews_select on public.access_review_records;
create policy access_reviews_select on public.access_review_records
  for select to authenticated
  using (private.has_permission('governance.reviews.view'));

drop policy if exists access_reviews_manage on public.access_review_records;
create policy access_reviews_manage on public.access_review_records
  for all to authenticated
  using (private.has_permission('governance.reviews.manage'))
  with check (private.has_permission('governance.reviews.manage'));

-- ---------------------------------------------------------------- account_activity
drop policy if exists account_activity_select on public.account_activity;
create policy account_activity_select on public.account_activity
  for select to authenticated
  using (user_id = auth.uid() or private.has_permission('access.accounts.view'));

-- No write policies: written only by the trusted server-side service.
