"use server";

import { headers } from "next/headers";

import { actionFailure, actionSuccess, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import {
  addEmergencyContact,
  removeEmergencyContact,
} from "@/services/employees/manage-emergency-contacts";
import {
  createEmployee,
  deactivateEmployee,
  updateEmployee,
  type RequestMeta,
} from "@/services/employees/manage-employee";

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
    employeeNumber: formValue(formData.get("employeeNumber")),
    firstName: formValue(formData.get("firstName")),
    middleName: formValue(formData.get("middleName")),
    lastName: formValue(formData.get("lastName")),
    email: formValue(formData.get("email")),
    phone: formValue(formData.get("phone")),
    departmentId: formValue(formData.get("departmentId")),
    positionId: formValue(formData.get("positionId")),
    supervisorId: formValue(formData.get("supervisorId")),
    jobTitle: formValue(formData.get("jobTitle")),
    employmentType: formValue(formData.get("employmentType")) || "full_time",
    employmentStatus: formValue(formData.get("employmentStatus")) || "active",
    employeeCategory: formValue(formData.get("employeeCategory")),
    workLocation: formValue(formData.get("workLocation")),
    notes: formValue(formData.get("notes")),
    dateJoined: formValue(formData.get("dateJoined")),
    employmentEndDate: formValue(formData.get("employmentEndDate")),
  };
}

export async function createEmployeeAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const employee = await createEmployee(readForm(formData), await requestMeta());
    return actionSuccess({ id: employee.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateEmployeeAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const employee = await updateEmployee(
      { ...readForm(formData), id: formData.get("id") },
      await requestMeta(),
    );
    return actionSuccess({ id: employee.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deactivateEmployeeAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const employee = await deactivateEmployee(
      {
        id: formData.get("id"),
        reason: formValue(formData.get("reason")),
        employmentEndDate: formValue(formData.get("employmentEndDate")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: employee.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function addEmergencyContactAction(
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const contact = await addEmergencyContact(
      {
        employeeId: formData.get("employeeId"),
        contactName: formValue(formData.get("contactName")),
        relationship: formValue(formData.get("relationship")),
        phone: formValue(formData.get("phone")),
      },
      await requestMeta(),
    );
    return actionSuccess({ id: contact.id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function removeEmergencyContactAction(
  _prevState: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    await removeEmergencyContact(
      { id: formData.get("id"), employeeId: formData.get("employeeId") },
      await requestMeta(),
    );
    return actionSuccess(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}
