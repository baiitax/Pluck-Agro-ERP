import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck, Sprout, Warehouse } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { APP_CONFIG } from "@/config/app.config";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-brand-900 px-10 py-9 text-brand-50 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 22%, #aedbbd 0, transparent 42%), radial-gradient(circle at 82% 78%, #7cc296 0, transparent 38%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50/15 text-brand-50">
              <Sprout className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">Pluck Agro Allied</p>
              <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-brand-200">
                Enterprise Resource Planning
              </p>
            </div>
          </div>

          <h2 className="mt-12 max-w-md text-2xl font-semibold leading-snug tracking-tight">
            One operating system for procurement, production, inventory, sales, export and finance.
          </h2>
          <p className="mt-3 max-w-sm text-sm text-brand-100/85">
            {APP_CONFIG.phase}. The platform is delivered in phases, and each business area becomes
            available to authorised staff once it is implemented and verified. Areas still in progress
            are shown to nobody.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-brand-100/90">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-200" aria-hidden />
              Role-based access enforced in the application and in the database.
            </li>
            <li className="flex items-start gap-2.5">
              <Warehouse className="mt-0.5 size-4 shrink-0 text-brand-200" aria-hidden />
              Employee, department and access records with a full audit trail.
            </li>
          </ul>
        </div>

        <p className="relative text-[0.6875rem] text-brand-200/70">
          Authorised personnel only. Activity on this system is recorded.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-5 py-4 lg:hidden">
          <BrandMark />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-4 sm:px-8">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <div className="px-5 py-4 text-center text-[0.6875rem] text-ink-subtle">
          <Link href="/api/health" className="hover:text-ink-muted hover:underline">
            System status
          </Link>
          <span aria-hidden> · </span>
          {APP_CONFIG.organisation} · v{APP_CONFIG.version}
        </div>
      </div>
    </div>
  );
}
