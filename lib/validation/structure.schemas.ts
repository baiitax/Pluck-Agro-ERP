import { z } from "zod";

import { optionalText } from "@/lib/validation/common";

const codeField = z
  .string()
  .trim()
  .min(2, "Code is required")
  .max(24, "Use at most 24 characters")
  .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
  .transform((value) => value.toUpperCase());

export const departmentCreateSchema = z.object({
  name: z.string().trim().min(2, "Department name is required").max(120),
  code: codeField,
  description: optionalText(500),
  parentDepartmentId: z.union([z.string().uuid(), z.literal("")]).optional(),
  departmentHeadEmployeeId: z.union([z.string().uuid(), z.literal("")]).optional(),
  costCenterCode: optionalText(32),
  isActive: z.boolean().default(true),
});

export const departmentUpdateSchema = departmentCreateSchema.extend({
  id: z.string().uuid(),
});

export const departmentDeactivateSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(10, "Give a short reason (at least 10 characters)").max(500),
});

export const positionCreateSchema = z.object({
  title: z.string().trim().min(2, "Position title is required").max(120),
  code: codeField,
  departmentId: z.union([z.string().uuid(), z.literal("")]).optional(),
  grade: optionalText(24),
  description: optionalText(500),
  isActive: z.boolean().default(true),
});

export const positionUpdateSchema = positionCreateSchema.extend({
  id: z.string().uuid(),
});

export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type PositionCreateInput = z.infer<typeof positionCreateSchema>;
