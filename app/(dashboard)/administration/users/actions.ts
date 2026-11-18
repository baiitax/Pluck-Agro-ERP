"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import {
  provisionAccount,
  resendInvitation,
  revokeAccountSessions,
  updateAccountStatus,
} from "@/services/accounts/manage-account";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { assignRole, revokeRole } from "@/services/users/manage-access";

async function requestMeta(): Promise<RequestMeta> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
    requestId: headerStore.get("x-request-id"),
  };
}

export async function provisionAccountAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const result = await provisionAccount(
      {
        employeeId: formData.get("employeeId"),
        email: formValue(formData.get("email")),
        roleIds: formData.getAll("roleIds").map(String),
        reason: formValue(formData.get("reason")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: result.profile.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateAccountStatusAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const profile = await updateAccountStatus(
      {
        userId: formData.get("userId"),
        status: formValue(formData.get("status")),
        reason: formValue(formData.get("reason")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: profile.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resendInvitationAction(
  _prevState: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    await resendInvitation(
      { userId: formData.get("userId"), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return actionSuccess(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function revokeSessionsAction(
  _prevState: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    await revokeAccountSessions(
      { userId: formData.get("userId"), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return actionSuccess(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function assignRoleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const assignment = await assignRole(
      {
        userId: formData.get("userId"),
        roleId: formData.get("roleId"),
        expiresAt: formValue(formData.get("expiresAt")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: assignment.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function revokeRoleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const assignment = await revokeRole(
      { assignmentId: formData.get("assignmentId"), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return actionSuccess({ id: assignment.id });
  } catch (error) {
    return actionFailure(error);
  }
}
