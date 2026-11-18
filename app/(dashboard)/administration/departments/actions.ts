"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import { createDepartment, deactivateDepartment, updateDepartment } from "@/services/departments/manage-departments";
import type { RequestMeta } from "@/services/employees/manage-employee";

async function requestMeta(): Promise<RequestMeta> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
    requestId: headerStore.get("x-request-id"),
  };
}

function readForm(formData: FormData) {
  return {
    name: formValue(formData.get("name")),
    code: formValue(formData.get("code")),
    description: formValue(formData.get("description")),
    parentDepartmentId: formValue(formData.get("parentDepartmentId")),
    departmentHeadEmployeeId: formValue(formData.get("departmentHeadEmployeeId")),
    costCenterCode: formValue(formData.get("costCenterCode")),
    isActive: formData.get("isActive") !== "false",
  };
}

export async function createDepartmentAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const department = await createDepartment(readForm(formData), await requestMeta());
    return actionSuccess({ id: department.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateDepartmentAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const department = await updateDepartment(
      { ...readForm(formData), id: formData.get("id") },
      await requestMeta(),
    );
    return actionSuccess({ id: department.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deactivateDepartmentAction(
  _prevState: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    await deactivateDepartment(
      { id: formData.get("id"), reason: formValue(formData.get("reason")) },
      await requestMeta(),
    );
    return actionSuccess(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}
