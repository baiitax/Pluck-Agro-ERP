"use client";

import { useActionState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/input";
import { updatePasswordAction } from "@/app/(auth)/actions";
import { INITIAL_AUTH_STATE, type AuthFormState } from "@/lib/auth/form-state";

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState<AuthFormState, FormData>(
    updatePasswordAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="danger" title="Could not update password">
          {state.message}
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          disabled={isPending}
        />
        <FieldHint>Minimum 10 characters, with upper case, lower case and a number.</FieldHint>
        <FieldError message={state.fieldErrors?.password} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          disabled={isPending}
        />
        <FieldError message={state.fieldErrors?.confirmPassword} />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
        {isPending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
