-- 0066 — seed Phase 4 inventory and production role → permission grants
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- All seeded grants are GLOBAL-scoped. Department-scoped grants are an administrative action
-- performed through the permission matrix and are preserved by this seed.
-- These are suggested mappings for management review. They grant the ability to post and approve stock movements; they do not grant approval authority over money, which remains an approval_authorities row.

-- private.seed_role_permissions() is defined by 0027 and reused here.

select private.seed_role_permissions(
  'super_administrator',
  array[
    'inventory.dashboard.view',
    'inventory.stock.view',
    'inventory.stock.post',
    'inventory.stock.manage',
    'inventory.lot.view',
    'inventory.lot.create',
    'inventory.transfer.view',
    'inventory.transfer.create',
    'inventory.transfer.approve',
    'inventory.transfer.execute',
    'inventory.count.view',
    'inventory.count.execute',
    'inventory.count.approve',
    'inventory.adjustment.view',
    'inventory.adjustment.create',
    'inventory.adjustment.approve',
    'inventory.reservation.view',
    'inventory.reservation.manage',
    'inventory.reservation.release',
    'inventory.restriction.view',
    'inventory.restriction.manage',
    'inventory.restriction.release',
    'inventory.reports.view',
    'inventory.reports.export',
    'inventory.legacy.view',
    'inventory.legacy.manage',
    'production.dashboard.view',
    'production.order.view',
    'production.plan.view',
    'production.plan.create',
    'production.plan.approve',
    'production.plan.execute',
    'production.batch.view',
    'production.batch.create',
    'production.batch.execute',
    'production.batch.close',
    'production.product.view',
    'production.product.manage',
    'production.reports.view',
    'production.reports.export',
    'production.legacy.view'
  ]::text[]
);

select private.seed_role_permissions(
  'system_administrator',
  array[
    'production.order.view',
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'managing_director',
  array[
    'inventory.dashboard.view',
    'inventory.transfer.view',
    'inventory.transfer.approve',
    'inventory.count.view',
    'inventory.count.approve',
    'inventory.adjustment.view',
    'inventory.adjustment.approve',
    'inventory.restriction.view',
    'inventory.restriction.release',
    'inventory.reports.view',
    'production.dashboard.view',
    'production.plan.view',
    'production.plan.approve',
    'production.batch.view',
    'production.reports.view',
    'production.order.view',
    'production.plan.approve',
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'general_manager',
  array[
    'inventory.dashboard.view',
    'inventory.transfer.view',
    'inventory.transfer.approve',
    'inventory.count.view',
    'inventory.count.approve',
    'inventory.adjustment.view',
    'inventory.adjustment.approve',
    'inventory.restriction.view',
    'inventory.restriction.release',
    'inventory.reports.view',
    'production.dashboard.view',
    'production.plan.view',
    'production.plan.approve',
    'production.batch.view',
    'production.reports.view',
    'production.order.view',
    'production.plan.approve',
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'management_officer',
  array[
    'production.order.view',
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'procurement_officer',
  array[
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'storekeeper',
  array[
    'inventory.dashboard.view',
    'inventory.stock.view',
    'inventory.stock.post',
    'inventory.lot.view',
    'inventory.lot.create',
    'inventory.transfer.view',
    'inventory.transfer.create',
    'inventory.transfer.execute',
    'inventory.count.view',
    'inventory.count.execute',
    'inventory.adjustment.view',
    'inventory.adjustment.create',
    'inventory.reservation.view',
    'inventory.reservation.manage',
    'inventory.restriction.view',
    'inventory.restriction.manage',
    'inventory.reports.view'
  ]::text[]
);

select private.seed_role_permissions(
  'factory_operator',
  array[
    'production.dashboard.view',
    'production.order.view',
    'production.plan.view',
    'production.batch.view',
    'production.batch.create',
    'production.batch.execute',
    'production.product.view',
    'inventory.stock.view',
    'inventory.lot.view',
    'inventory.transfer.view'
  ]::text[]
);

select private.seed_role_permissions(
  'factory_supervisor',
  array[
    'production.dashboard.view',
    'production.order.view',
    'production.plan.view',
    'production.plan.create',
    'production.plan.approve',
    'production.plan.execute',
    'production.batch.view',
    'production.batch.create',
    'production.batch.execute',
    'production.batch.close',
    'production.product.view',
    'production.reports.view',
    'inventory.stock.view',
    'inventory.lot.view',
    'inventory.transfer.view',
    'inventory.transfer.create',
    'inventory.reservation.view',
    'inventory.restriction.view'
  ]::text[]
);

select private.seed_role_permissions(
  'quality_control_officer',
  array[
    'production.order.view',
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'sales_officer',
  array[
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'logistics_officer',
  array[
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'finance_manager',
  array[
    'inventory.stock.view'
  ]::text[]
);

select private.seed_role_permissions(
  'auditor',
  array[
    'inventory.dashboard.view',
    'inventory.stock.view',
    'inventory.lot.view',
    'inventory.transfer.view',
    'inventory.count.view',
    'inventory.adjustment.view',
    'inventory.reservation.view',
    'inventory.restriction.view',
    'inventory.reports.view',
    'inventory.legacy.view',
    'production.dashboard.view',
    'production.order.view',
    'production.plan.view',
    'production.batch.view',
    'production.product.view',
    'production.reports.view',
    'production.legacy.view'
  ]::text[]
);

-- Remove globally-scoped grants inside this slice that the catalogue no longer declares.
-- Grants outside the slice, and all department-scoped grants, are left untouched.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.is_system_role
  and rp.scope_type = 'GLOBAL'
  and p.code = any (array[
   'inventory.dashboard.view',
   'inventory.stock.view',
   'inventory.stock.post',
   'inventory.stock.manage',
   'inventory.lot.view',
   'inventory.lot.create',
   'inventory.transfer.view',
   'inventory.transfer.create',
   'inventory.transfer.approve',
   'inventory.transfer.execute',
   'inventory.count.view',
   'inventory.count.execute',
   'inventory.count.approve',
   'inventory.adjustment.view',
   'inventory.adjustment.create',
   'inventory.adjustment.approve',
   'inventory.reservation.view',
   'inventory.reservation.manage',
   'inventory.reservation.release',
   'inventory.restriction.view',
   'inventory.restriction.manage',
   'inventory.restriction.release',
   'inventory.reports.view',
   'inventory.reports.export',
   'inventory.legacy.view',
   'inventory.legacy.manage',
   'production.dashboard.view',
   'production.order.view',
   'production.plan.view',
   'production.plan.create',
   'production.plan.approve',
   'production.plan.execute',
   'production.batch.view',
   'production.batch.create',
   'production.batch.execute',
   'production.batch.close',
   'production.product.view',
   'production.product.manage',
   'production.reports.view',
   'production.reports.export',
   'production.legacy.view'
 ]::text[])
  and not exists (
    select 1
    from (values
        ('super_administrator', 'inventory.dashboard.view'),
        ('super_administrator', 'inventory.stock.view'),
        ('super_administrator', 'inventory.stock.post'),
        ('super_administrator', 'inventory.stock.manage'),
        ('super_administrator', 'inventory.lot.view'),
        ('super_administrator', 'inventory.lot.create'),
        ('super_administrator', 'inventory.transfer.view'),
        ('super_administrator', 'inventory.transfer.create'),
        ('super_administrator', 'inventory.transfer.approve'),
        ('super_administrator', 'inventory.transfer.execute'),
        ('super_administrator', 'inventory.count.view'),
        ('super_administrator', 'inventory.count.execute'),
        ('super_administrator', 'inventory.count.approve'),
        ('super_administrator', 'inventory.adjustment.view'),
        ('super_administrator', 'inventory.adjustment.create'),
        ('super_administrator', 'inventory.adjustment.approve'),
        ('super_administrator', 'inventory.reservation.view'),
        ('super_administrator', 'inventory.reservation.manage'),
        ('super_administrator', 'inventory.reservation.release'),
        ('super_administrator', 'inventory.restriction.view'),
        ('super_administrator', 'inventory.restriction.manage'),
        ('super_administrator', 'inventory.restriction.release'),
        ('super_administrator', 'inventory.reports.view'),
        ('super_administrator', 'inventory.reports.export'),
        ('super_administrator', 'inventory.legacy.view'),
        ('super_administrator', 'inventory.legacy.manage'),
        ('super_administrator', 'production.dashboard.view'),
        ('super_administrator', 'production.order.view'),
        ('super_administrator', 'production.plan.view'),
        ('super_administrator', 'production.plan.create'),
        ('super_administrator', 'production.plan.approve'),
        ('super_administrator', 'production.plan.execute'),
        ('super_administrator', 'production.batch.view'),
        ('super_administrator', 'production.batch.create'),
        ('super_administrator', 'production.batch.execute'),
        ('super_administrator', 'production.batch.close'),
        ('super_administrator', 'production.product.view'),
        ('super_administrator', 'production.product.manage'),
        ('super_administrator', 'production.reports.view'),
        ('super_administrator', 'production.reports.export'),
        ('super_administrator', 'production.legacy.view'),
        ('system_administrator', 'production.order.view'),
        ('system_administrator', 'inventory.stock.view'),
        ('managing_director', 'inventory.dashboard.view'),
        ('managing_director', 'inventory.transfer.view'),
        ('managing_director', 'inventory.transfer.approve'),
        ('managing_director', 'inventory.count.view'),
        ('managing_director', 'inventory.count.approve'),
        ('managing_director', 'inventory.adjustment.view'),
        ('managing_director', 'inventory.adjustment.approve'),
        ('managing_director', 'inventory.restriction.view'),
        ('managing_director', 'inventory.restriction.release'),
        ('managing_director', 'inventory.reports.view'),
        ('managing_director', 'production.dashboard.view'),
        ('managing_director', 'production.plan.view'),
        ('managing_director', 'production.plan.approve'),
        ('managing_director', 'production.batch.view'),
        ('managing_director', 'production.reports.view'),
        ('managing_director', 'production.order.view'),
        ('managing_director', 'production.plan.approve'),
        ('managing_director', 'inventory.stock.view'),
        ('general_manager', 'inventory.dashboard.view'),
        ('general_manager', 'inventory.transfer.view'),
        ('general_manager', 'inventory.transfer.approve'),
        ('general_manager', 'inventory.count.view'),
        ('general_manager', 'inventory.count.approve'),
        ('general_manager', 'inventory.adjustment.view'),
        ('general_manager', 'inventory.adjustment.approve'),
        ('general_manager', 'inventory.restriction.view'),
        ('general_manager', 'inventory.restriction.release'),
        ('general_manager', 'inventory.reports.view'),
        ('general_manager', 'production.dashboard.view'),
        ('general_manager', 'production.plan.view'),
        ('general_manager', 'production.plan.approve'),
        ('general_manager', 'production.batch.view'),
        ('general_manager', 'production.reports.view'),
        ('general_manager', 'production.order.view'),
        ('general_manager', 'production.plan.approve'),
        ('general_manager', 'inventory.stock.view'),
        ('management_officer', 'production.order.view'),
        ('management_officer', 'inventory.stock.view'),
        ('procurement_officer', 'inventory.stock.view'),
        ('storekeeper', 'inventory.dashboard.view'),
        ('storekeeper', 'inventory.stock.view'),
        ('storekeeper', 'inventory.stock.post'),
        ('storekeeper', 'inventory.lot.view'),
        ('storekeeper', 'inventory.lot.create'),
        ('storekeeper', 'inventory.transfer.view'),
        ('storekeeper', 'inventory.transfer.create'),
        ('storekeeper', 'inventory.transfer.execute'),
        ('storekeeper', 'inventory.count.view'),
        ('storekeeper', 'inventory.count.execute'),
        ('storekeeper', 'inventory.adjustment.view'),
        ('storekeeper', 'inventory.adjustment.create'),
        ('storekeeper', 'inventory.reservation.view'),
        ('storekeeper', 'inventory.reservation.manage'),
        ('storekeeper', 'inventory.restriction.view'),
        ('storekeeper', 'inventory.restriction.manage'),
        ('storekeeper', 'inventory.reports.view'),
        ('factory_operator', 'production.dashboard.view'),
        ('factory_operator', 'production.order.view'),
        ('factory_operator', 'production.plan.view'),
        ('factory_operator', 'production.batch.view'),
        ('factory_operator', 'production.batch.create'),
        ('factory_operator', 'production.batch.execute'),
        ('factory_operator', 'production.product.view'),
        ('factory_operator', 'inventory.stock.view'),
        ('factory_operator', 'inventory.lot.view'),
        ('factory_operator', 'inventory.transfer.view'),
        ('factory_supervisor', 'production.dashboard.view'),
        ('factory_supervisor', 'production.order.view'),
        ('factory_supervisor', 'production.plan.view'),
        ('factory_supervisor', 'production.plan.create'),
        ('factory_supervisor', 'production.plan.approve'),
        ('factory_supervisor', 'production.plan.execute'),
        ('factory_supervisor', 'production.batch.view'),
        ('factory_supervisor', 'production.batch.create'),
        ('factory_supervisor', 'production.batch.execute'),
        ('factory_supervisor', 'production.batch.close'),
        ('factory_supervisor', 'production.product.view'),
        ('factory_supervisor', 'production.reports.view'),
        ('factory_supervisor', 'inventory.stock.view'),
        ('factory_supervisor', 'inventory.lot.view'),
        ('factory_supervisor', 'inventory.transfer.view'),
        ('factory_supervisor', 'inventory.transfer.create'),
        ('factory_supervisor', 'inventory.reservation.view'),
        ('factory_supervisor', 'inventory.restriction.view'),
        ('quality_control_officer', 'production.order.view'),
        ('quality_control_officer', 'inventory.stock.view'),
        ('sales_officer', 'inventory.stock.view'),
        ('logistics_officer', 'inventory.stock.view'),
        ('finance_manager', 'inventory.stock.view'),
        ('auditor', 'inventory.dashboard.view'),
        ('auditor', 'inventory.stock.view'),
        ('auditor', 'inventory.lot.view'),
        ('auditor', 'inventory.transfer.view'),
        ('auditor', 'inventory.count.view'),
        ('auditor', 'inventory.adjustment.view'),
        ('auditor', 'inventory.reservation.view'),
        ('auditor', 'inventory.restriction.view'),
        ('auditor', 'inventory.reports.view'),
        ('auditor', 'inventory.legacy.view'),
        ('auditor', 'production.dashboard.view'),
        ('auditor', 'production.order.view'),
        ('auditor', 'production.plan.view'),
        ('auditor', 'production.batch.view'),
        ('auditor', 'production.product.view'),
        ('auditor', 'production.reports.view'),
        ('auditor', 'production.legacy.view')
    ) as keep(role_code, permission_code)
    where keep.role_code = r.code and keep.permission_code = p.code
  );
