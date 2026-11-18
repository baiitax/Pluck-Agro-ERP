"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { createPosition, updatePosition } from "@/services/positions/manage-positions";

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
    title: formValue(formData.get("title")),
    code: formValue(formData.get("code")),
    departmentId: formValue(formData.get("departmentId")),
    grade: formValue(formData.get("grade")),
    description: formValue(formData.get("description")),
    isActive: formData.get("isActive") !== "false",
  };
}

export async function createPositionAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const position = await createPosition(readForm(formData), await requestMeta());
    return actionSuccess({ id: position.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updatePositionAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const position = await updatePosition({ ...readForm(formData), id: formData.get("id") }, await requestMeta());
    return actionSuccess({ id: position.id });
  } catch (error) {
    return actionFailure(error);
  }
}
