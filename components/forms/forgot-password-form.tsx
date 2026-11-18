"use client";

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { requestPasswordResetAction } from "@/app/(auth)/actions";
import { INITIAL_AUTH_STATE, type AuthFormState } from "@/lib/auth/form-state";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState<AuthFormState, FormData>(
    requestPasswordResetAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="danger" title="Request failed">
          {state.message}
        </Alert>
      ) : null}
      {state.status === "success" ? <Alert tone="success" title="Check your inbox">{state.message}</Alert> : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          disabled={isPending}
        />
        <FieldError message={state.fieldErrors?.email} />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
        {isPending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
