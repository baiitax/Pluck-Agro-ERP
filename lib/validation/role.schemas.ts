import { z } from "zod";

import { PERMISSION_SCOPES } from "@/lib/permissions/definitions";
import { optionalText } from "@/lib/validation/common";

export const ROLE_CATEGORIES = [
  "system",
  "executive",
  "administration",
  "operations",
  "commercial",
  "finance",
  "assurance",
  "custom",
] as const;

export const ROLE_CATEGORY_LABELS: Record<(typeof ROLE_CATEGORIES)[number], string> = {
  system: "System",
  executive: "Executive",
  administration: "Administration",
  operations: "Operations",
  commercial: "Commercial",
  finance: "Finance",
  assurance: "Assurance",
  custom: "Custom",
};

const roleCodeField = z
  .string()
  .trim()
  .min(3, "Code is required")
  .max(48, "Use at most 48 characters")
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores")
  .optional();

export const roleCreateSchema = z.object({
  name: z.string().trim().min(3, "Role name is required").max(120),
  code: roleCodeField,
  category: z.enum(ROLE_CATEGORIES).default("custom"),
  description: optionalText(500),
});

export const roleUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(3, "Role name is required").max(120),
  category: z.enum(ROLE_CATEGORIES).default("custom"),
  description: optionalText(500),
  isActive: z.boolean().default(true),
});

export const roleCloneSchema = z.object({
  sourceRoleId: z.string().uuid(),
  name: z.string().trim().min(3, "Role name is required").max(120),
  code: z
    .string()
    .trim()
    .min(3, "Code is required")
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores"),
});

export const roleDeleteSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(10, "Give a short reason (at least 10 characters)").max(500),
});

export const rolePermissionGrantSchema = z.object({
  permissionId: z.string().uuid(),
  scopeType: z.enum(PERMISSION_SCOPES),
});

export const updateRolePermissionsSchema = z.object({
  roleId: z.string().uuid(),
  grants: z.array(rolePermissionGrantSchema).max(500),
  reason: z.string().trim().min(10, "Give a short reason (at least 10 characters)").max(500),
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
