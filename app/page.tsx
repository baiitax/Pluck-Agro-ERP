import { redirect } from "next/navigation";

import { isEnvironmentConfigured } from "@/lib/env";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (!isEnvironmentConfigured()) {
    redirect("/login");
  }

  const resolution = await resolveCurrentPrincipal();
  redirect(resolution.status === "authenticated" ? "/dashboard" : "/login");
}
