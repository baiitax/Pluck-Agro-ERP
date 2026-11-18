import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { ResetPasswordForm } from "@/components/forms/reset-password-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEnvironmentConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Choose a new password · Pluck Agro ERP" };

export default async function ResetPasswordPage() {
  let hasRecoverySession = false;

  if (isEnvironmentConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    hasRecoverySession = Boolean(data.user);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Choose a new password</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Use at least 10 characters with upper case, lower case and numeric characters.
        </p>
      </div>

      {hasRecoverySession ? (
        <ResetPasswordForm />
      ) : (
        <>
          <Alert tone="warning" title="Open this page from your reset email">
            A valid recovery session is required. Request a new reset link to continue.
          </Alert>
          <Link href="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
            Request a new reset link
          </Link>
        </>
      )}
    </div>
  );
}
