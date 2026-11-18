import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { signOutAction } from "@/app/(auth)/actions";
import { APP_CONFIG } from "@/config/app.config";
import { NAVIGATION } from "@/config/navigation.config";
import type { NavGroup } from "@/config/navigation.config";
import type { AuthenticatedUser } from "@/types/auth.types";
import { employeeFullName } from "@/services/employees/get-employees";

/** Hides navigation entries the principal is not authorized to use. */
function visibleNavigation(principal: AuthenticatedUser): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => principal.permissions.has(item.permission)),
  })).filter((group) => group.items.length > 0);
}

export function AppShell({ principal, children }: { principal: AuthenticatedUser; children: ReactNode }) {
  const groups = visibleNavigation(principal);
  const displayName =
    principal.profile.display_name ??
    (principal.employee ? employeeFullName(principal.employee) : principal.user.email);
  const environment = process.env.NODE_ENV === "production" ? "Production" : "Development";

  return (
    <div className="flex min-h-dvh">
      <AppSidebar groups={groups} version={APP_CONFIG.version} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          groups={groups}
          displayName={displayName}
          email={principal.user.email}
          roles={principal.roles.map((role) => role.roleName)}
          signOutAction={signOutAction}
          environment={environment}
        />
        <main id="main-content" className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-[92rem]">{children}</div>
        </main>
        <Toaster position="top-right" richColors closeButton />
        <footer className="border-t border-border bg-surface px-4 py-2.5 text-[0.6875rem] text-ink-subtle sm:px-6">
          <div className="mx-auto flex w-full max-w-[92rem] flex-wrap items-center justify-between gap-2">
            <span>
              {APP_CONFIG.organisation} · {APP_CONFIG.name} v{APP_CONFIG.version}
            </span>
            <span>{APP_CONFIG.phase}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
