import { z } from "zod";

import { EMPLOYMENT_STATUSES } from "@/lib/constants/statuses";
import { optionalEmail, optionalIsoDate, optionalText, uuidField } from "@/lib/validation/common";

const employeeNumberField = z
  .string()
  .trim()
  .max(32, "Use at most 32 characters")
  .regex(/^[A-Za-z0-9./_-]*$/, "Use letters, numbers, dot, slash, underscore or hyphen only")
  .optional()
  .default("");

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "intern",
  "consultant",
  "casual",
] as const;

export const EMPLOYMENT_TYPE_LABELS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
  casual: "Casual",
};

export const EMPLOYEE_CATEGORIES = [
  "management",
  "senior_staff",
  "staff",
  "supervisor",
  "operator",
  "support",
] as const;

export const EMPLOYEE_CATEGORY_LABELS: Record<(typeof EMPLOYEE_CATEGORIES)[number], string> = {
  management: "Management",
  senior_staff: "Senior staff",
  staff: "Staff",
  supervisor: "Supervisor",
  operator: "Operator",
  support: "Support",
};

export const employeeCreateSchema = z.object({
  /** Leave blank to let the server allocate the next number from the configured sequence. */
  employeeNumber: employeeNumberField,
  firstName: z.string().trim().min(1, "First name is required").max(80),
  middleName: optionalText(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: optionalEmail,
  phone: optionalText(32),
  departmentId: z.union([uuidField, z.literal("")]).optional(),
  positionId: z.union([uuidField, z.literal("")]).optional(),
  supervisorId: z.union([uuidField, z.literal("")]).optional(),
  jobTitle: optionalText(120),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).default("active"),
  employeeCategory: z.union([z.enum(EMPLOYEE_CATEGORIES), z.literal("")]).optional(),
  workLocation: optionalText(120),
  notes: optionalText(2000),
  dateJoined: optionalIsoDate,
  employmentEndDate: optionalIsoDate,
});

export const employeeUpdateSchema = employeeCreateSchema.extend({
  id: uuidField,
});

export const employeeDeactivateSchema = z.object({
  id: uuidField,
  reason: z.string().trim().min(10, "Give a short reason (at least 10 characters)").max(500),
  employmentEndDate: optionalIsoDate,
});

export const emergencyContactSchema = z.object({
  employeeId: uuidField,
  contactName: z.string().trim().min(2, "Contact name is required").max(120),
  relationship: optionalText(60),
  phone: z.string().trim().min(6, "Enter a phone number").max(32),
});

export const emergencyContactDeleteSchema = z.object({
  id: uuidField,
  employeeId: uuidField,
});

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;
