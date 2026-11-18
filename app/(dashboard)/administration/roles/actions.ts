"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { cloneRole, createRole, deleteRole, updateRole } from "@/services/roles/manage-role";
import { updateRolePermissions } from "@/services/roles/manage-role-permissions";

async function requestMeta(): Promise<RequestMeta> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
    requestId: headerStore.get("x-request-id"),
  };
}

export async function createRoleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const role = await createRole(
      {
        name: formValue(formData.get("name")),
        code: formValue(formData.get("code")),
        category: formValue(formData.get("category")) || "custom",
        description: formValue(formData.get("description")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: role.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateRoleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const role = await updateRole(
      {
        id: formData.get("id"),
        name: formValue(formData.get("name")),
        category: formValue(formData.get("category")) || "custom",
        description: formValue(formData.get("description")),
        isActive: formData.get("isActive") !== "false",
      },
      await requestMeta(),
    );
    return actionSuccess({ id: role.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function cloneRoleAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const role = await cloneRole(
      {
        sourceRoleId: formData.get("sourceRoleId"),
        name: formValue(formData.get("name")),
        code: formValue(formData.get("code")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: role.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteRoleAction(
  _prevState: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    await deleteRole(
      { id: formData.get("id"), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return actionSuccess(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateRolePermissionsAction(
  _prevState: ActionResult<{ added: number; removed: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ added: number; removed: number }>> {
  try {
    const raw = formValue(formData.get("grants"));
    const parsed = raw
      ? (JSON.parse(raw) as { permissionId: string; scopeType: string }[])
      : [];
    const diff = await updateRolePermissions(
      {
        roleId: formData.get("roleId"),
        grants: parsed,
        reason: formValue(formData.get("reason")),
      },
      await requestMeta(),
    );
    return actionSuccess({ added: diff.added.length, removed: diff.removed.length });
  } catch (error) {
    return actionFailure(error);
  }
}
