"use client";

import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";

/**
 * Master-data error boundary.
 *
 * A permission failure or an unreachable database must not look like an empty register — an empty
 * table would imply "there are no suppliers", which is a different fact. The message distinguishes
 * the two, and no internal detail or stack trace reaches the screen.
 */
export default function MasterDataError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /permission/i.test(error.message);
  return (
    <div>
      <ErrorState
        title={forbidden ? "You do not have access to this section" : "Master data could not be loaded"}
        description={
          forbidden
            ? "Your account is missing the required master-data permission. Ask a system administrator if you need access."
            : "The request failed before any records were read. This is not an empty register — nothing was loaded. Retry, and if it persists quote the reference below."
        }
      />
      <div className="mt-4 flex justify-center">
        <Button onClick={reset} variant="secondary" size="sm">
          Try again
        </Button>
      </div>
      {error.digest ? <p className="mt-3 text-center font-mono text-xs text-ink-subtle">Reference: {error.digest}</p> : null}
    </div>
  );
}
