import { beforeAll, describe, expect, it } from "vitest";

import {
  actAsAnon,
  actAsAuthenticated,
  actAsSuperuser,
  createTestDatabase,
  expectDbError,
  queryRows,
  seedUser,
  type SeededUser,
  type TestDatabase,
} from "../helpers/pglite";

/**
 * Row Level Security and privilege tests.
 *
 * These queries run as the real `authenticated` / `anon` roles with a JWT subject, so they
 * verify database enforcement rather than application code.
 */

let db: TestDatabase;

let auditor: SeededUser;
let superAdmin: SeededUser;
let operator: SeededUser;
let inactiveUser: SeededUser;
let expiredUser: SeededUser;

beforeAll(async () => {
  db = await createTestDatabase();

  await actAsSuperuser(db);
  await db.query("insert into public.departments (name, code) values ('Finance', 'FIN') on conflict do nothing");

  auditor = await seedUser(db, { email: "auditor@example.com", roleCodes: ["auditor"] });
  superAdmin = await seedUser(db, { email: "super@example.com", roleCodes: ["super_administrator"] });
  operator = await seedUser(db, { email: "operator@example.com", roleCodes: ["factory_operator"] });
  inactiveUser = await seedUser(db, {
    email: "inactive@example.com",
    roleCodes: ["super_administrator"],
    accountStatus: "deactivated",
  });
  expiredUser = await seedUser(db, {
    email: "expired@example.com",
    roleCodes: ["auditor"],
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    assignedAt: new Date(Date.now() - 86_400_000).toISOString(),
  });

  // Audit history written by a trusted (service-side) path.
  await actAsSuperuser(db);
  await db.query(
    "insert into public.audit_logs (action, module, description) values ('seed.event', 'system', 'seeded audit row')",
  );
});

describe("anon access", () => {
  it("cannot read employee records", async () => {
    await actAsAnon(db);
    const error = await expectDbError(db, "select id from public.employees");
    expect(error).toMatch(/permission denied|row-level security/i);
  });

  it("cannot read audit logs", async () => {
    await actAsAnon(db);
    const error = await expectDbError(db, "select id from public.audit_logs");
    expect(error).toMatch(/permission denied|row-level security/i);
  });
});

describe("authenticated access without an active profile", () => {
  it("returns no rows for a deactivated profile even with a privileged role", async () => {
    await actAsAuthenticated(db, inactiveUser.id);

    const employees = await queryRows(db, "select id from public.employees");
    expect(employees).toHaveLength(0);

    const roles = await queryRows(db, "select id from public.roles");
    expect(roles).toHaveLength(0);

    const permission = await queryRows<{ has_permission: boolean }>(
      db,
      "select public.has_permission('employees.employee.view') as has_permission",
    );
    expect(permission[0]?.has_permission).toBe(false);
  });

  it("grants nothing for an expired role assignment", async () => {
    await actAsAuthenticated(db, expiredUser.id);

    const permission = await queryRows<{ has_permission: boolean }>(
      db,
      "select public.has_permission('employees.employee.view') as has_permission",
    );
    expect(permission[0]?.has_permission).toBe(false);

    const rows = await queryRows<{ id: string }>(db, "select id from public.employees");
    // An expired assignment only ever exposes the caller's own employee row.
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe("permission-derived visibility", () => {
  it("lets a user with employees.employee.view read employee records", async () => {
    await actAsAuthenticated(db, auditor.id);
    const rows = await queryRows<{ id: string }>(db, "select id from public.employees");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("hides employee records from a user without employees.employee.view", async () => {
    await actAsAuthenticated(db, operator.id);
    const rows = await queryRows(db, "select id from public.employees");
    // Only their own linked employee row is visible, never the full register.
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("lets a user read their own profile but not another user's", async () => {
    await actAsAuthenticated(db, operator.id);

    const own = await queryRows(db, "select id from public.profiles where id = $1", [operator.id]);
    expect(own).toHaveLength(1);

    const other = await queryRows(db, "select id from public.profiles where id = $1", [superAdmin.id]);
    expect(other).toHaveLength(0);
  });
});

describe("audit protection", () => {
  it("allows audit review only with audit.view", async () => {
    await actAsAuthenticated(db, auditor.id);
    const rows = await queryRows(db, "select id from public.audit_logs");
    expect(rows.length).toBeGreaterThan(0);

    await actAsAuthenticated(db, operator.id);
    const hidden = await queryRows(db, "select id from public.audit_logs");
    expect(hidden).toHaveLength(0);
  });

  it("refuses direct audit writes from application users", async () => {
    await actAsAuthenticated(db, auditor.id);
    const error = await expectDbError(
      db,
      "insert into public.audit_logs (actor_user_id, action, module) values ($1, 'fake.event', 'system')",
      [auditor.id],
    );
    expect(error).toMatch(/permission denied/i);
  });

  it("refuses audit modification even for a super administrator", async () => {
    await actAsAuthenticated(db, superAdmin.id);
    const error = await expectDbError(db, "update public.audit_logs set description = 'tampered'");
    expect(error).toMatch(/permission denied|append-only/i);
  });
});

describe("privilege escalation attempts", () => {
  it("blocks a user from inserting their own role assignment", async () => {
    await actAsAuthenticated(db, operator.id);
    const superRole = await queryRows<{ id: string }>(
      db,
      "select id from public.roles where code = 'super_administrator'",
    );

    const error = await expectDbError(
      db,
      "insert into public.user_roles (user_id, role_id) values ($1, $2)",
      [operator.id, superRole[0]?.id],
    );
    expect(error).toMatch(/row-level security|permission denied|cannot assign roles to themselves/i);
  });

  it("blocks a user from deactivating or reactivating their own account", async () => {
    await actAsAuthenticated(db, operator.id);
    await db.query("select 1");
    await actAsSuperuser(db);
    await db.query("update public.profiles set account_status = 'active' where id = $1", [operator.id]);

    await actAsAuthenticated(db, operator.id);
    // The self-update policy allows the row, but the privileged-column guard keeps the status.
    await db.query("update public.profiles set account_status = 'suspended' where id = $1", [operator.id]);

    await actAsSuperuser(db);
    const rows = await queryRows<{ account_status: string; is_active: boolean }>(
      db,
      "select account_status, is_active from public.profiles where id = $1",
      [operator.id],
    );
    expect(rows[0]?.account_status).toBe("active");
    expect(rows[0]?.is_active).toBe(true);
  });

  it("blocks a user from granting permissions to a role", async () => {
    await actAsAuthenticated(db, operator.id);
    const error = await expectDbError(
      db,
      `insert into public.role_permissions (role_id, permission_id)
       select r.id, p.id from public.roles r, public.permissions p
        where r.code = 'factory_operator' and p.code = 'access.assignments.manage'`,
    );
    expect(error).toMatch(/row-level security|permission denied/i);
  });

  it("blocks a user from editing permission definitions", async () => {
    await actAsAuthenticated(db, operator.id);
    const updated = await queryRows(
      db,
      "update public.permissions set description = 'tampered' where code = 'access.assignments.manage' returning id",
    );
    expect(updated).toHaveLength(0);

    await actAsSuperuser(db);
    const rows = await queryRows<{ description: string }>(
      db,
      "select description from public.permissions where code = 'access.assignments.manage'",
    );
    expect(rows[0]?.description).not.toBe("tampered");
  });
});

describe("administrative access", () => {
  it("lets an administrator assign a role to another user", async () => {
    await actAsAuthenticated(db, superAdmin.id);
    const target = await seedUser(db, { email: "newjoin@example.com", roleCodes: [] });

    await actAsAuthenticated(db, superAdmin.id);
    const roles = await queryRows<{ id: string }>(db, "select id from public.roles where code = 'storekeeper'");
    const inserted = await queryRows<{ id: string }>(
      db,
      "insert into public.user_roles (user_id, role_id, assigned_by) values ($1, $2, $3) returning id",
      [target.id, roles[0]?.id, superAdmin.id],
    );
    expect(inserted).toHaveLength(1);

    await actAsSuperuser(db);
    const check = await queryRows<{ count: number }>(
      db,
      "select count(*)::int as count from public.user_roles where user_id = $1 and is_active",
      [target.id],
    );
    expect(check[0]?.count).toBe(1);
  });

  it("refuses self-assignment even for an administrator through the trigger", async () => {
    await actAsSuperuser(db);
    const role = await queryRows<{ id: string }>(db, "select id from public.roles where code = 'auditor'");

    const error = await expectDbError(
      db,
      "insert into public.user_roles (user_id, role_id, assigned_by) values ($1, $2, $1)",
      [superAdmin.id, role[0]?.id],
    );
    expect(error).toMatch(/cannot assign roles to themselves/i);
  });

  it("shows role and permission catalogues to any active profile", async () => {
    await actAsAuthenticated(db, operator.id);
    const roles = await queryRows(db, "select id from public.roles");
    expect(roles.length).toBe(16);
  });
});

describe("system settings", () => {
  it("hides settings without settings.view and blocks writes without settings.manage", async () => {
    await actAsAuthenticated(db, operator.id);
    const visible = await queryRows(db, "select id from public.system_settings");
    expect(visible).toHaveLength(0);

    const updated = await queryRows(
      db,
      `update public.system_settings set setting_value = '"tampered"'::jsonb where setting_key = 'app.name' returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it("allows a system administrator to read non-sensitive settings", async () => {
    const admin = await seedUser(db, { email: "sysadmin@example.com", roleCodes: ["system_administrator"] });
    await actAsAuthenticated(db, admin.id);
    const rows = await queryRows<{ setting_key: string }>(db, "select setting_key from public.system_settings");
    expect(rows.length).toBeGreaterThan(0);
  });
});
