import Link from "next/link";
import { Compass } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="erp-card max-w-md px-8 py-10 text-center">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
          <Compass className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-ink">Page not found</h1>
        <p className="mt-1 text-sm text-ink-muted">
          That address does not exist in the ERP, or the module has not been implemented yet.
        </p>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary", size: "sm" }) + " mt-4"}>
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
