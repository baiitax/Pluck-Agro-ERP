"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { saveAccessReview } from "@/services/governance/access-reviews";
import { createAuthority, updateAuthority } from "@/services/governance/authorities";
import { createDelegation, decideDelegation, revokeDelegation } from "@/services/governance/delegations";
import { createSodRule, grantSodOverride, updateSodRule } from "@/services/governance/sod";

async function requestMeta(): Promise<RequestMeta> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
    requestId: headerStore.get("x-request-id"),
  };
}

export async function createAuthorityAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const authority = await createAuthority(
      {
        principalType: formValue(formData.get("principalType")) || "employee",
        employeeId: formValue(formData.get("employeeId")),
        roleId: formValue(formData.get("roleId")),
        departmentId: formValue(formData.get("departmentId")),
        module: formValue(formData.get("module")),
        transactionType: formValue(formData.get("transactionType")),
        authorityLevel: formValue(formData.get("authorityLevel")) || 1,
        currencyCode: formValue(formData.get("currencyCode")) || "NGN",
        minimumAmount: formValue(formData.get("minimumAmount")),
        maximumAmount: formValue(formData.get("maximumAmount")),
        scopeType: formValue(formData.get("scopeType")) || "GLOBAL",
        effectiveFrom: formValue(formData.get("effectiveFrom")),
        effectiveUntil: formValue(formData.get("effectiveUntil")),
        justification: formValue(formData.get("justification")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: authority.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateAuthorityAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const authority = await updateAuthority(
      {
        id: formData.get("id"),
        minimumAmount: formValue(formData.get("minimumAmount")),
        maximumAmount: formValue(formData.get("maximumAmount")),
        authorityLevel: formValue(formData.get("authorityLevel")) || 1,
        effectiveUntil: formValue(formData.get("effectiveUntil")),
        justification: formValue(formData.get("justification")),
        isActive: formData.get("isActive") !== "false",
      },
      await requestMeta(),
    );
    return actionSuccess({ id: authority.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createDelegationAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const delegation = await createDelegation(
      {
        delegatorEmployeeId: formData.get("delegatorEmployeeId"),
        delegateEmployeeId: formData.get("delegateEmployeeId"),
        module: formValue(formData.get("module")),
        transactionType: formValue(formData.get("transactionType")),
        departmentId: formValue(formData.get("departmentId")),
        currencyCode: formValue(formData.get("currencyCode")) || "NGN",
        delegatedLimit: formValue(formData.get("delegatedLimit")),
        effectiveFrom: formValue(formData.get("effectiveFrom")),
        effectiveUntil: formValue(formData.get("effectiveUntil")),
        reason: formValue(formData.get("reason")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: delegation.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function decideDelegationAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const delegation = await decideDelegation(
      {
        id: formData.get("id"),
        decision: formValue(formData.get("decision")) === "approved" ? "approved" : "rejected",
        reason: formValue(formData.get("reason")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: delegation.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function revokeDelegationAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const delegation = await revokeDelegation(
      { id: formData.get("id"), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return actionSuccess({ id: delegation.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createSodRuleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const rule = await createSodRule(
      {
        name: formValue(formData.get("name")),
        code: formValue(formData.get("code")),
        module: formValue(formData.get("module")),
        transactionType: formValue(formData.get("transactionType")),
        firstAction: formValue(formData.get("firstAction")),
        conflictingAction: formValue(formData.get("conflictingAction")),
        enforcementLevel: formValue(formData.get("enforcementLevel")) || "WARN",
        description: formValue(formData.get("description")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: rule.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateSodRuleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const rule = await updateSodRule(
      {
        id: formData.get("id"),
        name: formValue(formData.get("name")),
        code: formValue(formData.get("code")),
        module: formValue(formData.get("module")),
        transactionType: formValue(formData.get("transactionType")),
        firstAction: formValue(formData.get("firstAction")),
        conflictingAction: formValue(formData.get("conflictingAction")),
        enforcementLevel: formValue(formData.get("enforcementLevel")) || "WARN",
        description: formValue(formData.get("description")),
        isActive: formData.get("isActive") !== "false",
      },
      await requestMeta(),
    );
    return actionSuccess({ id: rule.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function grantSodOverrideAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const override = await grantSodOverride(
      {
        ruleId: formData.get("ruleId"),
        employeeId: formData.get("employeeId"),
        justification: formValue(formData.get("justification")),
        expiresAt: formValue(formData.get("expiresAt")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: override.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function saveAccessReviewAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const record = await saveAccessReview(
      {
        id: formValue(formData.get("id")),
        reviewPeriod: formValue(formData.get("reviewPeriod")),
        userId: formData.get("userId"),
        reviewStatus: formValue(formData.get("reviewStatus")) || "pending",
        findings: formValue(formData.get("findings")),
        decision: formValue(formData.get("decision")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: record.id });
  } catch (error) {
    return actionFailure(error);
  }
}
