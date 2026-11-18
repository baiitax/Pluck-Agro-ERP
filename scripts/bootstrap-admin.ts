#!/usr/bin/env node
/**
 * Bootstraps the first Super Administrator.
 *
 * Phase 0 deliberately ships no default credentials and no seeded admin user. Provisioning is
 * an explicit, auditable, operator-driven step:
 *
 *   1. Create (or identify) the Supabase Auth user in the Supabase dashboard, or let this
 *      script create it with a password you supply.
 *   2. Run this script with the service-role key available in the environment.
 *   3. The script creates the ERP profile (if missing), links it to an employee record when
 *      provided, assigns the super_administrator role and writes an audit event.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin:bootstrap -- \
 *     --email md@pluckagro.com --password 'ChangeMe-Str0ng!' --name "Managing Director" \
 *     [--employee-number PA-0001] [--employee-name "Ada Obi"]
 *
 * Requires Node 20+ with --experimental-strip-types (configured in package.json).
 */
import { createClient } from "@supabase/supabase-js";

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const email = args.email;
  if (!email) throw new Error("--email is required.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.info(`[bootstrap] provisioning ERP access for ${email}`);

  // 1. Auth user -----------------------------------------------------------
  let userId: string | null = null;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: args.password,
    email_confirm: true,
  });

  if (createError) {
    if (!/already|exists|registered/i.test(createError.message)) {
      throw new Error(`Could not create auth user: ${createError.message}`);
    }
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = list?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
    if (!userId) throw new Error("An auth user exists but could not be located; create the profile manually.");
    console.info("[bootstrap] reusing existing auth user", userId);
  } else {
    userId = created.user?.id ?? null;
  }

  if (!userId) throw new Error("Failed to resolve the auth user id.");

  // 2. Employee (optional) -------------------------------------------------
  let employeeId: string | null = null;
  if (args["employee-number"]) {
    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .upsert(
        {
          employee_number: args["employee-number"],
          first_name: (args["employee-name"] ?? args.name ?? email).split(" ")[0] ?? "ERP",
          last_name: (args["employee-name"] ?? args.name ?? "User").split(" ").slice(1).join(" ") || "User",
          email,
          employment_status: "active",
        },
        { onConflict: "employee_number" },
      )
      .select("id")
      .single();

    if (employeeError) throw new Error(`Could not create employee record: ${employeeError.message}`);
    employeeId = employee?.id ?? null;
  }

  // 3. Profile -------------------------------------------------------------
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      employee_id: employeeId,
      display_name: args.name ?? email.split("@")[0],
      is_active: true,
    },
    { onConflict: "id" },
  );
  if (profileError) throw new Error(`Could not create profile: ${profileError.message}`);

  // 4. Super Administrator role -------------------------------------------
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id, code")
    .eq("code", "super_administrator")
    .single();
  if (roleError || !role) {
    throw new Error("The super_administrator role is missing. Apply the seed migrations first.");
  }

  const { error: assignmentError } = await admin.from("user_roles").insert({
    user_id: userId,
    role_id: role.id,
    is_active: true,
  });
  if (assignmentError && !/duplicate|unique/i.test(assignmentError.message)) {
    throw new Error(`Could not assign the super administrator role: ${assignmentError.message}`);
  }

  // 5. Audit trail ---------------------------------------------------------
  await admin.from("audit_logs").insert({
    actor_user_id: null,
    action: "system.admin_bootstrapped",
    module: "system",
    entity_type: "profile",
    entity_id: userId,
    description: `Bootstrapped Super Administrator access for ${email} via the provisioning script.`,
  });

  console.info("[bootstrap] done. The account can now sign in at /login.");
  console.info("[bootstrap] the account must change its password after first sign-in.");
}

main().catch((error: unknown) => {
  console.error("[bootstrap] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
