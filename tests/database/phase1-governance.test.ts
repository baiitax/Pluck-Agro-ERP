import { beforeAll, describe, expect, it } from "vitest";

import {
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
 * Phase 1 database invariants.
 *
 * Every rule asserted here is enforced by the database itself (constraints, triggers and
 * functions), not only by the service layer, so a direct API call or a future integration
 * cannot bypass it.
 */

let db: TestDatabase;
let admin: SeededUser;
let other: SeededUser;
let departmentId: string;
let childDepartmentId: string;
let employeeA: string;
let employeeB: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await actAsSuperuser(db);

  const [department] = await queryRows<{ id: string }>(
    db,
    "insert into public.departments (name, code) values ('Operations', 'OPS') returning id",
  );
  departmentId = department?.id ?? "";

  const [child] = await queryRows<{ id: string }>(
    db,
    "insert into public.departments (name, code, parent_department_id) values ('Milling', 'MILL', $1) returning id",
    [departmentId],
  );
  childDepartmentId = child?.id ?? "";

  admin = await seedUser(db, { email: "governance-admin@example.com", roleCodes: ["super_administrator"] });
  other = await seedUser(db, { email: "governance-other@example.com", roleCodes: ["finance_manager"] });
  employeeA = admin.employeeId ?? "";
  employeeB = other.employeeId ?? "";
});

describe("department hierarchy", () => {
  it("rejects a department that is its own parent", async () => {
    const error = await expectDbError(
      db,
      "update public.departments set parent_department_id = id where code = 'OPS'",
    );
    expect(error).toMatch(/cycle|parent/i);
  });

  it("rejects a cycle in the hierarchy", async () => {
    const error = await expectDbError(
      db,
      "update public.departments set parent_department_id = $1 where id = $2",
      [childDepartmentId, departmentId],
    );
    expect(error).toMatch(/cycle|loop|circular/i);
  });

  it("refuses to deactivate a department that still has active employees", async () => {
    await db.query("update public.employees set department_id = $1 where id = $2", [departmentId, employeeA]);
    const error = await expectDbError(
      db,
      "update public.departments set is_active = false where id = $1",
      [departmentId],
    );
    expect(error).toMatch(/active employee|sub-department/i);

    await db.query("update public.employees set department_id = null where id = $1", [employeeA]);
  });

  it("records an organisational history row whenever the department changes", async () => {
    await db.query("update public.employees set department_id = $1 where id = $2", [departmentId, employeeB]);
    const rows = await queryRows<{ department_id: string | null }>(
      db,
      "select department_id from public.employee_department_history where employee_id = $1 order by effective_from desc",
      [employeeB],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.department_id).toBe(departmentId);
    await db.query("update public.employees set department_id = null where id = $1", [employeeB]);
  });
});

describe("central employee numbering", () => {
  it("allocates sequential, prefixed numbers", async () => {
    const [first] = await queryRows<{ next_employee_number: string }>(db, "select public.next_employee_number()");
    const [second] = await queryRows<{ next_employee_number: string }>(db, "select public.next_employee_number()");
    expect(first?.next_employee_number).toMatch(/^PA-EMP-\d{6}$/);
    expect(second?.next_employee_number).toMatch(/^PA-EMP-\d{6}$/);
    expect(second?.next_employee_number).not.toBe(first?.next_employee_number);
  });
});

describe("ERP account lifecycle", () => {
  it("derives is_active from account_status", async () => {
    await db.query("update public.profiles set account_status = 'suspended', status_reason = 'test' where id = $1", [
      other.id,
    ]);
    const [row] = await queryRows<{ is_active: boolean; suspended_at: string | null }>(
      db,
      "select is_active, suspended_at from public.profiles where id = $1",
      [other.id],
    );
    expect(row?.is_active).toBe(false);
    expect(row?.suspended_at).not.toBeNull();

    await db.query("update public.profiles set account_status = 'active' where id = $1", [other.id]);
    const [restored] = await queryRows<{ is_active: boolean }>(
      db,
      "select is_active from public.profiles where id = $1",
      [other.id],
    );
    expect(restored?.is_active).toBe(true);
  });

  it("rejects an illegal lifecycle transition", async () => {
    await db.query("update public.profiles set account_status = 'deactivated' where id = $1", [other.id]);
    const error = await expectDbError(
      db,
      "update public.profiles set account_status = 'invited' where id = $1",
      [other.id],
    );
    expect(error).toMatch(/illegal account status transition/i);
    await db.query("update public.profiles set account_status = 'active' where id = $1", [other.id]);
  });

  it("allows only one profile per employee", async () => {
    const duplicateId = crypto.randomUUID();
    await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [
      duplicateId,
      "duplicate@example.com",
    ]);
    const error = await expectDbError(
      db,
      "insert into public.profiles (id, employee_id, display_name) values ($1, $2, 'Duplicate')",
      [duplicateId, employeeA],
    );
    expect(error).toMatch(/duplicate key|unique/i);
  });

  it("counts an invitation and stamps invited_at", async () => {
    const newId = crypto.randomUUID();
    await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [
      newId,
      "invited@example.com",
    ]);
    await db.query(
      "insert into public.profiles (id, display_name, account_status) values ($1, 'Invited User', 'invited')",
      [newId],
    );
    const [row] = await queryRows<{ invitation_count: number; invited_at: string | null }>(
      db,
      "select invitation_count, invited_at from public.profiles where id = $1",
      [newId],
    );
    expect(row?.invitation_count).toBe(1);
    expect(row?.invited_at).not.toBeNull();
  });
});

describe("roles and permissions", () => {
  it("protects system role codes from change and deletion", async () => {
    const updateError = await expectDbError(
      db,
      "update public.roles set code = 'renamed' where code = 'auditor'",
    );
    expect(updateError).toMatch(/system role/i);

    const deleteError = await expectDbError(db, "delete from public.roles where code = 'auditor'");
    expect(deleteError).toMatch(/system role/i);
  });

  it("requires three-part permission codes", async () => {
    const error = await expectDbError(
      db,
      "insert into public.permissions (module, resource, action, code, description) values ('access', 'x', 'view', 'access.x', 'Two parts only')",
    );
    expect(error).toMatch(/check constraint|code/i);
  });

  it("keeps the auditor role read-only", async () => {
    const rows = await queryRows<{ code: string }>(
      db,
      `select p.code from public.role_permissions rp
         join public.roles r on r.id = rp.role_id
         join public.permissions p on p.id = rp.permission_id
        where r.code = 'auditor'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.code.endsWith(".view"), row.code).toBe(true);
    }
  });

  it("only lets the super administrator hold every permission", async () => {
    const rows = await queryRows<{ code: string; permission_count: number }>(
      db,
      `select r.code, count(rp.permission_id)::int as permission_count
         from public.roles r
         left join public.role_permissions rp on rp.role_id = r.id
        group by r.code`,
    );
    const total = await queryRows<{ count: number }>(db, "select count(*)::int from public.permissions");
    const totalPermissions = total[0]?.count ?? 0;
    const full = rows.filter((row) => row.permission_count === totalPermissions).map((row) => row.code);
    expect(full).toEqual(["super_administrator"]);
  });
});

describe("approval authorities and delegations", () => {
  it("requires exactly one principal per authority", async () => {
    const roleId = (
      await queryRows<{ id: string }>(db, "select id from public.roles where code = 'finance_manager'")
    )[0]?.id;

    const both = await expectDbError(
      db,
      `insert into public.approval_authorities (employee_id, role_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, effective_from)
       values ($1, $2, 'procurement', 'purchase_order', 'NGN', 0, 100000, current_date)`,
      [employeeA, roleId],
    );
    expect(both).toMatch(/check constraint/i);

    const neither = await expectDbError(
      db,
      `insert into public.approval_authorities (module, transaction_type, currency_code, minimum_amount, maximum_amount, effective_from)
       values ('procurement', 'purchase_order', 'NGN', 0, 100000, current_date)`,
    );
    expect(neither).toMatch(/check constraint/i);
  });

  it("rejects a delegation that exceeds the delegator's authority", async () => {
    await db.query(
      `insert into public.approval_authorities (employee_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, effective_from)
       values ($1, 'procurement', 'purchase_order', 'NGN', 0, 500000, current_date)`,
      [employeeA],
    );

    const error = await expectDbError(
      db,
      `insert into public.approval_delegations
         (delegator_employee_id, delegate_employee_id, module, transaction_type, currency_code, delegated_limit, effective_from, effective_until, reason)
       values ($1, $2, 'procurement', 'purchase_order', 'NGN', 900000, current_date, current_date + 30, 'Exceeds the delegator limit')`,
      [employeeA, employeeB],
    );
    expect(error).toMatch(/exceed/i);
  });

  it("rejects a delegation to a person with no authority to delegate", async () => {
    const error = await expectDbError(
      db,
      `insert into public.approval_delegations
         (delegator_employee_id, delegate_employee_id, module, transaction_type, currency_code, delegated_limit, effective_from, effective_until, reason)
       values ($1, $2, 'treasury', 'payment', 'NGN', 1000, current_date, current_date + 30, 'No authority configured')`,
      [employeeA, employeeB],
    );
    expect(error).toMatch(/holds no authority|nothing can be delegated/i);
  });

  it("accepts a delegation within the delegator's authority", async () => {
    const [row] = await queryRows<{ id: string; status: string }>(
      db,
      `insert into public.approval_delegations
         (delegator_employee_id, delegate_employee_id, module, transaction_type, currency_code, delegated_limit, effective_from, effective_until, reason)
       values ($1, $2, 'procurement', 'purchase_order', 'NGN', 250000, current_date, current_date + 30, 'Annual leave cover')
       returning id, status`,
      [employeeA, employeeB],
    );
    expect(row?.status).toBe("pending_approval");
  });

  it("rejects a delegation cycle", async () => {
    await db.query("update public.approval_delegations set status = 'approved' where delegator_employee_id = $1", [
      employeeA,
    ]);

    const error = await expectDbError(
      db,
      `insert into public.approval_delegations
         (delegator_employee_id, delegate_employee_id, module, transaction_type, currency_code, delegated_limit, effective_from, effective_until, reason)
       values ($1, $2, 'procurement', 'purchase_order', 'NGN', 1000, current_date, current_date + 30, 'Closing a loop')`,
      [employeeB, employeeA],
    );
    expect(error).toMatch(/cycle|circular|loop/i);
  });
});

describe("segregation of duties", () => {
  it("seeds no rules at all", async () => {
    const [row] = await queryRows<{ count: number }>(
      db,
      "select count(*)::int from public.segregation_of_duties_rules",
    );
    expect(row?.count).toBe(0);
  });

  it("rejects two identical actions in one rule", async () => {
    const error = await expectDbError(
      db,
      `insert into public.segregation_of_duties_rules (name, code, module, transaction_type, first_action, conflicting_action)
       values ('Same action', 'SOD-SAME', 'procurement', 'purchase_order', 'approve', 'approve')`,
    );
    expect(error).toMatch(/check constraint/i);
  });

  it("requires a substantive override justification", async () => {
    const [rule] = await queryRows<{ id: string }>(
      db,
      `insert into public.segregation_of_duties_rules (name, code, module, transaction_type, first_action, conflicting_action, enforcement_level)
       values ('Buyer cannot approve', 'SOD-BUYER-APPROVER', 'procurement', 'purchase_order', 'create', 'approve', 'BLOCK')
       returning id`,
    );

    const shortJustification = await expectDbError(
      db,
      "insert into public.sod_overrides (rule_id, employee_id, justification) values ($1, $2, 'too short')",
      [rule?.id, employeeA],
    );
    expect(shortJustification).toMatch(/check constraint/i);
  });
});

describe("audit governance", () => {
  it("assigns an event id, category and severity to every event", async () => {
    const [row] = await queryRows<{ event_id: string; severity: string }>(
      db,
      `insert into public.audit_logs (action, module, event_category, severity, description)
       values ('test.phase1', 'governance', 'governance', 'warning', 'Phase 1 audit event')
       returning event_id, severity`,
    );
    expect(row?.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.severity).toBe("warning");
  });

  it("redacts secrets from audit payloads", async () => {
    const [row] = await queryRows<{ redacted: Record<string, string> }>(
      db,
      `select private.redact_audit_payload('{"password":"hunter2","token":"abc","safe":"keep"}'::jsonb) as redacted`,
    );
    expect(row?.redacted.password).toBe("«redacted»");
    expect(row?.redacted.token).toBe("«redacted»");
    expect(row?.redacted.safe).toBe("keep");
  });

  it("refuses application-user writes to the audit trail", async () => {
    await actAsAuthenticated(db, admin.id);
    const error = await expectDbError(
      db,
      `insert into public.audit_logs (action, module, event_category) values ('forged.event', 'governance', 'governance')`,
    );
    expect(error).toMatch(/permission denied/i);
    await actAsSuperuser(db);
  });
});

describe("access reviews", () => {
  it("allows one review per period and account", async () => {
    await db.query(
      `insert into public.access_review_records (review_period, user_id, review_status)
       values ('2026-Q4', $1, 'pending')`,
      [other.id],
    );
    const error = await expectDbError(
      db,
      `insert into public.access_review_records (review_period, user_id, review_status)
       values ('2026-Q4', $1, 'pending')`,
      [other.id],
    );
    expect(error).toMatch(/duplicate key|unique/i);
  });

  it("rejects a malformed review period", async () => {
    const error = await expectDbError(
      db,
      `insert into public.access_review_records (review_period, user_id) values ('2026-Q9', $1)`,
      [other.id],
    );
    expect(error).toMatch(/check constraint/i);
  });
});

describe("row level security on Phase 1 tables", () => {
  it("hides approval authorities from an operator without governance permission", async () => {
    const operator = await seedUser(db, { email: "phase1-operator@example.com", roleCodes: ["factory_operator"] });
    await actAsAuthenticated(db, operator.id);
    const rows = await queryRows(db, "select id from public.approval_authorities");
    expect(rows).toHaveLength(0);
    await actAsSuperuser(db);
  });

  it("lets a governance viewer read approval authorities", async () => {
    await actAsAuthenticated(db, admin.id);
    const rows = await queryRows(db, "select id from public.approval_authorities");
    expect(rows.length).toBeGreaterThan(0);
    await actAsSuperuser(db);
  });

  it("hides the audit trail from a user without audit permission", async () => {
    const operator = await seedUser(db, { email: "phase1-auditless@example.com", roleCodes: ["storekeeper"] });
    await actAsAuthenticated(db, operator.id);
    const rows = await queryRows(db, "select id from public.audit_logs");
    expect(rows).toHaveLength(0);
    await actAsSuperuser(db);
  });

  it("never exposes account activity to another user", async () => {
    const operator = await seedUser(db, { email: "phase1-activity@example.com", roleCodes: ["storekeeper"] });
    await actAsAuthenticated(db, operator.id);
    const rows = await queryRows(db, "select id from public.account_activity where user_id = $1", [admin.id]);
    expect(rows).toHaveLength(0);
    await actAsSuperuser(db);
  });
});

describe("session revocation stamp (0029)", () => {
  it("defaults to the epoch so existing sessions stay valid after the upgrade", async () => {
    const target = await seedUser(db, { email: "phase1-stamp@example.com" });
    const [row] = await queryRows<{ sessions_valid_after: string; sessions_revoked_at: string | null }>(
      db,
      "select sessions_valid_after, sessions_revoked_at from public.profiles where id = $1",
      [target.id],
    );
    expect(new Date(row!.sessions_valid_after).getUTCFullYear()).toBe(1970);
    expect(row!.sessions_revoked_at).toBeNull();
  });

  it("lets an account administrator stamp a new revocation instant", async () => {
    const target = await seedUser(db, { email: "phase1-stamp-target@example.com" });
    await actAsAuthenticated(db, admin.id);
    // PGlite throws on a rejected statement, so a resolved promise is the assertion.
    await expect(
      db.query(
        "update public.profiles set sessions_valid_after = now(), sessions_revoked_at = now(), sessions_revoked_by = $2 where id = $1",
        [target.id, admin.id],
      ),
    ).resolves.toBeDefined();

    const [row] = await queryRows<{ sessions_valid_after: string; sessions_revoked_by: string | null }>(
      db,
      "select sessions_valid_after, sessions_revoked_by from public.profiles where id = $1",
      [target.id],
    );
    expect(new Date(row!.sessions_valid_after).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(row!.sessions_revoked_by).toBe(admin.id);
    await actAsSuperuser(db);
  });

  it("stops a user from clearing their own revocation stamp", async () => {
    const target = await seedUser(db, {
      email: "phase1-self-clear@example.com",
      roleCodes: ["storekeeper"],
    });
    await actAsSuperuser(db);
    await db.query("update public.profiles set sessions_valid_after = now() where id = $1", [target.id]);

    await actAsAuthenticated(db, target.id);
    await db.query("update public.profiles set sessions_valid_after = 'epoch' where id = $1", [target.id]);

    const [row] = await queryRows<{ sessions_valid_after: string }>(
      db,
      "select sessions_valid_after from public.profiles where id = $1",
      [target.id],
    );
    // The guard restores the old value: the stamp is still in the present, not the epoch.
    expect(new Date(row!.sessions_valid_after).getUTCFullYear()).toBeGreaterThan(2000);
    await actAsSuperuser(db);
  });
});
