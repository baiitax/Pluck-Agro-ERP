import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  actAsSuperuser,
  createTestDatabase,
  expectDbError,
  queryRows,
  seedUser,
  type TestDatabase,
} from "../helpers/pglite";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("migrations", () => {
  it("creates every Phase 0 foundational table", async () => {
    const rows = await queryRows<{ table_name: string }>(
      db,
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const tables = rows.map((row) => row.table_name);

    for (const table of [
      "approval_limits",
      "audit_logs",
      "departments",
      "employees",
      "permissions",
      "profiles",
      "role_permissions",
      "roles",
      "system_settings",
      "user_roles",
    ]) {
      expect(tables).toContain(table);
    }
  });

  it("enables row level security on every application table", async () => {
    const rows = await queryRows<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
    }
  });

  it("declares foreign keys for cross-table relationships", async () => {
    const rows = await queryRows<{ constraint_name: string }>(
      db,
      `select constraint_name from information_schema.table_constraints
        where table_schema = 'public' and constraint_type = 'FOREIGN KEY'`,
    );
    const names = rows.map((row) => row.constraint_name);

    expect(names).toContain("profiles_employee_id_fkey");
    expect(names).toContain("user_roles_user_id_fkey");
    expect(names).toContain("user_roles_role_id_fkey");
    expect(names).toContain("role_permissions_role_id_fkey");
    expect(names).toContain("employees_department_id_fkey");
  });

  it("seeds 16 system roles, the full permission catalogue and grants", async () => {
    const [counts] = await queryRows<{ roles: number; permissions: number; grants: number }>(
      db,
      `select (select count(*)::int from public.roles) as roles,
              (select count(*)::int from public.permissions) as permissions,
              (select count(*)::int from public.role_permissions) as grants`,
    );

    expect(counts?.roles).toBe(16);
    expect(counts?.permissions).toBeGreaterThanOrEqual(75);
    expect(counts?.grants).toBeGreaterThan(300);
  });

  it("re-running the Phase 1 seed migrations is idempotent", async () => {
    // 0012-0014 are the superseded Phase 0 two-part seeds; 0025-0027 replaced them and are the
    // only seed files that must remain re-runnable against the current schema.
    for (const file of [
      "0025_seed_phase_1_permissions.sql",
      "0026_seed_phase_1_roles.sql",
      "0027_seed_phase_1_grants.sql",
    ]) {
      const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
      await db.exec(sql);
    }

    const [counts] = await queryRows<{ roles: number; permissions: number }>(
      db,
      `select (select count(*)::int from public.roles) as roles,
              (select count(*)::int from public.permissions) as permissions`,
    );
    expect(counts?.roles).toBe(16);
    expect(counts?.permissions).toBeGreaterThanOrEqual(44);
  });

  it("rejects duplicate employee numbers and invalid employment status", async () => {
    await actAsSuperuser(db);
    await db.query(
      "insert into public.departments (name, code) values ('Production', 'PROD') on conflict (code) do nothing",
    );
    const department = await queryRows<{ id: string }>(db, "select id from public.departments where code = 'PROD'");

    await db.query(
      "insert into public.employees (employee_number, first_name, last_name, department_id) values ('EMP-DUP-1', 'Ada', 'Obi', $1)",
      [department[0]?.id],
    );

    const duplicate = await expectDbError(
      db,
      "insert into public.employees (employee_number, first_name, last_name) values ('EMP-DUP-1', 'Ada', 'Obi')",
    );
    expect(duplicate).toMatch(/duplicate key|unique/i);

    const badStatus = await expectDbError(
      db,
      "insert into public.employees (employee_number, first_name, last_name, employment_status) values ('EMP-BAD-1', 'Ada', 'Obi', 'deceased')",
    );
    expect(badStatus).toMatch(/check constraint/i);
  });

  it("enforces one approval-limit holder and valid amount ranges", async () => {
    await actAsSuperuser(db);
    const { id: userId } = await seedUser(db, { email: "approval@example.com", roleCodes: [] });

    const bothHolders = await expectDbError(
      db,
      `insert into public.approval_limits (user_id, role_id, module, transaction_type, maximum_amount)
       values ($1, (select id from public.roles limit 1), 'procurement', 'purchase_order', 1000)`,
      [userId],
    );
    expect(bothHolders).toMatch(/check constraint/i);

    const invertedRange = await expectDbError(
      db,
      `insert into public.approval_limits (user_id, module, transaction_type, minimum_amount, maximum_amount)
       values ($1, 'procurement', 'purchase_order', 5000, 1000)`,
      [userId],
    );
    expect(invertedRange).toMatch(/check constraint/i);
  });

  it("keeps audit history append-only at the database level", async () => {
    await actAsSuperuser(db);
    await db.query(
      "insert into public.audit_logs (action, module, description) values ('test.event', 'system', 'seed event')",
    );

    const updateError = await expectDbError(db, "update public.audit_logs set description = 'tampered'");
    expect(updateError).toMatch(/append-only/i);

    const deleteError = await expectDbError(db, "delete from public.audit_logs");
    expect(deleteError).toMatch(/append-only/i);
  });

  it("records every row timestamp in UTC", async () => {
    const rows = await queryRows<{ column_name: string; data_type: string }>(
      db,
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and column_name in ('created_at', 'updated_at')
        group by column_name, data_type`,
    );
    for (const row of rows) {
      expect(row.data_type).toBe("timestamp with time zone");
    }
  });
});
