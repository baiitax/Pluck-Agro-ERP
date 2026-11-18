import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";

export const metadata: Metadata = { title: "Reset password · Pluck Agro ERP" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Enter your work email address and we will send a secure reset link if the account exists.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-xs text-ink-muted">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
