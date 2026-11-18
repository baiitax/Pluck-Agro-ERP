-- 0082 — seed the Phase 5 quality permission catalogue
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- Codes follow module.resource.action. They are controlled system data: administrators may
-- change role → permission grants, but cannot invent new permission codes at runtime.
-- Runs after 0074, which widened the permitted action vocabulary (collect, record, hold).

insert into public.permissions (module, resource, action, code, description)
values
  ('quality', 'dashboard', 'view', 'quality.dashboard.view', 'View the quality workspace overview'),
  ('quality', 'inspection', 'view', 'quality.inspection.view', 'View quality inspections'),
  ('quality', 'inspection', 'manage', 'quality.inspection.manage', 'Create, edit and cancel quality inspections'),
  ('quality', 'inspection', 'submit', 'quality.inspection.submit', 'Submit an inspection''s results for approval'),
  ('quality', 'inspection', 'approve', 'quality.inspection.approve', 'Approve or reject submitted inspection results'),
  ('quality', 'result', 'view', 'quality.result.view', 'View recorded inspection results'),
  ('quality', 'result', 'record', 'quality.result.record', 'Record inspection results and collect samples'),
  ('quality', 'specification', 'view', 'quality.specification.view', 'View product quality specifications'),
  ('quality', 'specification', 'create', 'quality.specification.create', 'Create a new specification version'),
  ('quality', 'specification', 'update', 'quality.specification.update', 'Edit a draft specification and its limits'),
  ('quality', 'specification', 'approve', 'quality.specification.approve', 'Approve a specification version for use'),
  ('quality', 'parameter', 'view', 'quality.parameter.view', 'View the test parameter catalogue'),
  ('quality', 'parameter', 'manage', 'quality.parameter.manage', 'Maintain the test parameter catalogue'),
  ('quality', 'sampling', 'view', 'quality.sampling.view', 'View sampling plans'),
  ('quality', 'sampling', 'manage', 'quality.sampling.manage', 'Maintain sampling plans'),
  ('quality', 'disposition', 'view', 'quality.disposition.view', 'View quality dispositions and holds'),
  ('quality', 'disposition', 'record', 'quality.disposition.record', 'Record a disposition against an approved inspection'),
  ('quality', 'disposition', 'release', 'quality.disposition.release', 'Release held stock and revoke a disposition'),
  ('quality', 'disposition', 'hold', 'quality.disposition.hold', 'Place stock on quality hold'),
  ('quality', 'ncr', 'view', 'quality.ncr.view', 'View non-conformance reports'),
  ('quality', 'ncr', 'create', 'quality.ncr.create', 'Raise a non-conformance report'),
  ('quality', 'ncr', 'update', 'quality.ncr.update', 'Investigate and update a non-conformance'),
  ('quality', 'ncr', 'close', 'quality.ncr.close', 'Close or cancel a non-conformance'),
  ('quality', 'capa', 'view', 'quality.capa.view', 'View corrective and preventive actions'),
  ('quality', 'capa', 'create', 'quality.capa.create', 'Create corrective and preventive actions'),
  ('quality', 'capa', 'update', 'quality.capa.update', 'Update corrective and preventive actions'),
  ('quality', 'capa', 'verify', 'quality.capa.verify', 'Verify that a completed action was effective'),
  ('quality', 'certificate', 'view', 'quality.certificate.view', 'View certificates of analysis'),
  ('quality', 'certificate', 'issue', 'quality.certificate.issue', 'Issue, reissue and void certificates of analysis'),
  ('quality', 'certificate', 'print', 'quality.certificate.print', 'Print and export certificates of analysis'),
  ('quality', 'traceability', 'view', 'quality.traceability.view', 'View lot and batch traceability'),
  ('quality', 'reports', 'view', 'quality.reports.view', 'View quality reports'),
  ('quality', 'reports', 'export', 'quality.reports.export', 'Export quality reports')
on conflict (code) do update
  set module = excluded.module,
      resource = excluded.resource,
      action = excluded.action,
      description = excluded.description;

-- Remove rows in THIS slice that are no longer catalogued (keeps seeds deterministic).
-- The slice predicate is what stops each seed from deleting the other phase's codes.
delete from public.permissions p
 where (p.code like 'quality.%')
   and p.code <> all (array[
   'quality.dashboard.view',
   'quality.inspection.view',
   'quality.inspection.manage',
   'quality.inspection.submit',
   'quality.inspection.approve',
   'quality.result.view',
   'quality.result.record',
   'quality.specification.view',
   'quality.specification.create',
   'quality.specification.update',
   'quality.specification.approve',
   'quality.parameter.view',
   'quality.parameter.manage',
   'quality.sampling.view',
   'quality.sampling.manage',
   'quality.disposition.view',
   'quality.disposition.record',
   'quality.disposition.release',
   'quality.disposition.hold',
   'quality.ncr.view',
   'quality.ncr.create',
   'quality.ncr.update',
   'quality.ncr.close',
   'quality.capa.view',
   'quality.capa.create',
   'quality.capa.update',
   'quality.capa.verify',
   'quality.certificate.view',
   'quality.certificate.issue',
   'quality.certificate.print',
   'quality.traceability.view',
   'quality.reports.view',
   'quality.reports.export'
 ]::text[]);
