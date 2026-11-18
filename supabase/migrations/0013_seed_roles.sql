-- 0013 — seed system roles
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- These are initial role templates, not fixed privilege strings. Administrators may create
-- additional roles; system roles are marked so the UI can warn before they are modified.

insert into public.roles (name, code, description, is_system_role)
values
  ('Super Administrator', 'super_administrator', 'Unrestricted system and business access. Intended for a very small number of accounts.', true),
  ('System Administrator', 'system_administrator', 'Manages ERP users, roles and configuration. Holds no business approval authority.', true),
  ('Managing Director', 'managing_director', 'Executive oversight and final business approval authority.', true),
  ('General Manager', 'general_manager', 'Cross-functional operations oversight and approvals within delegated limits.', true),
  ('Management Officer', 'management_officer', 'Management reporting and coordination support without transaction approval authority.', true),
  ('Procurement Officer', 'procurement_officer', 'Sources commodities and prepares procurement transactions for approval.', true),
  ('Storekeeper / Warehouse Officer', 'storekeeper', 'Records and reviews warehouse stock activity.', true),
  ('Factory Operator', 'factory_operator', 'Records production activity for supervisor review.', true),
  ('Factory Supervisor', 'factory_supervisor', 'Supervises production shifts and validates production records.', true),
  ('Quality Control Officer', 'quality_control_officer', 'Performs inspections and controls product release.', true),
  ('Sales / Commercial Officer', 'sales_officer', 'Manages customers and prepares sales orders for approval.', true),
  ('Logistics / Export Officer', 'logistics_officer', 'Coordinates dispatch, shipment and export documentation.', true),
  ('Finance Officer', 'finance_officer', 'Prepares financial records and reconciliations.', true),
  ('Finance Manager', 'finance_manager', 'Owns accounting policy execution, posting and financial approvals.', true),
  ('Treasury Officer', 'treasury_officer', 'Maintains bank records, payment instructions and FX data.', true),
  ('Auditor / Read-only User', 'auditor', 'Read-only access across operational and financial records, including audit history.', true)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      is_system_role = true;
