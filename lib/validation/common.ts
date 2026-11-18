import { z } from "zod";

export const emailField = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254)
  .email("Enter a valid email address")
  .transform((value) => value.toLowerCase());

export const optionalEmail = z.union([emailField, z.literal("")]).optional();

export const passwordField = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(72, "Use at most 72 characters")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const uuidField = z.string().uuid("Select a valid record");

export const isoDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Optional ISO date that tolerates empty strings coming from HTML forms. */
export const optionalIsoDate = z.union([isoDateField, z.literal("")]).optional();

/**
 * Money is stored as numeric(18,2). Accept form strings, coerce, and reject more than two
 * decimal places so a value can never be silently rounded on its way to the database.
 */
export const moneyField = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "string" ? value.trim() : value))
  .refine((value) => value !== "", "Enter an amount")
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value), "Enter a valid amount")
  .refine((value) => value >= 0, "Amount cannot be negative")
  .refine((value) => Math.round(value * 100) === Number((value * 100).toFixed(6)), "Use at most two decimal places")
  .refine((value) => value <= 1_000_000_000_000, "Amount is too large");

export const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as NGN");

export const reasonField = (max = 500) => z.string().trim().min(10, "Give a short reason (at least 10 characters)").max(max);

export const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Trimmed, lower-cased form value that tolerates `null` from FormData. */
export function formValue(value: FormDataEntryValue | null | undefined): string {
  if (typeof value === "string") return value;
  return "";
}
