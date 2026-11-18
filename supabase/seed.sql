-- ---------------------------------------------------------------------------
-- LOCAL DEVELOPMENT FIXTURES ONLY
--
-- This file is NOT applied to production. It exists so a fresh local database has an
-- organisational skeleton to work with. It contains no fabricated business transactions
-- and no users with credentials.
--
-- Apply with:  supabase db reset   (local only)
-- Production: departments and employees are entered through the ERP by authorised staff.
-- ---------------------------------------------------------------------------

insert into public.departments (name, code, description)
values
  ('Management', 'MGMT', 'Executive and general management'),
  ('Procurement', 'PROC', 'Commodity sourcing and supplier management'),
  ('Factory', 'FACT', 'Processing, production and quality operations'),
  ('Warehouse', 'WHSE', 'Raw material and finished goods storage'),
  ('Sales & Export', 'SLEX', 'Commercial, dispatch and export coordination'),
  ('Finance', 'FIN', 'Accounting, treasury and reporting'),
  ('Administration', 'ADMN', 'Human resources, systems and administration')
on conflict (code) do nothing;

-- No employee, profile, role assignment or auth user is seeded. Use the bootstrap script:
--   npm run admin:bootstrap -- --email you@example.com --password '...'
