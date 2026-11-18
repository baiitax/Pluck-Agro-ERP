import { z } from "zod";

import { emailField, passwordField, uuidField } from "@/lib/validation/common";

export * from "@/lib/validation/employee.schemas";
export * from "@/lib/validation/structure.schemas";
export * from "@/lib/validation/account.schemas";
export * from "@/lib/validation/role.schemas";
export * from "@/lib/validation/governance.schemas";

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const assignRoleSchema = z.object({
  userId: uuidField,
  roleId: uuidField,
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
});

export const revokeRoleSchema = z.object({
  assignmentId: uuidField,
  reason: z.string().trim().max(280).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
