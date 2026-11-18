-- 0083 — seed Phase 5 quality role → permission grants
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- All seeded grants are GLOBAL-scoped. Department-scoped grants are an administrative action
-- performed through the permission matrix and are preserved by this seed.
-- These are suggested mappings for management review. They deliberately separate recording a disposition from releasing stock and from approving a specification, so a single officer can inspect and decide while a second person authorises release; the setting inspection.allow_self_approval is the documented way to relax that where the site has one qualified officer.

-- private.seed_role_permissions() is defined by 0027 and reused here.

select private.seed_role_permissions(
  'super_administrator',
  array[
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
  ]::text[]
);

select private.seed_role_permissions(
  'system_administrator',
  array[
    'quality.inspection.view',
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
  ]::text[]
);

select private.seed_role_permissions(
  'managing_director',
  array[
    'quality.inspection.view',
    'quality.dashboard.view',
    'quality.disposition.view',
    'quality.disposition.release',
    'quality.specification.approve',
    'quality.certificate.view',
    'quality.certificate.print',
    'quality.traceability.view',
    'quality.reports.view',
    'quality.reports.export',
    'quality.ncr.view',
    'quality.capa.view',
    'quality.inspection.approve'
  ]::text[]
);

select private.seed_role_permissions(
  'general_manager',
  array[
    'quality.inspection.view',
    'quality.dashboard.view',
    'quality.disposition.view',
    'quality.disposition.release',
    'quality.specification.approve',
    'quality.certificate.view',
    'quality.certificate.print',
    'quality.traceability.view',
    'quality.reports.view',
    'quality.reports.export',
    'quality.ncr.view',
    'quality.ncr.close',
    'quality.capa.view',
    'quality.capa.verify',
    'quality.inspection.approve'
  ]::text[]
);

select private.seed_role_permissions(
  'management_officer',
  array[
    'quality.inspection.view',
    'quality.dashboard.view',
    'quality.disposition.view',
    'quality.disposition.release',
    'quality.specification.view',
    'quality.specification.approve',
    'quality.certificate.view',
    'quality.certificate.print',
    'quality.traceability.view',
    'quality.reports.view',
    'quality.ncr.view',
    'quality.ncr.create',
    'quality.ncr.update',
    'quality.ncr.close',
    'quality.capa.view',
    'quality.capa.create',
    'quality.capa.update',
    'quality.capa.verify',
    'quality.inspection.approve'
  ]::text[]
);

select private.seed_role_permissions(
  'procurement_officer',
  array[
    'quality.inspection.view',
    'quality.ncr.view',
    'quality.ncr.create',
    'quality.certificate.view'
  ]::text[]
);

select private.seed_role_permissions(
  'storekeeper',
  array[
    'quality.inspection.view',
    'quality.disposition.view',
    'quality.traceability.view'
  ]::text[]
);

select private.seed_role_permissions(
  'factory_operator',
  array[
    'quality.inspection.view',
    'quality.result.view',
    'quality.disposition.view'
  ]::text[]
);

select private.seed_role_permissions(
  'factory_supervisor',
  array[
    'quality.inspection.view',
    'quality.dashboard.view',
    'quality.result.view',
    'quality.disposition.view',
    'quality.specification.view',
    'quality.traceability.view',
    'quality.ncr.view',
    'quality.ncr.create',
    'quality.capa.view'
  ]::text[]
);

select private.seed_role_permissions(
  'quality_control_officer',
  array[
    'quality.inspection.view',
    'quality.inspection.manage',
    'quality.dashboard.view',
    'quality.inspection.submit',
    'quality.inspection.approve',
    'quality.result.view',
    'quality.result.record',
    'quality.specification.view',
    'quality.specification.create',
    'quality.specification.update',
    'quality.parameter.view',
    'quality.parameter.manage',
    'quality.sampling.view',
    'quality.sampling.manage',
    'quality.disposition.view',
    'quality.disposition.record',
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
  ]::text[]
);

select private.seed_role_permissions(
  'sales_officer',
  array[
    'quality.certificate.view'
  ]::text[]
);

select private.seed_role_permissions(
  'logistics_officer',
  array[
    'quality.certificate.view',
    'quality.certificate.print',
    'quality.inspection.view',
    'quality.disposition.view'
  ]::text[]
);

select private.seed_role_permissions(
  'auditor',
  array[
    'quality.dashboard.view',
    'quality.inspection.view',
    'quality.result.view',
    'quality.specification.view',
    'quality.parameter.view',
    'quality.sampling.view',
    'quality.disposition.view',
    'quality.ncr.view',
    'quality.capa.view',
    'quality.certificate.view',
    'quality.traceability.view',
    'quality.reports.view'
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
 ]::text[])
  and not exists (
    select 1
    from (values
        ('super_administrator', 'quality.dashboard.view'),
        ('super_administrator', 'quality.inspection.view'),
        ('super_administrator', 'quality.inspection.manage'),
        ('super_administrator', 'quality.inspection.submit'),
        ('super_administrator', 'quality.inspection.approve'),
        ('super_administrator', 'quality.result.view'),
        ('super_administrator', 'quality.result.record'),
        ('super_administrator', 'quality.specification.view'),
        ('super_administrator', 'quality.specification.create'),
        ('super_administrator', 'quality.specification.update'),
        ('super_administrator', 'quality.specification.approve'),
        ('super_administrator', 'quality.parameter.view'),
        ('super_administrator', 'quality.parameter.manage'),
        ('super_administrator', 'quality.sampling.view'),
        ('super_administrator', 'quality.sampling.manage'),
        ('super_administrator', 'quality.disposition.view'),
        ('super_administrator', 'quality.disposition.record'),
        ('super_administrator', 'quality.disposition.release'),
        ('super_administrator', 'quality.disposition.hold'),
        ('super_administrator', 'quality.ncr.view'),
        ('super_administrator', 'quality.ncr.create'),
        ('super_administrator', 'quality.ncr.update'),
        ('super_administrator', 'quality.ncr.close'),
        ('super_administrator', 'quality.capa.view'),
        ('super_administrator', 'quality.capa.create'),
        ('super_administrator', 'quality.capa.update'),
        ('super_administrator', 'quality.capa.verify'),
        ('super_administrator', 'quality.certificate.view'),
        ('super_administrator', 'quality.certificate.issue'),
        ('super_administrator', 'quality.certificate.print'),
        ('super_administrator', 'quality.traceability.view'),
        ('super_administrator', 'quality.reports.view'),
        ('super_administrator', 'quality.reports.export'),
        ('system_administrator', 'quality.inspection.view'),
        ('system_administrator', 'quality.dashboard.view'),
        ('system_administrator', 'quality.inspection.view'),
        ('system_administrator', 'quality.inspection.manage'),
        ('system_administrator', 'quality.inspection.submit'),
        ('system_administrator', 'quality.inspection.approve'),
        ('system_administrator', 'quality.result.view'),
        ('system_administrator', 'quality.result.record'),
        ('system_administrator', 'quality.specification.view'),
        ('system_administrator', 'quality.specification.create'),
        ('system_administrator', 'quality.specification.update'),
        ('system_administrator', 'quality.specification.approve'),
        ('system_administrator', 'quality.parameter.view'),
        ('system_administrator', 'quality.parameter.manage'),
        ('system_administrator', 'quality.sampling.view'),
        ('system_administrator', 'quality.sampling.manage'),
        ('system_administrator', 'quality.disposition.view'),
        ('system_administrator', 'quality.disposition.record'),
        ('system_administrator', 'quality.disposition.release'),
        ('system_administrator', 'quality.disposition.hold'),
        ('system_administrator', 'quality.ncr.view'),
        ('system_administrator', 'quality.ncr.create'),
        ('system_administrator', 'quality.ncr.update'),
        ('system_administrator', 'quality.ncr.close'),
        ('system_administrator', 'quality.capa.view'),
        ('system_administrator', 'quality.capa.create'),
        ('system_administrator', 'quality.capa.update'),
        ('system_administrator', 'quality.capa.verify'),
        ('system_administrator', 'quality.certificate.view'),
        ('system_administrator', 'quality.certificate.issue'),
        ('system_administrator', 'quality.certificate.print'),
        ('system_administrator', 'quality.traceability.view'),
        ('system_administrator', 'quality.reports.view'),
        ('system_administrator', 'quality.reports.export'),
        ('managing_director', 'quality.inspection.view'),
        ('managing_director', 'quality.dashboard.view'),
        ('managing_director', 'quality.disposition.view'),
        ('managing_director', 'quality.disposition.release'),
        ('managing_director', 'quality.specification.approve'),
        ('managing_director', 'quality.certificate.view'),
        ('managing_director', 'quality.certificate.print'),
        ('managing_director', 'quality.traceability.view'),
        ('managing_director', 'quality.reports.view'),
        ('managing_director', 'quality.reports.export'),
        ('managing_director', 'quality.ncr.view'),
        ('managing_director', 'quality.capa.view'),
        ('managing_director', 'quality.inspection.approve'),
        ('general_manager', 'quality.inspection.view'),
        ('general_manager', 'quality.dashboard.view'),
        ('general_manager', 'quality.disposition.view'),
        ('general_manager', 'quality.disposition.release'),
        ('general_manager', 'quality.specification.approve'),
        ('general_manager', 'quality.certificate.view'),
        ('general_manager', 'quality.certificate.print'),
        ('general_manager', 'quality.traceability.view'),
        ('general_manager', 'quality.reports.view'),
        ('general_manager', 'quality.reports.export'),
        ('general_manager', 'quality.ncr.view'),
        ('general_manager', 'quality.ncr.close'),
        ('general_manager', 'quality.capa.view'),
        ('general_manager', 'quality.capa.verify'),
        ('general_manager', 'quality.inspection.approve'),
        ('management_officer', 'quality.inspection.view'),
        ('management_officer', 'quality.dashboard.view'),
        ('management_officer', 'quality.disposition.view'),
        ('management_officer', 'quality.disposition.release'),
        ('management_officer', 'quality.specification.view'),
        ('management_officer', 'quality.specification.approve'),
        ('management_officer', 'quality.certificate.view'),
        ('management_officer', 'quality.certificate.print'),
        ('management_officer', 'quality.traceability.view'),
        ('management_officer', 'quality.reports.view'),
        ('management_officer', 'quality.ncr.view'),
        ('management_officer', 'quality.ncr.create'),
        ('management_officer', 'quality.ncr.update'),
        ('management_officer', 'quality.ncr.close'),
        ('management_officer', 'quality.capa.view'),
        ('management_officer', 'quality.capa.create'),
        ('management_officer', 'quality.capa.update'),
        ('management_officer', 'quality.capa.verify'),
        ('management_officer', 'quality.inspection.approve'),
        ('procurement_officer', 'quality.inspection.view'),
        ('procurement_officer', 'quality.ncr.view'),
        ('procurement_officer', 'quality.ncr.create'),
        ('procurement_officer', 'quality.certificate.view'),
        ('storekeeper', 'quality.inspection.view'),
        ('storekeeper', 'quality.disposition.view'),
        ('storekeeper', 'quality.traceability.view'),
        ('factory_operator', 'quality.inspection.view'),
        ('factory_operator', 'quality.result.view'),
        ('factory_operator', 'quality.disposition.view'),
        ('factory_supervisor', 'quality.inspection.view'),
        ('factory_supervisor', 'quality.dashboard.view'),
        ('factory_supervisor', 'quality.result.view'),
        ('factory_supervisor', 'quality.disposition.view'),
        ('factory_supervisor', 'quality.specification.view'),
        ('factory_supervisor', 'quality.traceability.view'),
        ('factory_supervisor', 'quality.ncr.view'),
        ('factory_supervisor', 'quality.ncr.create'),
        ('factory_supervisor', 'quality.capa.view'),
        ('quality_control_officer', 'quality.inspection.view'),
        ('quality_control_officer', 'quality.inspection.manage'),
        ('quality_control_officer', 'quality.dashboard.view'),
        ('quality_control_officer', 'quality.inspection.submit'),
        ('quality_control_officer', 'quality.inspection.approve'),
        ('quality_control_officer', 'quality.result.view'),
        ('quality_control_officer', 'quality.result.record'),
        ('quality_control_officer', 'quality.specification.view'),
        ('quality_control_officer', 'quality.specification.create'),
        ('quality_control_officer', 'quality.specification.update'),
        ('quality_control_officer', 'quality.parameter.view'),
        ('quality_control_officer', 'quality.parameter.manage'),
        ('quality_control_officer', 'quality.sampling.view'),
        ('quality_control_officer', 'quality.sampling.manage'),
        ('quality_control_officer', 'quality.disposition.view'),
        ('quality_control_officer', 'quality.disposition.record'),
        ('quality_control_officer', 'quality.disposition.hold'),
        ('quality_control_officer', 'quality.ncr.view'),
        ('quality_control_officer', 'quality.ncr.create'),
        ('quality_control_officer', 'quality.ncr.update'),
        ('quality_control_officer', 'quality.ncr.close'),
        ('quality_control_officer', 'quality.capa.view'),
        ('quality_control_officer', 'quality.capa.create'),
        ('quality_control_officer', 'quality.capa.update'),
        ('quality_control_officer', 'quality.capa.verify'),
        ('quality_control_officer', 'quality.certificate.view'),
        ('quality_control_officer', 'quality.certificate.issue'),
        ('quality_control_officer', 'quality.certificate.print'),
        ('quality_control_officer', 'quality.traceability.view'),
        ('quality_control_officer', 'quality.reports.view'),
        ('quality_control_officer', 'quality.reports.export'),
        ('sales_officer', 'quality.certificate.view'),
        ('logistics_officer', 'quality.certificate.view'),
        ('logistics_officer', 'quality.certificate.print'),
        ('logistics_officer', 'quality.inspection.view'),
        ('logistics_officer', 'quality.disposition.view'),
        ('auditor', 'quality.dashboard.view'),
        ('auditor', 'quality.inspection.view'),
        ('auditor', 'quality.result.view'),
        ('auditor', 'quality.specification.view'),
        ('auditor', 'quality.parameter.view'),
        ('auditor', 'quality.sampling.view'),
        ('auditor', 'quality.disposition.view'),
        ('auditor', 'quality.ncr.view'),
        ('auditor', 'quality.capa.view'),
        ('auditor', 'quality.certificate.view'),
        ('auditor', 'quality.traceability.view'),
        ('auditor', 'quality.reports.view')
    ) as keep(role_code, permission_code)
    where keep.role_code = r.code and keep.permission_code = p.code
  );
