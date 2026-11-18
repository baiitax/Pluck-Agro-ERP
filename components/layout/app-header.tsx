import Link from "next/link";
import { Bell, CircleHelp, Search } from "lucide-react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import type { NavGroup } from "@/config/navigation.config";

export function AppHeader({
  groups,
  displayName,
  email,
  roles,
  signOutAction,
  environment,
}: {
  groups: NavGroup[];
  displayName: string;
  email: string;
  roles: string[];
  signOutAction: () => Promise<void>;
  environment: string;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-4">
      <MobileNav groups={groups} />

      {/* Global search is not implemented in Phase 0; it is shown as a disabled,
          clearly-labelled placeholder rather than a fake input. */}
      <div className="hidden min-w-0 flex-1 sm:block">
        <div
          className="flex h-9 max-w-md items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-sm text-ink-subtle"
          title="Global search arrives with the operational modules in a later phase"
          aria-disabled="true"
        >
          <Search className="size-4" aria-hidden />
          <span>Global search — available in a later phase</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden rounded-md border border-border bg-surface-muted px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted lg:inline">
          {environment}
        </span>
        <Link
          href="/notifications"
          aria-label="Notifications (not enabled in Phase 0)"
          title="Notifications are not enabled in Phase 0"
          className="relative rounded-md p-2 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <Bell className="size-4.5" aria-hidden />
        </Link>
        <Link
          href="/settings"
          aria-label="Help and system information"
          className="hidden rounded-md p-2 text-ink-subtle hover:bg-surface-sunken hover:text-ink sm:block"
        >
          <CircleHelp className="size-4.5" aria-hidden />
        </Link>
        <UserMenu displayName={displayName} email={email} roles={roles} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
