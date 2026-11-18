import Link from "next/link";
import { AlertOctagon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title = "Something went wrong",
  description = "The page could not be loaded. Try again, or contact a system administrator if the problem continues.",
  retryHref,
}: {
  title?: string;
  description?: string;
  retryHref?: string;
}) {
  return (
    <div className="erp-card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <AlertOctagon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-md text-xs text-ink-muted">{description}</p>
      {retryHref ? (
        <Link href={retryHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2")}>
          Try again
        </Link>
      ) : null}
    </div>
  );
}
