-- 0026 — seed system role templates
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- These are initial templates and the *suggested* role → permission mappings for management
-- review. Administrators may create additional roles at runtime; system roles are protected
-- against deletion and code changes by trigger.

insert into public.roles (name, code, category, description, is_system_role)
values
  ('Super Administrator', 'super_administrator', 'system', 'Controlled system-wide administration. Intended for a very small number of accounts and reviewed periodically.', true),
  ('System Administrator', 'system_administrator', 'system', 'Technical administration of users, roles, permissions, configuration and audit. Holds no business approval authority.', true),
  ('Managing Director', 'managing_director', 'executive', 'Executive oversight and final business approval authority.', true),
  ('General Manager', 'general_manager', 'executive', 'Cross-functional operational oversight and approvals within delegated limits.', true),
  ('Management Officer', 'management_officer', 'executive', 'Management reporting and coordination support without transaction approval authority.', true),
  ('Procurement Officer', 'procurement_officer', 'operations', 'Sources commodities and prepares procurement transactions for approval.', true),
  ('Storekeeper / Warehouse Officer', 'storekeeper', 'operations', 'Records and reviews warehouse stock activity for assigned locations.', true),
  ('Factory Operator', 'factory_operator', 'operations', 'Records production activity for supervisor review.', true),
  ('Factory Supervisor', 'factory_supervisor', 'operations', 'Supervises production shifts and validates production records.', true),
  ('Quality Control Officer', 'quality_control_officer', 'operations', 'Performs inspections and controls product release.', true),
  ('Sales / Commercial Officer', 'sales_officer', 'commercial', 'Manages customers and prepares sales orders for approval.', true),
  ('Logistics / Export Officer', 'logistics_officer', 'commercial', 'Coordinates dispatch, shipment and export documentation.', true),
  ('Finance Officer', 'finance_officer', 'finance', 'Prepares financial records and reconciliations.', true),
  ('Finance Manager', 'finance_manager', 'finance', 'Owns accounting policy execution, posting and financial approvals. Treasury record maintenance is deliberately left to the treasury officer so the person who posts journals does not also maintain payment records.', true),
  ('Treasury Officer', 'treasury_officer', 'finance', 'Maintains bank records, payment instructions and FX data.', true),
  ('Auditor / Read-only User', 'auditor', 'assurance', 'Read-only inspection of operational, financial and governance records, including audit history.', true)
on conflict (code) do update
  set name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      is_system_role = true;
