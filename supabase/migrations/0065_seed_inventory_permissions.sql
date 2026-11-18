-- 0065 — seed the Phase 4 inventory and production permission catalogue
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- Codes follow module.resource.action. They are controlled system data: administrators may
-- change role → permission grants, but cannot invent new permission codes at runtime.
-- Runs after 0058, which widened the permitted action vocabulary (transfer, count, reserve, release, consume, produce).

insert into public.permissions (module, resource, action, code, description)
values
  ('inventory', 'dashboard', 'view', 'inventory.dashboard.view', 'View the inventory overview'),
  ('inventory', 'stock', 'view', 'inventory.stock.view', 'View stock movements, lots and balances'),
  ('inventory', 'stock', 'post', 'inventory.stock.post', 'Post stock movements to the ledger'),
  ('inventory', 'stock', 'manage', 'inventory.stock.manage', 'Maintain lots and correct lot records'),
  ('inventory', 'lot', 'view', 'inventory.lot.view', 'View inventory lots'),
  ('inventory', 'lot', 'create', 'inventory.lot.create', 'Register inventory lots'),
  ('inventory', 'transfer', 'view', 'inventory.transfer.view', 'View stock transfers'),
  ('inventory', 'transfer', 'create', 'inventory.transfer.create', 'Raise stock transfers'),
  ('inventory', 'transfer', 'approve', 'inventory.transfer.approve', 'Approve or reject stock transfers'),
  ('inventory', 'transfer', 'execute', 'inventory.transfer.execute', 'Dispatch and receive stock transfers'),
  ('inventory', 'count', 'view', 'inventory.count.view', 'View stock counts'),
  ('inventory', 'count', 'execute', 'inventory.count.execute', 'Start and record stock counts'),
  ('inventory', 'count', 'approve', 'inventory.count.approve', 'Approve stock count variances'),
  ('inventory', 'adjustment', 'view', 'inventory.adjustment.view', 'View stock adjustments'),
  ('inventory', 'adjustment', 'create', 'inventory.adjustment.create', 'Raise stock adjustments'),
  ('inventory', 'adjustment', 'approve', 'inventory.adjustment.approve', 'Approve and post stock adjustments'),
  ('inventory', 'reservation', 'view', 'inventory.reservation.view', 'View stock reservations'),
  ('inventory', 'reservation', 'manage', 'inventory.reservation.manage', 'Reserve stock for a downstream claim'),
  ('inventory', 'reservation', 'release', 'inventory.reservation.release', 'Release stock reservations'),
  ('inventory', 'restriction', 'view', 'inventory.restriction.view', 'View availability restrictions and holds'),
  ('inventory', 'restriction', 'manage', 'inventory.restriction.manage', 'Restrict stock availability'),
  ('inventory', 'restriction', 'release', 'inventory.restriction.release', 'Release availability restrictions'),
  ('inventory', 'reports', 'view', 'inventory.reports.view', 'View inventory reports'),
  ('inventory', 'reports', 'export', 'inventory.reports.export', 'Export inventory reports'),
  ('inventory', 'legacy', 'view', 'inventory.legacy.view', 'View legacy inventory migration readiness'),
  ('inventory', 'legacy', 'manage', 'inventory.legacy.manage', 'Maintain legacy inventory mapping records'),
  ('production', 'dashboard', 'view', 'production.dashboard.view', 'View the production overview'),
  ('production', 'order', 'view', 'production.order.view', 'View production records'),
  ('production', 'plan', 'view', 'production.plan.view', 'View production plans'),
  ('production', 'plan', 'create', 'production.plan.create', 'Create production plans'),
  ('production', 'plan', 'approve', 'production.plan.approve', 'Approve production plans'),
  ('production', 'plan', 'execute', 'production.plan.execute', 'Start and progress production plans'),
  ('production', 'batch', 'view', 'production.batch.view', 'View production batches'),
  ('production', 'batch', 'create', 'production.batch.create', 'Create production batches'),
  ('production', 'batch', 'execute', 'production.batch.execute', 'Record material issues, output and daily logs'),
  ('production', 'batch', 'close', 'production.batch.close', 'Close a production batch'),
  ('production', 'product', 'view', 'production.product.view', 'View production product and process definitions'),
  ('production', 'product', 'manage', 'production.product.manage', 'Configure production stages, processes and yield rules'),
  ('production', 'reports', 'view', 'production.reports.view', 'View production reports'),
  ('production', 'reports', 'export', 'production.reports.export', 'Export production reports'),
  ('production', 'legacy', 'view', 'production.legacy.view', 'View legacy production migration readiness')
on conflict (code) do update
  set module = excluded.module,
      resource = excluded.resource,
      action = excluded.action,
      description = excluded.description;

-- Remove rows in THIS slice that are no longer catalogued (keeps seeds deterministic).
-- The slice predicate is what stops each seed from deleting the other phase's codes.
delete from public.permissions p
 where (p.code like 'inventory.%' or p.code like 'production.%')
   and p.code <> all (array[
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
 ]::text[]);
