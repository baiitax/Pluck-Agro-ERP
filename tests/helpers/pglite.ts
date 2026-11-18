import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * Isolated PostgreSQL harness for migration and RLS tests.
 *
 * Runs the real migration files against PGlite (PostgreSQL compiled to WASM) with a minimal
 * Supabase-compatible `auth` schema. This lets us verify database-level behavior — constraints,
 * triggers, policies and privileges — without a live Supabase project. It does NOT replace
 * testing against the deployed database, and it does not exercise Supabase Auth itself.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const SUPABASE_BOOTSTRAP = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key,
    email text,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz
  );

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end;
  $$;

  grant usage on schema public to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  return db;
}

async function roleId(db: PGlite, roleCode: string): Promise<string> {
  const result = await db.query<{ id: string }>("select id from public.roles where code = $1", [roleCode]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Unknown role code: ${roleCode}`);
  return id;
}

export type SeedUserOptions = {
  email: string;
  isActive?: boolean;
  roleCodes?: string[];
  expiresAt?: string | null;
  assignedAt?: string | null;
  withEmployee?: boolean;
  employeeStatus?:
    | "active"
    | "probation"
    | "on_leave"
    | "suspended"
    | "resigned"
    | "terminated"
    | "retired";
  accountStatus?: "invited" | "pending_setup" | "active" | "suspended" | "deactivated" | "locked";
};

export type SeededUser = { id: string; employeeId: string | null };

/** Creates an auth user + ERP profile (+ optional employee and roles) as the superuser. */
export async function seedUser(db: PGlite, options: SeedUserOptions): Promise<SeededUser> {
  await db.exec("reset role");
  const id = crypto.randomUUID();
  let employeeId: string | null = null;

  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [
    id,
    options.email,
  ]);

  if (options.withEmployee !== false) {
    employeeId = crypto.randomUUID();
    await db.query(
      "insert into public.employees (id, employee_number, first_name, last_name, email, employment_status) values ($1, $2, $3, $4, $5, $6)",
      [
        employeeId,
        `EMP-${id.slice(0, 8)}`,
        "Test",
        options.email.split("@")[0] ?? "User",
        options.email,
        options.employeeStatus ?? "active",
      ],
    );
  }

  // `is_active` is derived from `account_status` by a trigger, so the lifecycle status is what
  // must be set here — writing is_active directly would be overwritten.
  const accountStatus = options.accountStatus ?? (options.isActive === false ? "deactivated" : "active");
  await db.query(
    "insert into public.profiles (id, employee_id, display_name, account_status) values ($1, $2, $3, $4)",
    [id, employeeId, options.email.split("@")[0] ?? "Test User", accountStatus],
  );

  for (const roleCode of options.roleCodes ?? []) {
    await db.query(
      "insert into public.user_roles (user_id, role_id, expires_at, assigned_at) values ($1, $2, $3, coalesce($4::timestamptz, now()))",
      [id, await roleId(db, roleCode), options.expiresAt ?? null, options.assignedAt ?? null],
    );
  }

  return { id, employeeId };
}

/** Runs subsequent statements as the Supabase `authenticated` role with a JWT subject. */
export async function actAsAuthenticated(db: PGlite, userId: string): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

/** Runs subsequent statements as anon without a JWT subject. */
export async function actAsAnon(db: PGlite): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role anon");
}

/** Restores the privileged (migration-owner) session. */
export async function actAsSuperuser(db: PGlite): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

export async function queryRows<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params as never[]);
  return result.rows;
}

export async function expectDbError(db: PGlite, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params as never[]);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`Expected the database to reject: ${sql}`);
}
