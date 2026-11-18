import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { LoginForm } from "@/components/forms/login-form";
import { isEnvironmentConfigured } from "@/lib/env";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";

export const metadata: Metadata = { title: "Sign in · Pluck Agro ERP" };

const STATUS_MESSAGES: Record<string, { tone: "info" | "success" | "warning"; text: string }> = {
  signed_out: { tone: "info", text: "You have been signed out." },
  password_updated: {
    tone: "success",
    text: "Your password was updated. Sign in with your new password.",
  },
  invalid_link: {
    tone: "warning",
    text: "That link is invalid or has expired. Request a new password reset email.",
  },
  session_expired: { tone: "info", text: "Your session expired. Please sign in again." },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; next?: string }>;
}) {
  const params = await searchParams;

  if (isEnvironmentConfigured()) {
    const resolution = await resolveCurrentPrincipal();
    if (resolution.status === "authenticated") {
      redirect("/dashboard");
    }
  }

  const status = params.status ? STATUS_MESSAGES[params.status] : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in to the ERP</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Use the work email address issued to you by a system administrator.
        </p>
      </div>

      {!isEnvironmentConfigured() ? (
        <Alert tone="danger" title="Supabase is not configured">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>.env.local</code>, then restart the server. See{" "}
          <code>docs/environment-setup.md</code>.
        </Alert>
      ) : null}

      {status ? (
        <Alert tone={status.tone} title={status.text} />
      ) : null}

      <LoginForm nextPath={params.next ?? null} />
    </div>
  );
}
