"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the digest only — never render raw error internals to the user.
    console.error("[pluck-erp] route error", error.digest ?? error.name);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <ErrorState
        title="This page could not be loaded"
        description="An unexpected error occurred. The reference below helps support identify the problem."
      />
      {error.digest ? (
        <p className="mt-3 text-center font-mono text-xs text-ink-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-4 flex justify-center">
        <Button onClick={reset} variant="secondary" size="sm">
          Try again
        </Button>
      </div>
    </main>
  );
}
