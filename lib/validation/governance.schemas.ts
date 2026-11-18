import { z } from "zod";

import { PERMISSION_SCOPES } from "@/lib/permissions/definitions";
import { currencyField, isoDateField, moneyField, optionalIsoDate, optionalText, reasonField, uuidField } from "@/lib/validation/common";

const ENFORCEMENT_LEVELS = ["BLOCK", "WARN", "REQUIRE_OVERRIDE"] as const;

export const authorityCreateSchema = z
  .object({
    principalType: z.enum(["employee", "role"]),
    employeeId: z.union([uuidField, z.literal("")]).optional(),
    roleId: z.union([uuidField, z.literal("")]).optional(),
    departmentId: z.union([uuidField, z.literal("")]).optional(),
    module: z.string().trim().min(2, "Select a module").max(48),
    transactionType: z.string().trim().min(2, "Enter the transaction type").max(80),
    authorityLevel: z.coerce.number().int().min(1).max(10).default(1),
    currencyCode: currencyField,
    minimumAmount: moneyField,
    maximumAmount: moneyField,
    scopeType: z.enum(PERMISSION_SCOPES).default("GLOBAL"),
    effectiveFrom: isoDateField,
    effectiveUntil: optionalIsoDate,
    justification: reasonField(500),
  })
  .superRefine((value, ctx) => {
    if (value.principalType === "employee" && !value.employeeId) {
      ctx.addIssue({ code: "custom", path: ["employeeId"], message: "Select the employee who holds this authority." });
    }
    if (value.principalType === "role" && !value.roleId) {
      ctx.addIssue({ code: "custom", path: ["roleId"], message: "Select the role that holds this authority." });
    }
  });

export const authorityUpdateSchema = z.object({
  id: uuidField,
  minimumAmount: moneyField,
  maximumAmount: moneyField,
  authorityLevel: z.coerce.number().int().min(1).max(10).default(1),
  effectiveUntil: optionalIsoDate,
  justification: reasonField(500),
  isActive: z.boolean().default(true),
});

export const delegationCreateSchema = z.object({
  delegatorEmployeeId: uuidField,
  delegateEmployeeId: uuidField,
  module: z.string().trim().min(2, "Select a module").max(48),
  transactionType: z.string().trim().min(2, "Enter the transaction type").max(80),
  departmentId: z.union([uuidField, z.literal("")]).optional(),
  currencyCode: currencyField,
  delegatedLimit: moneyField,
  effectiveFrom: isoDateField,
  effectiveUntil: isoDateField,
  reason: reasonField(500),
});

export const delegationDecisionSchema = z.object({
  id: uuidField,
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(3, "State a reason").max(500),
});

export const delegationRevokeSchema = z.object({
  id: uuidField,
  reason: reasonField(500),
});

export const sodRuleCreateSchema = z.object({
  name: z.string().trim().min(3, "Rule name is required").max(160),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,40}$/, "Use 3–40 uppercase letters, numbers, underscore or hyphen"),
  module: z.string().trim().min(2).max(48),
  transactionType: z.string().trim().min(2, "Enter the transaction type").max(80),
  firstAction: z.string().trim().min(2, "Enter the first action").max(80),
  conflictingAction: z.string().trim().min(2, "Enter the conflicting action").max(80),
  enforcementLevel: z.enum(ENFORCEMENT_LEVELS).default("WARN"),
  description: optionalText(500),
});

export const sodRuleUpdateSchema = sodRuleCreateSchema.extend({
  id: uuidField,
  isActive: z.boolean().default(true),
});

export const sodOverrideSchema = z.object({
  ruleId: uuidField,
  employeeId: uuidField,
  justification: reasonField(500),
  expiresAt: optionalIsoDate,
});

export const accessReviewUpsertSchema = z.object({
  id: z.union([uuidField, z.literal("")]).optional(),
  reviewPeriod: z
    .string()
    .trim()
    .regex(/^(\d{4})-(Q[1-4]|0[1-9]|1[0-2])$/, "Use YYYY-Qn or YYYY-MM"),
  userId: uuidField,
  reviewStatus: z.enum(["pending", "in_review", "completed", "flagged"]).default("pending"),
  findings: optionalText(2000),
  decision: z.union([z.enum(["retain", "amend", "revoke"]), z.literal("")]).optional(),
});

export type AuthorityCreateInput = z.infer<typeof authorityCreateSchema>;
export type DelegationCreateInput = z.infer<typeof delegationCreateSchema>;
export type SodRuleCreateInput = z.infer<typeof sodRuleCreateSchema>;
export type AccessReviewUpsertInput = z.infer<typeof accessReviewUpsertSchema>;
