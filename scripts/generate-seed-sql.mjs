#!/usr/bin/env node
/**
 * Generates the SQL seed migrations from `lib/permissions/definitions.ts`.
 *
 * The TypeScript catalogue is the single source of truth. It is transpiled with the TypeScript
 * compiler API and imported, so the SQL is derived from the real evaluated module rather than
 * from regex parsing. `tests/unit/permissions.test.ts` re-reads the generated SQL and fails if
 * the database seed and the catalogue ever disagree.
 *
 * THREE SEED SETS, ON PURPOSE
 * Later phases widened the closed action vocabulary, and a permission row cannot be inserted until
 * the check constraint that validates it has been widened. The catalogue is therefore split by
 * the migration that makes each slice legal:
 *
 *   0025 permissions  | 0026 roles | 0027 grants     ← Phase 0/1 codes, applied before 0030
 *   0040 permissions  | 0041 grants                 ← master_data codes, applied after 0030
 *   0051 permissions  | 0052 grants                 ← procurement codes, applied after 0042
 *   0065 permissions  | 0066 grants                 ← inventory / production codes, applied after 0058
 *
 * Each set only inserts, and only removes, its own codes, so any one can be re-run without
 * disturbing the others. Roles live in 0026 because every phase shares the same role templates.
 *
 * Usage: node scripts/generate-seed-sql.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
mkdirSync(migrationsDir, { recursive: true });

const sourcePath = join(root, "lib", "permissions", "definitions.ts");
const source = readFileSync(sourcePath, "utf8");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  },
  fileName: "definitions.ts",
});

const tempPath = join(tmpdir(), `pluck-permissions-${Date.now()}.mjs`);
writeFileSync(tempPath, outputText);
const catalogue = await import(pathToFileURL(tempPath).href);

const { PERMISSION_CATALOG, ALL_PERMISSION_CODES, SYSTEM_ROLES, SYSTEM_ROLE_CODES } = catalogue;

if (!Array.isArray(ALL_PERMISSION_CODES) || ALL_PERMISSION_CODES.length === 0) {
  throw new Error("Permission catalogue is empty — refusing to generate seeds.");
}
if (!Array.isArray(SYSTEM_ROLE_CODES) || SYSTEM_ROLE_CODES.length !== 16) {
  throw new Error(`Expected 16 system roles, found ${SYSTEM_ROLE_CODES?.length}`);
}

const isMasterData = (code) => code.startsWith("master_data.");
const isProcurement = (code) => code.startsWith("procurement.");
// Phase 4 codes cannot be inserted until 0058 widens the closed action vocabulary, so they are seeded
// later than the Phase 0/1 slice and are excluded from it for the same reason as the others.
const isInventory = (code) => code.startsWith("inventory.") || code.startsWith("production.");
// Phase 5 codes arrive with the widened quality vocabulary (collect, record, hold) and are seeded by 0082/0083.
const isQuality = (code) => code.startsWith("quality.");
const masterDataCodes = ALL_PERMISSION_CODES.filter(isMasterData);
const procurementCodes = ALL_PERMISSION_CODES.filter(isProcurement);
const inventoryCodes = ALL_PERMISSION_CODES.filter(isInventory);
const qualityCodes = ALL_PERMISSION_CODES.filter(isQuality);
const phase1Codes = ALL_PERMISSION_CODES.filter(
  (code) => !isMasterData(code) && !isProcurement(code) && !isInventory(code) && !isQuality(code),
);

if (
  phase1Codes.length === 0 ||
  qualityCodes.length === 0 ||
  masterDataCodes.length === 0 ||
  procurementCodes.length === 0 ||
  inventoryCodes.length === 0
) {
  throw new Error("Catalogue split produced an empty seed set.");
}

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlArray = (codes, indent) =>
  codes.map((code) => `${indent}${sqlString(code)}`).join(",\n");

const permissionRows = (codes) =>
  codes
    .map((code) => {
      const { module, resource, action, description } = PERMISSION_CATALOG[code];
      return `  (${sqlString(module)}, ${sqlString(resource)}, ${sqlString(action)}, ${sqlString(code)}, ${sqlString(description)})`;
    })
    .join(",\n");

/** A permission seed that only manages its own slice of the catalogue. */
const permissionsSql = ({ codes, header, scopeNote, slicePredicate }) => `-- ${header}
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- Codes follow module.resource.action. They are controlled system data: administrators may
-- change role → permission grants, but cannot invent new permission codes at runtime.
-- ${scopeNote}

insert into public.permissions (module, resource, action, code, description)
values
${permissionRows(codes)}
on conflict (code) do update
  set module = excluded.module,
      resource = excluded.resource,
      action = excluded.action,
      description = excluded.description;

-- Remove rows in THIS slice that are no longer catalogued (keeps seeds deterministic).
-- The slice predicate is what stops each seed from deleting the other phase's codes.
delete from public.permissions p
 where (${slicePredicate})
   and p.code <> all (array[
${sqlArray(codes, "   ")}
 ]::text[]);
`;

/** Grants for a subset of codes: seeds exactly the catalogue's role → permission pairs. */
const grantsSql = ({ codes, header, functionBlock, scopeNote }) => {
  const codeSet = new Set(codes);
  const scopedRoles = SYSTEM_ROLE_CODES.map((roleCode) => ({
    role: SYSTEM_ROLES[roleCode],
    permissions: SYSTEM_ROLES[roleCode].permissions.filter((code) => codeSet.has(code)),
  })).filter((entry) => entry.permissions.length > 0);

  const grantCalls = scopedRoles
    .map(
      ({ role, permissions }) => `select private.seed_role_permissions(
  ${sqlString(role.code)},
  array[
${sqlArray(permissions, "    ")}
  ]::text[]
);`,
    )
    .join("\n\n");

  const keepPairs = scopedRoles
    .flatMap(({ role, permissions }) =>
      permissions.map((permission) => `        (${sqlString(role.code)}, ${sqlString(permission)})`),
    )
    .join(",\n");

  return `-- ${header}
--
-- GENERATED FILE — do not edit by hand.
-- Source: lib/permissions/definitions.ts
-- Regenerate: node scripts/generate-seed-sql.mjs
--
-- All seeded grants are GLOBAL-scoped. Department-scoped grants are an administrative action
-- performed through the permission matrix and are preserved by this seed.
-- ${scopeNote}

${functionBlock}

${grantCalls}

-- Remove globally-scoped grants inside this slice that the catalogue no longer declares.
-- Grants outside the slice, and all department-scoped grants, are left untouched.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.is_system_role
  and rp.scope_type = 'GLOBAL'
  and p.code = any (array[
${sqlArray(codes, "   ")}
 ]::text[])
  and not exists (
    select 1
    from (values
${keepPairs}
    ) as keep(role_code, permission_code)
    where keep.role_code = r.code and keep.permission_code = p.code
  );
`;
};

const seedFunction = `create or replace function private.seed_role_permissions(role_code text, permission_codes text[])
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

  insert into public.role_permissions (role_id, permission_id, scope_type)
  select target_role_id, p.id, 'GLOBAL'
  from public.permissions p
  where p.code = any (permission_codes)
  on conflict (role_id, permission_id) do nothing;
end;
$$;

revoke all on function private.seed_role_permissions(text, text[]) from public;`;

// ---------------------------------------------------------------- 0026 roles (shared)
const roleValues = SYSTEM_ROLE_CODES.map((code) => {
  const role = SYSTEM_ROLES[code];
  return `  (${sqlString(role.name)}, ${sqlString(role.code)}, ${sqlString(role.category)}, ${sqlString(role.description)}, true)`;
}).join(",\n");

const rolesSql = `-- 0026 — seed system role templates
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
${roleValues}
on conflict (code) do update
  set name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      is_system_role = true;
`;

writeFileSync(
  join(migrationsDir, "0025_seed_phase_1_permissions.sql"),
  permissionsSql({
    codes: phase1Codes,
    header: "0025 — seed the Phase 0/1 permission catalogue",
    scopeNote:
      "This file deliberately excludes master_data.* codes (seeded by 0040), procurement.* codes (seeded by 0051), inventory/production codes (seeded by 0065) and quality codes (seeded by 0082).",
    slicePredicate:
      "p.code not like 'master_data.%' and p.code not like 'procurement.%' and p.code not like 'inventory.%' and p.code not like 'production.%' and p.code not like 'quality.%'",
  }),
);
writeFileSync(join(migrationsDir, "0026_seed_phase_1_roles.sql"), rolesSql);
writeFileSync(
  join(migrationsDir, "0027_seed_phase_1_grants.sql"),
  grantsSql({
    codes: phase1Codes,
    header: "0027 — seed Phase 0/1 role → permission grants",
    functionBlock: seedFunction,
    scopeNote:
      "Only Phase 0/1 codes are granted here; master-data grants are seeded by 0041 and procurement grants by 0052.",
  }),
);
writeFileSync(
  join(migrationsDir, "0040_seed_master_data_permissions.sql"),
  permissionsSql({
    codes: masterDataCodes,
    header: "0040 — seed the Phase 2 master data permission catalogue",
    scopeNote:
      "Runs after 0030, which widened the permitted action vocabulary (verify, block, archive, review, execute).",
    slicePredicate: "p.code like 'master_data.%'",
  }),
);
writeFileSync(
  join(migrationsDir, "0041_seed_master_data_grants.sql"),
  grantsSql({
    codes: masterDataCodes,
    header: "0041 — seed Phase 2 master data role → permission grants",
    functionBlock: "-- private.seed_role_permissions() is defined by 0027 and reused here.",
    scopeNote:
      "These are suggested mappings for management review, exactly as the Phase 2 specification requires. Sensitive banking and credit views are granted only to Finance roles; the auditor template deliberately excludes them.",
  }),
);

writeFileSync(
  join(migrationsDir, "0051_seed_procurement_permissions.sql"),
  permissionsSql({
    codes: procurementCodes,
    header: "0051 — seed the Phase 3 procurement permission catalogue",
    scopeNote:
      "Runs after 0042, which widened the permitted action vocabulary (issue, amend, compare, select, close, upload, reconcile).",
    slicePredicate: "p.code like 'procurement.%'",
  }),
);
writeFileSync(
  join(migrationsDir, "0052_seed_procurement_grants.sql"),
  grantsSql({
    codes: procurementCodes,
    header: "0052 — seed Phase 3 procurement role → permission grants",
    functionBlock: "-- private.seed_role_permissions() is defined by 0027 and reused here.",
    scopeNote:
      "These are suggested mappings for management review, not automatic activation of authority: approval rights still require an approval_authorities row covering the amount, and the sensitive supplier advance payment details are granted only to Finance roles.",
  }),
);

writeFileSync(
  join(migrationsDir, "0065_seed_inventory_permissions.sql"),
  permissionsSql({
    codes: inventoryCodes,
    header: "0065 — seed the Phase 4 inventory and production permission catalogue",
    scopeNote:
      "Runs after 0058, which widened the permitted action vocabulary (transfer, count, reserve, release, consume, produce).",
    slicePredicate: "p.code like 'inventory.%' or p.code like 'production.%'",
  }),
);
writeFileSync(
  join(migrationsDir, "0066_seed_inventory_grants.sql"),
  grantsSql({
    codes: inventoryCodes,
    header: "0066 — seed Phase 4 inventory and production role → permission grants",
    functionBlock: "-- private.seed_role_permissions() is defined by 0027 and reused here.",
    scopeNote:
      "These are suggested mappings for management review. They grant the ability to post and approve stock movements; they do not grant approval authority over money, which remains an approval_authorities row.",
  }),
);

writeFileSync(
  join(migrationsDir, "0082_seed_quality_permissions.sql"),
  permissionsSql({
    codes: qualityCodes,
    header: "0082 — seed the Phase 5 quality permission catalogue",
    scopeNote:
      "Runs after 0074, which widened the permitted action vocabulary (collect, record, hold).",
    slicePredicate: "p.code like 'quality.%'",
  }),
);
writeFileSync(
  join(migrationsDir, "0083_seed_quality_grants.sql"),
  grantsSql({
    codes: qualityCodes,
    header: "0083 — seed Phase 5 quality role → permission grants",
    functionBlock: "-- private.seed_role_permissions() is defined by 0027 and reused here.",
    scopeNote:
      "These are suggested mappings for management review. They deliberately separate recording a disposition from releasing stock and from approving a specification, so a single officer can inspect and decide while a second person authorises release; the setting inspection.allow_self_approval is the documented way to relax that where the site has one qualified officer.",
  }),
);

const grantCount = (codes) => {
  const codeSet = new Set(codes);
  return SYSTEM_ROLE_CODES.reduce(
    (sum, code) => sum + SYSTEM_ROLES[code].permissions.filter((p) => codeSet.has(p)).length,
    0,
  );
};

console.info(
  `Generated seeds: ${ALL_PERMISSION_CODES.length} permissions ` +
    `(${phase1Codes.length} Phase 0/1 in 0025, ${masterDataCodes.length} master data in 0040), ` +
    `${SYSTEM_ROLE_CODES.length} roles in 0026, ` +
    `${grantCount(phase1Codes)} Phase 0/1 grants in 0027, ${grantCount(masterDataCodes)} master data grants in 0041, ` +
    `${procurementCodes.length} procurement codes and ${grantCount(procurementCodes)} procurement grants in 0051/0052, ` +
    `${inventoryCodes.length} inventory/production codes and ${grantCount(inventoryCodes)} grants in 0065/0066, ` +
    `${qualityCodes.length} quality codes and ${grantCount(qualityCodes)} grants in 0082/0083.`,
);
