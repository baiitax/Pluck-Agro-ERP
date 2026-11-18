import Link from "next/link";
import { Lock } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * Renders a clear "no access" state. This is a presentation helper only — the server
 * enforces authorization before any of this renders, and RLS enforces it again in the database.
 */
export function PermissionGuard({ permission }: { permission: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-pending-50 text-pending-600">
        <Lock className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">You do not have access to this area</p>
      <p className="max-w-md text-xs text-ink-muted">
        Your account is missing the <code className="rounded bg-surface-sunken px-1 py-0.5">{permission}</code>{" "}
        permission. Ask a system administrator if you need access.
      </p>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2")}>
        Back to dashboard
      </Link>
    </Card>
  );
}
