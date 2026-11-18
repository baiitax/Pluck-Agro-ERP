import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCESS_ADMIN_ROLE_CODES,
  ALL_PERMISSION_CODES,
  PERMISSION_ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_SCOPES,
  SYSTEM_ROLES,
  SYSTEM_ROLE_CODES,
  groupedPermissions,
  isPermissionCode,
  permissionAction,
  permissionModule,
  permissionResource,
  permissionsForRole,
} from "@/lib/permissions/definitions";
import { NAVIGATION } from "@/config/navigation.config";

const migrations = join(process.cwd(), "supabase", "migrations");
const read = (file: string) => readFileSync(join(migrations, file), "utf8");

describe("permission catalogue", () => {
  it("uses module.resource.action codes that match the declared parts", () => {
    for (const code of ALL_PERMISSION_CODES) {
      const definition = PERMISSION_CATALOG[code]!;
      expect(code, code).toBe(`${definition.module}.${definition.resource}.${definition.action}`);
      expect(code.split(".")).toHaveLength(3);
      expect(definition.description.length).toBeGreaterThan(5);
      expect(PERMISSION_ACTIONS).toContain(definition.action);
    }
  });

  it("exposes helpers that agree with the code itself", () => {
    const code = "access.accounts.suspend";
    expect(isPermissionCode(code)).toBe(true);
    expect(permissionModule(code)).toBe("access");
    expect(permissionResource(code)).toBe("accounts");
    expect(permissionAction(code)).toBe("suspend");
    expect(isPermissionCode("employees.destroy")).toBe(false);
    expect(isPermissionCode("access.accounts")).toBe(false);
  });

  it("uses only declared actions", () => {
    const used = new Set(ALL_PERMISSION_CODES.map((code) => PERMISSION_CATALOG[code]!.action));
    for (const action of used) expect(PERMISSION_ACTIONS).toContain(action);
    // The vocabulary is closed and versioned: 20 Phase 1 verbs, the 5 master-data verbs added by
    // Phase 2, and the 7 procurement document verbs added by Phase 3 (issue, amend, compare,
    // select, close, upload, reconcile). Declaring a verb before it is used keeps codes stable.
    expect(PERMISSION_ACTIONS).toHaveLength(38);
  });

  it("declares the seven scopes with GLOBAL first", () => {
    expect(PERMISSION_SCOPES).toHaveLength(7);
    expect(PERMISSION_SCOPES[0]).toBe("GLOBAL");
    expect(new Set(PERMISSION_SCOPES).size).toBe(7);
  });

  it("groups permissions by module and resource without losing any", () => {
    const groups = groupedPermissions();
    const total = groups.reduce((sum, group) => sum + group.codes.length, 0);
    expect(total).toBe(ALL_PERMISSION_CODES.length);
    for (const group of groups) {
      for (const code of group.codes) {
        expect(permissionModule(code)).toBe(group.module);
        expect(permissionResource(code)).toBe(group.resource);
      }
    }
  });
});

describe("role templates", () => {
  it("defines sixteen unique system roles", () => {
    expect(SYSTEM_ROLE_CODES).toHaveLength(16);
    expect(new Set(SYSTEM_ROLE_CODES).size).toBe(16);
    for (const roleCode of SYSTEM_ROLE_CODES) {
      expect(SYSTEM_ROLES[roleCode]).toBeDefined();
      expect(SYSTEM_ROLES[roleCode]!.code).toBe(roleCode);
    }
  });

  it("gives every role at least one valid permission with no duplicates", () => {
    for (const roleCode of SYSTEM_ROLE_CODES) {
      const permissions = permissionsForRole(roleCode);
      expect(permissions.length, roleCode).toBeGreaterThan(0);
      expect(new Set(permissions).size).toBe(permissions.length);
      for (const permission of permissions) {
        expect(isPermissionCode(permission), `${roleCode}: ${permission}`).toBe(true);
      }
    }
  });

  it("documents every role", () => {
    for (const roleCode of SYSTEM_ROLE_CODES) {
      expect(SYSTEM_ROLES[roleCode]!.description.length, roleCode).toBeGreaterThan(20);
      expect(SYSTEM_ROLES[roleCode]!.name.length, roleCode).toBeGreaterThan(3);
    }
  });

  it("keeps the super administrator as the only role with full access", () => {
    const fullAccessRoles = SYSTEM_ROLE_CODES.filter(
      (roleCode) => permissionsForRole(roleCode).length === ALL_PERMISSION_CODES.length,
    );
    expect(fullAccessRoles).toEqual(["super_administrator"]);
  });

  it("does not give access administration to operational roles", () => {
    for (const roleCode of SYSTEM_ROLE_CODES) {
      if (ACCESS_ADMIN_ROLE_CODES.includes(roleCode)) continue;
      expect(permissionsForRole(roleCode), roleCode).not.toContain("access.assignments.manage");
      expect(permissionsForRole(roleCode), roleCode).not.toContain("access.roles.update");
      expect(permissionsForRole(roleCode), roleCode).not.toContain("access.permissions.manage");
    }
  });

  it("keeps the auditor strictly read-only", () => {
    const permissions = permissionsForRole("auditor");
    expect(permissions.length).toBeGreaterThan(0);
    for (const permission of permissions) {
      expect(permission.endsWith(".view"), permission).toBe(true);
    }
  });

  it("keeps the system administrator away from business approval authority", () => {
    const permissions = permissionsForRole("system_administrator");
    for (const approval of [
      "procurement.purchase_order.approve",
      "production.order.approve",
      "sales.order.approve",
      "dispatch.dispatch.approve",
      "expenses.expense.approve",
      "finance.journal.post",
    ]) {
      expect(permissions, approval).not.toContain(approval);
    }
  });

  it("separates the treasury officer from the finance manager", () => {
    expect(SYSTEM_ROLE_CODES).toContain("treasury_officer");
    const treasury = permissionsForRole("treasury_officer");
    const manager = permissionsForRole("finance_manager");

    // The treasury officer maintains payment records but cannot post to the ledger;
    // the finance manager posts journals but does not maintain treasury records.
    expect(treasury).toContain("treasury.payment.manage");
    expect(treasury).not.toContain("finance.journal.post");
    expect(manager).toContain("finance.journal.post");
    expect(manager).not.toContain("treasury.payment.manage");
  });
});

describe("seed migration parity", () => {
  const seedCodes = (file: string): Set<string> => {
    const sql = read(file);
    const codes = Array.from(
      sql.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)', '([a-z_.]+)',/g),
    )
      .map((match) => match[4] ?? "")
      .filter((code) => code.length > 0);
    return new Set<string>(codes);
  };

  it("seeds every catalogued permission code, split across the four phase seeds", () => {
    const phase1 = seedCodes("0025_seed_phase_1_permissions.sql");
    const masterData = seedCodes("0040_seed_master_data_permissions.sql");
    const procurement = seedCodes("0051_seed_procurement_permissions.sql");
    const inventory = seedCodes("0065_seed_inventory_permissions.sql");

    // The split is by module, and it exists because 0030, 0042 and 0058 widen the action vocabulary
    // after 0025 has already run. No file may contain another slice's codes.
    for (const code of Array.from(phase1)) {
      expect(code.startsWith("master_data."), code).toBe(false);
      expect(code.startsWith("procurement."), code).toBe(false);
      expect(code.startsWith("inventory."), code).toBe(false);
      expect(code.startsWith("production."), code).toBe(false);
    }
    for (const code of Array.from(masterData)) expect(code.startsWith("master_data."), code).toBe(true);
    for (const code of Array.from(procurement)) expect(code.startsWith("procurement."), code).toBe(true);
    for (const code of Array.from(inventory)) {
      expect(code.startsWith("inventory.") || code.startsWith("production."), code).toBe(true);
    }

    const seeded = new Set([...phase1, ...masterData, ...procurement, ...inventory]);
    expect(seeded.size).toBe(ALL_PERMISSION_CODES.length);
    for (const code of ALL_PERMISSION_CODES) expect(seeded.has(code), code).toBe(true);
  });

  it("never deletes another phase's permission rows", () => {
    const phase1 = read("0025_seed_phase_1_permissions.sql");
    expect(phase1).toContain("p.code not like 'master_data.%'");
    expect(phase1).toContain("p.code not like 'procurement.%'");
    expect(phase1).toContain("p.code not like 'inventory.%'");
    expect(phase1).toContain("p.code not like 'production.%'");
    expect(read("0040_seed_master_data_permissions.sql")).toContain("p.code like 'master_data.%'");
    expect(read("0051_seed_procurement_permissions.sql")).toContain("p.code like 'procurement.%'");
    expect(read("0065_seed_inventory_permissions.sql")).toContain("p.code like 'inventory.%'");
  });

  it("seeds exactly the roster of system roles into 0026", () => {
    const sql = read("0026_seed_phase_1_roles.sql");
    const seeded = new Set(Array.from(sql.matchAll(/\('([^']+)', '([a-z_]+)', '([a-z_]+)',/g)).map((match) => match[2]));
    expect(seeded).toEqual(new Set(SYSTEM_ROLE_CODES));
  });

  it("seeds exactly the role → permission grants defined in the catalogue", () => {
    const sql = [
      "0027_seed_phase_1_grants.sql",
      "0041_seed_master_data_grants.sql",
      "0052_seed_procurement_grants.sql",
      "0066_seed_inventory_grants.sql",
    ]
      .map((file) => read(file))
      .join("\n");

    for (const roleCode of SYSTEM_ROLE_CODES) {
      // A role's grants are split across the three seed files, so collect every block for it.
      const blocks = sql
        .split("select private.seed_role_permissions(")
        .filter((chunk) => chunk.trimStart().startsWith(`'${roleCode}'`));
      expect(blocks.length, `missing seed block for ${roleCode}`).toBeGreaterThan(0);

      const codes = blocks.flatMap((block) => {
        const arrayBody = block.split("::text[]")[0] ?? "";
        return Array.from(
          arrayBody.matchAll(/'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g),
        ).map((match) => match[1]);
      });
      expect(new Set(codes), roleCode).toEqual(new Set(permissionsForRole(roleCode)));
    }
  });

  it("removes superseded grants deterministically", () => {
    for (const file of [
      "0027_seed_phase_1_grants.sql",
      "0041_seed_master_data_grants.sql",
      "0052_seed_procurement_grants.sql",
      "0066_seed_inventory_grants.sql",
    ]) {
      expect(read(file)).toContain("delete from public.role_permissions rp");
    }
  });

  it("never seeds a segregation-of-duties rule", () => {
    const phaseOneMigrations = ["0021_segregation_of_duties.sql", "0025_seed_phase_1_permissions.sql"];
    for (const file of phaseOneMigrations) {
      const sql = read(file);
      expect(sql).not.toMatch(/insert into public\.segregation_of_duties_rules/i);
    }
  });
});

describe("navigation configuration", () => {
  it("only references permissions that exist", () => {
    for (const group of NAVIGATION) {
      for (const item of group.items) {
        expect(isPermissionCode(item.permission), `${item.label} → ${item.permission}`).toBe(true);
        expect(item.href.startsWith("/")).toBe(true);
      }
    }
  });

  it("has no duplicate navigation targets", () => {
    const hrefs = NAVIGATION.flatMap((group) => group.items).map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("exposes every Phase 1 governance screen", () => {
    const ready = NAVIGATION.flatMap((group) => group.items)
      .filter((item) => item.status === "ready")
      .map((item) => item.href);

    for (const href of [
      "/administration/employees",
      "/administration/departments",
      "/administration/positions",
      "/administration/org-chart",
      "/administration/users",
      "/administration/roles",
      "/administration/permissions",
      "/governance",
      "/governance/authorities",
      "/governance/delegations",
      "/governance/sod",
      "/governance/access-reviews",
      "/audit-logs",
    ]) {
      expect(ready, href).toContain(href);
    }
    expect(ready).not.toContain("/procurement");
  });

  it("carries a note for every planned module so the UI can be honest about status", () => {
    const planned = NAVIGATION.flatMap((group) => group.items).filter((item) => item.status === "planned");
    expect(planned.length).toBeGreaterThan(0);
    for (const item of planned) {
      expect(item.status).toBe("planned");
    }
  });
});
