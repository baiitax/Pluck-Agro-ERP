"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPublicEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from "@/lib/validation/schemas";
import type { AuthFormState } from "@/lib/auth/form-state";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";
import { completeLogin, recordFailedLogin } from "@/services/auth/complete-login";

function fieldErrorsFrom(issues: { path: (string | number | symbol)[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "_");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

async function requestMeta() {
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for");
  return {
    ipAddress: forwardedFor?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
  };
}

export async function signInAction(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }

  const meta = await requestMeta();
  const limiterKey = `login:${meta.ipAddress ?? "unknown"}:${parsed.data.email}`;
  const limit = checkRateLimit(limiterKey, { limit: 8, windowMs: 5 * 60_000 });

  if (!limit.allowed) {
    await recordFailedLogin({ email: parsed.data.email, ...meta });
    return {
      status: "error",
      message: `Too many sign-in attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    await recordFailedLogin({ email: parsed.data.email, ...meta });
    // Deliberately generic: never reveal whether the email exists.
    return { status: "error", message: "Invalid email or password." };
  }

  // A valid Supabase session is not enough — the ERP profile must also authorize this user.
  const resolution = await resolveCurrentPrincipal();
  if (resolution.status !== "authenticated") {
    await supabase.auth.signOut();
    await recordFailedLogin({ email: parsed.data.email, ...meta });
    return { status: "error", message: resolution.message };
  }

  await completeLogin({ userId: data.user.id, email: parsed.data.email, ...meta });

  const next = formData.get("next");
  const destination = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login?status=signed_out");
}

export async function requestPasswordResetAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }

  const meta = await requestMeta();
  const limit = checkRateLimit(`reset:${meta.ipAddress ?? "unknown"}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!limit.allowed) {
    return { status: "error", message: "Too many reset requests. Please try again later." };
  }

  const env = getPublicEnv();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });

  // Always the same response, whether or not the address exists.
  return {
    status: "success",
    message: "If that address belongs to an ERP account, a password reset link is on its way.",
  };
}

export async function updatePasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return {
      status: "error",
      message: "Your reset link has expired. Request a new password reset email.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { status: "error", message: "We could not update your password. Request a new reset link." };
  }

  await supabase.auth.signOut();
  redirect("/login?status=password_updated");
}
