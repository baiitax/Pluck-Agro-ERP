import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { ErrorState } from "@/components/shared/error-state";
import { Alert } from "@/components/ui/alert";
import { signOutAction } from "@/app/(auth)/actions";
import { isEnvironmentConfigured } from "@/lib/env";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!isEnvironmentConfigured()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Alert tone="danger" title="The ERP is not configured">
          Supabase environment variables are missing. Add them to <code>.env.local</code> and restart the
          server. Full instructions are in <code>docs/environment-setup.md</code>.
        </Alert>
      </main>
    );
  }

  const resolution = await resolveCurrentPrincipal();

  if (resolution.status !== "authenticated") {
    if (resolution.reason === "no_session") {
      redirect("/login");
    }

    // A valid Supabase session without an active ERP profile must never reach the app.
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-lg space-y-3">
          <ErrorState title="Access denied" description={resolution.message} />
          <form action={signOutAction} className="text-center">
            <button
              type="submit"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Sign out of this session
            </button>
          </form>
        </div>
      </main>
    );
  }

  return <AppShell principal={resolution.principal}>{children}</AppShell>;
}
