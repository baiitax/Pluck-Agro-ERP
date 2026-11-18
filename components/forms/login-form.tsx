"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { signInAction } from "@/app/(auth)/actions";
import { INITIAL_AUTH_STATE, type AuthFormState } from "@/lib/auth/form-state";

export function LoginForm({ nextPath }: { nextPath: string | null }) {
  const [state, formAction, isPending] = useActionState<AuthFormState, FormData>(
    signInAction,
    INITIAL_AUTH_STATE,
  );
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={nextPath ?? ""} />

      {state.status === "error" && state.message ? (
        <Alert tone="danger" title="Sign-in failed">
          {state.message}
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          placeholder="name@pluckagro.com"
          disabled={isPending}
        />
        <FieldError message={state.fieldErrors?.email} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
            className="pr-10"
            disabled={isPending}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <FieldError message={state.fieldErrors?.password} />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
        {isPending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-[0.6875rem] text-ink-subtle">
        Accounts are provisioned by authorised administrators. Self-registration is disabled.
      </p>
    </form>
  );
}
