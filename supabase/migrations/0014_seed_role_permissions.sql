-- 0014 — seed role → permission grants
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs

create or replace function private.seed_role_permissions(role_code text, permission_codes text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role_id uuid;
begin
  select id into target_role_id from public.roles where code = role_code;
  if target_role_id is null then
    raise exception 'Unknown role code: %', role_code;
  end if;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, p.id
  from public.permissions p
  where p.code = any (permission_codes)
  on conflict (role_id, permission_id) do nothing;
end;
$$;

revoke all on function private.seed_role_permissions(text, text[]) from public;

select private.seed_role_permissions(
  'super_administrator',
  array[
    'dashboard.view',
    'employees.view',
    'employees.create',
    'employees.update',
    'employees.deactivate',
    'departments.view',
    'departments.manage',
    'users.view',
    'users.manage',
    'roles.view',
    'roles.manage',
    'permissions.view',
    'audit.view',
    'settings.view',
    'settings.manage',
    'procurement.view',
    'procurement.create',
    'procurement.approve',
    'production.view',
    'production.create',
    'production.approve',
    'inventory.view',
    'inventory.adjust',
    'quality.view',
    'quality.manage',
    'sales.view',
    'sales.create',
    'sales.approve',
    'dispatch.view',
    'dispatch.approve',
    'export.view',
    'export.manage',
    'finance.view',
    'finance.post',
    'expenses.view',
    'expenses.approve',
    'treasury.view',
    'treasury.manage',
    'assets.view',
    'assets.manage',
    'reports.view',
    'documents.view',
    'documents.manage',
    'approvals.view'
  ]::text[]
);

select private.seed_role_permissions(
  'system_administrator',
  array[
    'dashboard.view',
    'employees.view',
    'employees.create',
    'employees.update',
    'employees.deactivate',
    'departments.view',
    'departments.manage',
    'users.view',
    'users.manage',
    'roles.view',
    'roles.manage',
    'permissions.view',
    'audit.view',
    'settings.view',
    'settings.manage',
    'reports.view',
    'documents.view',
    'procurement.view',
    'production.view',
    'inventory.view',
    'quality.view',
    'sales.view',
    'dispatch.view',
    'export.view',
    'finance.view',
    'expenses.view',
    'treasury.view',
    'assets.view',
    'approvals.view'
  ]::text[]
);

select private.seed_role_permissions(
  'managing_director',
  array[
    'dashboard.view',
    'employees.view',
    'departments.view',
    'users.view',
    'roles.view',
    'permissions.view',
    'audit.view',
    'settings.view',
    'procurement.view',
    'procurement.approve',
    'production.view',
    'production.approve',
    'inventory.view',
    'quality.view',
    'sales.view',
    'sales.approve',
    'dispatch.view',
    'dispatch.approve',
    'export.view',
    'finance.view',
    'expenses.view',
    'expenses.approve',
    'treasury.view',
    'assets.view',
    'reports.view',
    'documents.view',
    'approvals.view'
  ]::text[]
);

select private.seed_role_permissions(
  'general_manager',
  array[
    'dashboard.view',
    'employees.view',
    'departments.view',
    'users.view',
    'roles.view',
    'audit.view',
    'procurement.view',
    'procurement.approve',
    'production.view',
    'production.approve',
    'inventory.view',
    'quality.view',
    'sales.view',
    'sales.approve',
    'dispatch.view',
    'dispatch.approve',
    'export.view',
    'finance.view',
    'expenses.view',
    'expenses.approve',
    'treasury.view',
    'assets.view',
    'reports.view',
    'documents.view',
    'approvals.view'
  ]::text[]
);

select private.seed_role_permissions(
  'management_officer',
  array[
    'dashboard.view',
    'employees.view',
    'departments.view',
    'procurement.view',
    'production.view',
    'inventory.view',
    'quality.view',
    'sales.view',
    'dispatch.view',
    'export.view',
    'finance.view',
    'expenses.view',
    'treasury.view',
    'assets.view',
    'reports.view',
    'documents.view',
    'approvals.view'
  ]::text[]
);

select private.seed_role_permissions(
  'procurement_officer',
  array[
    'dashboard.view',
    'procurement.view',
    'procurement.create',
    'inventory.view',
    'quality.view',
    'reports.view',
    'documents.view',
    'documents.manage'
  ]::text[]
);

select private.seed_role_permissions(
  'storekeeper',
  array[
    'dashboard.view',
    'procurement.view',
    'inventory.view',
    'quality.view',
    'documents.view',
    'documents.manage',
    'reports.view'
  ]::text[]
);

select private.seed_role_permissions(
  'factory_operator',
  array[
    'dashboard.view',
    'production.view',
    'production.create',
    'inventory.view'
  ]::text[]
);

select private.seed_role_permissions(
  'factory_supervisor',
  array[
    'dashboard.view',
    'production.view',
    'production.create',
    'production.approve',
    'inventory.view',
    'quality.view',
    'reports.view',
    'documents.view'
  ]::text[]
);

select private.seed_role_permissions(
  'quality_control_officer',
  array[
    'dashboard.view',
    'quality.view',
    'quality.manage',
    'production.view',
    'inventory.view',
    'reports.view',
    'documents.view',
    'documents.manage'
  ]::text[]
);

select private.seed_role_permissions(
  'sales_officer',
  array[
    'dashboard.view',
    'sales.view',
    'sales.create',
    'inventory.view',
    'dispatch.view',
    'reports.view',
    'documents.view',
    'documents.manage'
  ]::text[]
);

select private.seed_role_permissions(
  'logistics_officer',
  array[
    'dashboard.view',
    'dispatch.view',
    'export.view',
    'export.manage',
    'inventory.view',
    'sales.view',
    'reports.view',
    'documents.view',
    'documents.manage'
  ]::text[]
);

select private.seed_role_permissions(
  'finance_officer',
  array[
    'dashboard.view',
    'finance.view',
    'expenses.view',
    'treasury.view',
    'assets.view',
    'procurement.view',
    'sales.view',
    'reports.view',
    'documents.view',
    'documents.manage'
  ]::text[]
);

select private.seed_role_permissions(
  'finance_manager',
  array[
    'dashboard.view',
    'finance.view',
    'finance.post',
    'expenses.view',
    'expenses.approve',
    'treasury.view',
    'treasury.manage',
    'assets.view',
    'assets.manage',
    'procurement.view',
    'sales.view',
    'inventory.view',
    'reports.view',
    'documents.view',
    'approvals.view'
  ]::text[]
);

select private.seed_role_permissions(
  'treasury_officer',
  array[
    'dashboard.view',
    'treasury.view',
    'treasury.manage',
    'finance.view',
    'expenses.view',
    'reports.view',
    'documents.view',
    'documents.manage'
  ]::text[]
);

select private.seed_role_permissions(
  'auditor',
  array[
    'dashboard.view',
    'employees.view',
    'departments.view',
    'users.view',
    'roles.view',
    'permissions.view',
    'audit.view',
    'settings.view',
    'procurement.view',
    'production.view',
    'inventory.view',
    'quality.view',
    'sales.view',
    'dispatch.view',
    'export.view',
    'finance.view',
    'expenses.view',
    'treasury.view',
    'assets.view',
    'reports.view',
    'documents.view',
    'approvals.view'
  ]::text[]
);

-- Remove grants that are no longer part of the catalogue (keeps seeds deterministic).
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.is_system_role
  and not (
    (r.code = 'super_administrator')
    or (r.code = 'auditor' and p.code like '%.view')
    or exists (
      select 1
      from (values
        ('system_administrator','dashboard.view'),
        ('system_administrator','employees.view'),
        ('system_administrator','employees.create'),
        ('system_administrator','employees.update'),
        ('system_administrator','employees.deactivate'),
        ('system_administrator','departments.view'),
        ('system_administrator','departments.manage'),
        ('system_administrator','users.view'),
        ('system_administrator','users.manage'),
        ('system_administrator','roles.view'),
        ('system_administrator','roles.manage'),
        ('system_administrator','permissions.view'),
        ('system_administrator','audit.view'),
        ('system_administrator','settings.view'),
        ('system_administrator','settings.manage'),
        ('system_administrator','reports.view'),
        ('system_administrator','documents.view'),
        ('system_administrator','procurement.view'),
        ('system_administrator','production.view'),
        ('system_administrator','inventory.view'),
        ('system_administrator','quality.view'),
        ('system_administrator','sales.view'),
        ('system_administrator','dispatch.view'),
        ('system_administrator','export.view'),
        ('system_administrator','finance.view'),
        ('system_administrator','expenses.view'),
        ('system_administrator','treasury.view'),
        ('system_administrator','assets.view'),
        ('system_administrator','approvals.view'),
        ('managing_director','dashboard.view'),
        ('managing_director','employees.view'),
        ('managing_director','departments.view'),
        ('managing_director','users.view'),
        ('managing_director','roles.view'),
        ('managing_director','permissions.view'),
        ('managing_director','audit.view'),
        ('managing_director','settings.view'),
        ('managing_director','procurement.view'),
        ('managing_director','procurement.approve'),
        ('managing_director','production.view'),
        ('managing_director','production.approve'),
        ('managing_director','inventory.view'),
        ('managing_director','quality.view'),
        ('managing_director','sales.view'),
        ('managing_director','sales.approve'),
        ('managing_director','dispatch.view'),
        ('managing_director','dispatch.approve'),
        ('managing_director','export.view'),
        ('managing_director','finance.view'),
        ('managing_director','expenses.view'),
        ('managing_director','expenses.approve'),
        ('managing_director','treasury.view'),
        ('managing_director','assets.view'),
        ('managing_director','reports.view'),
        ('managing_director','documents.view'),
        ('managing_director','approvals.view'),
        ('general_manager','dashboard.view'),
        ('general_manager','employees.view'),
        ('general_manager','departments.view'),
        ('general_manager','users.view'),
        ('general_manager','roles.view'),
        ('general_manager','audit.view'),
        ('general_manager','procurement.view'),
        ('general_manager','procurement.approve'),
        ('general_manager','production.view'),
        ('general_manager','production.approve'),
        ('general_manager','inventory.view'),
        ('general_manager','quality.view'),
        ('general_manager','sales.view'),
        ('general_manager','sales.approve'),
        ('general_manager','dispatch.view'),
        ('general_manager','dispatch.approve'),
        ('general_manager','export.view'),
        ('general_manager','finance.view'),
        ('general_manager','expenses.view'),
        ('general_manager','expenses.approve'),
        ('general_manager','treasury.view'),
        ('general_manager','assets.view'),
        ('general_manager','reports.view'),
        ('general_manager','documents.view'),
        ('general_manager','approvals.view'),
        ('management_officer','dashboard.view'),
        ('management_officer','employees.view'),
        ('management_officer','departments.view'),
        ('management_officer','procurement.view'),
        ('management_officer','production.view'),
        ('management_officer','inventory.view'),
        ('management_officer','quality.view'),
        ('management_officer','sales.view'),
        ('management_officer','dispatch.view'),
        ('management_officer','export.view'),
        ('management_officer','finance.view'),
        ('management_officer','expenses.view'),
        ('management_officer','treasury.view'),
        ('management_officer','assets.view'),
        ('management_officer','reports.view'),
        ('management_officer','documents.view'),
        ('management_officer','approvals.view'),
        ('procurement_officer','dashboard.view'),
        ('procurement_officer','procurement.view'),
        ('procurement_officer','procurement.create'),
        ('procurement_officer','inventory.view'),
        ('procurement_officer','quality.view'),
        ('procurement_officer','reports.view'),
        ('procurement_officer','documents.view'),
        ('procurement_officer','documents.manage'),
        ('storekeeper','dashboard.view'),
        ('storekeeper','procurement.view'),
        ('storekeeper','inventory.view'),
        ('storekeeper','quality.view'),
        ('storekeeper','documents.view'),
        ('storekeeper','documents.manage'),
        ('storekeeper','reports.view'),
        ('factory_operator','dashboard.view'),
        ('factory_operator','production.view'),
        ('factory_operator','production.create'),
        ('factory_operator','inventory.view'),
        ('factory_supervisor','dashboard.view'),
        ('factory_supervisor','production.view'),
        ('factory_supervisor','production.create'),
        ('factory_supervisor','production.approve'),
        ('factory_supervisor','inventory.view'),
        ('factory_supervisor','quality.view'),
        ('factory_supervisor','reports.view'),
        ('factory_supervisor','documents.view'),
        ('quality_control_officer','dashboard.view'),
        ('quality_control_officer','quality.view'),
        ('quality_control_officer','quality.manage'),
        ('quality_control_officer','production.view'),
        ('quality_control_officer','inventory.view'),
        ('quality_control_officer','reports.view'),
        ('quality_control_officer','documents.view'),
        ('quality_control_officer','documents.manage'),
        ('sales_officer','dashboard.view'),
        ('sales_officer','sales.view'),
        ('sales_officer','sales.create'),
        ('sales_officer','inventory.view'),
        ('sales_officer','dispatch.view'),
        ('sales_officer','reports.view'),
        ('sales_officer','documents.view'),
        ('sales_officer','documents.manage'),
        ('logistics_officer','dashboard.view'),
        ('logistics_officer','dispatch.view'),
        ('logistics_officer','export.view'),
        ('logistics_officer','export.manage'),
        ('logistics_officer','inventory.view'),
        ('logistics_officer','sales.view'),
        ('logistics_officer','reports.view'),
        ('logistics_officer','documents.view'),
        ('logistics_officer','documents.manage'),
        ('finance_officer','dashboard.view'),
        ('finance_officer','finance.view'),
        ('finance_officer','expenses.view'),
        ('finance_officer','treasury.view'),
        ('finance_officer','assets.view'),
        ('finance_officer','procurement.view'),
        ('finance_officer','sales.view'),
        ('finance_officer','reports.view'),
        ('finance_officer','documents.view'),
        ('finance_officer','documents.manage'),
        ('finance_manager','dashboard.view'),
        ('finance_manager','finance.view'),
        ('finance_manager','finance.post'),
        ('finance_manager','expenses.view'),
        ('finance_manager','expenses.approve'),
        ('finance_manager','treasury.view'),
        ('finance_manager','treasury.manage'),
        ('finance_manager','assets.view'),
        ('finance_manager','assets.manage'),
        ('finance_manager','procurement.view'),
        ('finance_manager','sales.view'),
        ('finance_manager','inventory.view'),
        ('finance_manager','reports.view'),
        ('finance_manager','documents.view'),
        ('finance_manager','approvals.view'),
        ('treasury_officer','dashboard.view'),
        ('treasury_officer','treasury.view'),
        ('treasury_officer','treasury.manage'),
        ('treasury_officer','finance.view'),
        ('treasury_officer','expenses.view'),
        ('treasury_officer','reports.view'),
        ('treasury_officer','documents.view'),
        ('treasury_officer','documents.manage')
      ) as keep(role_code, permission_code)
      where keep.role_code = r.code and keep.permission_code = p.code
    )
  );
