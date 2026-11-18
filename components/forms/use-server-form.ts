"use client";

import * as React from "react";

import type { ActionResult } from "@/lib/errors";

/**
 * Small wrapper around a server action for dialogs and inline forms.
 *
 * Using an explicit handler (rather than a state-syncing effect) keeps side effects — closing
 * a dialog, raising a toast — out of render and out of effect bodies.
 */
export function useServerForm<T>(
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>,
  onResult?: (result: ActionResult<T>) => void,
) {
  const [state, setState] = React.useState<ActionResult<T> | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const run = (formData: FormData) => {
    startTransition(async () => {
      const result = await action(null, formData);
      setState(result);
      onResult?.(result);
    });
  };

  return { state, isPending, run };
}
