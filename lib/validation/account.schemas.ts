import { z } from "zod";

import { ACCOUNT_STATUSES } from "@/lib/constants/statuses";
import { optionalEmail, reasonField, uuidField } from "@/lib/validation/common";

export const provisionAccountSchema = z.object({
  employeeId: uuidField,
  /** Optional override. Defaults to the employee's recorded email address. */
  email: optionalEmail,
  roleIds: z
    .array(uuidField)
    .min(1, "Select at least one role")
    .max(10, "Assign at most 10 roles at provisioning time"),
  reason: reasonField(500),
});

export const updateAccountStatusSchema = z.object({
  userId: uuidField,
  status: z.enum(ACCOUNT_STATUSES),
  reason: z.string().trim().min(3, "State a reason").max(500),
});

export const resendInvitationSchema = z.object({
  userId: uuidField,
  reason: z.string().trim().min(3, "State a reason").max(500),
});

export const revokeSessionsSchema = z.object({
  userId: uuidField,
  reason: reasonField(500),
});

export const changeEmployeeLinkSchema = z.object({
  userId: uuidField,
  employeeId: z.union([uuidField, z.literal("")]),
  reason: reasonField(500),
});

export type ProvisionAccountInput = z.infer<typeof provisionAccountSchema>;
export type UpdateAccountStatusInput = z.infer<typeof updateAccountStatusSchema>;
