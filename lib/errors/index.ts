import { z } from "zod";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "PROFILE_NOT_FOUND"
  | "ACCOUNT_INACTIVE"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONFIGURATION_ERROR"
  | "DATABASE_ERROR"
  | "UNEXPECTED_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { status?: number; details?: Record<string, string[]> },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options?.status ?? defaultStatus(code);
    this.details = options?.details;
  }
}

function defaultStatus(code: AppErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "PROFILE_NOT_FOUND":
    case "ACCOUNT_INACTIVE":
    case "FORBIDDEN":
      return 403;
    case "VALIDATION_ERROR":
      return 422;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "CONFIGURATION_ERROR":
      return 500;
    default:
      return 500;
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: { code: AppErrorCode; message: string; details?: Record<string, string[]> } };

export function actionFailure(error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  return {
    ok: false,
    error: { code: appError.code, message: appError.message, details: appError.details },
  };
}

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Converts arbitrary thrown values into a safe, user-presentable AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof z.ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      details[key] = [...(details[key] ?? []), issue.message];
    }
    return new AppError("VALIDATION_ERROR", "Some fields need attention.", { details });
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    // Postgres unique_violation
    if (code === "23505") {
      return new AppError("CONFLICT", "That record already exists.", { status: 409 });
    }
    // Postgres insufficient_privilege / RLS violation
    if (code === "42501") {
      return new AppError("FORBIDDEN", "You are not authorized to perform this action.");
    }
    // Postgres check_violation
    if (code === "23514") {
      return new AppError("VALIDATION_ERROR", "A business rule rejected this change.");
    }
  }

  // Never leak raw database errors or stack traces to the user.
  console.error("[pluck-erp] unexpected error", error);
  return new AppError("UNEXPECTED_ERROR", "Something went wrong. Please try again.");
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
