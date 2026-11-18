import { describe, expect, it } from "vitest";

import {
  assignRoleSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  provisionAccountSchema,
  updateAccountStatusSchema,
} from "@/lib/validation/schemas";

describe("login schema", () => {
  it("normalises the email address", () => {
    const parsed = loginSchema.parse({ email: "  Ada.Obi@PluckAgro.COM ", password: "secret" });
    expect(parsed.email).toBe("ada.obi@pluckagro.com");
  });

  it("rejects an invalid email and an empty password", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path[0]);
      expect(paths).toContain("email");
      expect(paths).toContain("password");
    }
  });
});

describe("password policy", () => {
  it.each([
    ["short1A", "at least 10"],
    ["alllowercase1", "uppercase"],
    ["ALLUPPERCASE1", "lowercase"],
    ["NoNumberHere!", "number"],
  ])("rejects %s", (password, expected) => {
    const result = resetPasswordSchema.safeParse({ password, confirmPassword: password });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toContain(expected);
    }
  });

  it("requires matching confirmation", () => {
    const result = resetPasswordSchema.safeParse({
      password: "StrongPassw0rd",
      confirmPassword: "StrongPassw0rd!",
    });
    expect(result.success).toBe(false);
  });
});

describe("employee schema", () => {
  const base = {
    employeeNumber: "PA-0012",
    firstName: "Ada",
    lastName: "Obi",
    employmentStatus: "active" as const,
  };

  it("accepts a minimal valid employee", () => {
    expect(employeeCreateSchema.parse(base).employeeNumber).toBe("PA-0012");
  });

  it("rejects an invalid employee number format", () => {
    expect(employeeCreateSchema.safeParse({ ...base, employeeNumber: "PA 0012" }).success).toBe(false);
  });

  it("accepts all seven employment statuses and rejects anything else", () => {
    for (const status of ["active", "probation", "on_leave", "suspended", "resigned", "terminated", "retired"]) {
      expect(employeeCreateSchema.safeParse({ ...base, employmentStatus: status }).success, status).toBe(true);
    }
    expect(employeeCreateSchema.safeParse({ ...base, employmentStatus: "deceased" }).success).toBe(false);
  });

  it("allows a blank employee number so the server can allocate one", () => {
    const parsed = employeeCreateSchema.parse({ ...base, employeeNumber: "" });
    expect(parsed.employeeNumber).toBe("");
  });

  it("requires an ISO date for dateJoined", () => {
    expect(employeeCreateSchema.safeParse({ ...base, dateJoined: "12/03/2026" }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ ...base, dateJoined: "2026-03-12" }).success).toBe(true);
  });

  it("requires a UUID for departments and ids", () => {
    expect(employeeCreateSchema.safeParse({ ...base, departmentId: "production" }).success).toBe(false);
    expect(employeeUpdateSchema.safeParse({ ...base, id: "abc" }).success).toBe(false);
  });
});

describe("access administration schemas", () => {
  it("requires UUIDs for role assignment", () => {
    expect(assignRoleSchema.safeParse({ userId: "1", roleId: "2" }).success).toBe(false);
    expect(
      assignRoleSchema.safeParse({
        userId: "6f1c1c34-9f45-4f1a-9a0f-2d5f0f5f1a11",
        roleId: "a1c1c1c1-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("requires a reasoned, valid account lifecycle change", () => {
    const userId = "6f1c1c34-9f45-4f1a-9a0f-2d5f0f5f1a11";
    expect(updateAccountStatusSchema.safeParse({ userId, status: "active", reason: "Reinstated after review" }).success).toBe(true);
    expect(updateAccountStatusSchema.safeParse({ userId, status: "deleted", reason: "remove" }).success).toBe(false);
    expect(updateAccountStatusSchema.safeParse({ userId, status: "active", reason: "" }).success).toBe(false);
  });

  it("requires at least one role and a justification to provision an account", () => {
    const employeeId = "6f1c1c34-9f45-4f1a-9a0f-2d5f0f5f1a11";
    const roleId = "a1c1c1c1-1111-4111-8111-111111111111";
    expect(
      provisionAccountSchema.safeParse({ employeeId, roleIds: [], reason: "New finance officer starting Monday" }).success,
    ).toBe(false);
    expect(
      provisionAccountSchema.safeParse({ employeeId, roleIds: [roleId], reason: "New finance officer starting Monday" })
        .success,
    ).toBe(true);
  });

  it("validates reset email addresses", () => {
    expect(forgotPasswordSchema.safeParse({ email: "ada@pluckagro.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "ada@" }).success).toBe(false);
  });
});
