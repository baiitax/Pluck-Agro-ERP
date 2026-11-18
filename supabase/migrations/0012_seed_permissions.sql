-- 0012 — seed permission catalogue
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- Permission codes are controlled system data. Application users cannot create or delete
-- them; only authorised administrators may adjust role → permission grants.

insert into public.permissions (module, action, code, description)
values
  ('dashboard', 'view', 'dashboard.view', 'View the ERP dashboard'),
  ('employees', 'view', 'employees.view', 'View employee records'),
  ('employees', 'create', 'employees.create', 'Create employee records'),
  ('employees', 'update', 'employees.update', 'Update employee records'),
  ('employees', 'deactivate', 'employees.deactivate', 'Deactivate employee records'),
  ('departments', 'view', 'departments.view', 'View departments'),
  ('departments', 'manage', 'departments.manage', 'Create and maintain departments'),
  ('users', 'view', 'users.view', 'View ERP user accounts and access assignments'),
  ('users', 'manage', 'users.manage', 'Assign roles, activate and deactivate ERP accounts'),
  ('roles', 'view', 'roles.view', 'View roles'),
  ('roles', 'manage', 'roles.manage', 'Create and maintain roles'),
  ('permissions', 'view', 'permissions.view', 'View permission definitions'),
  ('audit', 'view', 'audit.view', 'View audit history'),
  ('settings', 'view', 'settings.view', 'View application settings'),
  ('settings', 'manage', 'settings.manage', 'Manage application settings'),
  ('procurement', 'view', 'procurement.view', 'View procurement records'),
  ('procurement', 'create', 'procurement.create', 'Create procurement records'),
  ('procurement', 'approve', 'procurement.approve', 'Approve procurement transactions'),
  ('production', 'view', 'production.view', 'View production records'),
  ('production', 'create', 'production.create', 'Create production records'),
  ('production', 'approve', 'production.approve', 'Approve production records'),
  ('inventory', 'view', 'inventory.view', 'View inventory and stock movements'),
  ('inventory', 'adjust', 'inventory.adjust', 'Post approved stock adjustments'),
  ('quality', 'view', 'quality.view', 'View quality inspections and results'),
  ('quality', 'manage', 'quality.manage', 'Record quality inspections and releases'),
  ('sales', 'view', 'sales.view', 'View sales orders'),
  ('sales', 'create', 'sales.create', 'Create sales orders'),
  ('sales', 'approve', 'sales.approve', 'Approve sales orders'),
  ('dispatch', 'view', 'dispatch.view', 'View dispatches and shipments'),
  ('dispatch', 'approve', 'dispatch.approve', 'Approve dispatches'),
  ('export', 'view', 'export.view', 'View export records and documents'),
  ('export', 'manage', 'export.manage', 'Maintain export records and documents'),
  ('finance', 'view', 'finance.view', 'View financial records and reports'),
  ('finance', 'post', 'finance.post', 'Post journal entries'),
  ('expenses', 'view', 'expenses.view', 'View expenses and imprest'),
  ('expenses', 'approve', 'expenses.approve', 'Approve expenses and imprest reconciliations'),
  ('treasury', 'view', 'treasury.view', 'View treasury and bank records'),
  ('treasury', 'manage', 'treasury.manage', 'Maintain treasury, bank and FX records'),
  ('assets', 'view', 'assets.view', 'View fixed assets and investments'),
  ('assets', 'manage', 'assets.manage', 'Maintain fixed assets and investments'),
  ('reports', 'view', 'reports.view', 'View governed reports and analytics'),
  ('documents', 'view', 'documents.view', 'View business documents'),
  ('documents', 'manage', 'documents.manage', 'Upload and maintain business documents'),
  ('approvals', 'view', 'approvals.view', 'View pending approvals')
on conflict (code) do update
  set module = excluded.module,
      action = excluded.action,
      description = excluded.description;
