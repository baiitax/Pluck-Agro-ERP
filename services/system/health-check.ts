import "server-only";

import { isEnvironmentConfigured } from "@/lib/env";

export type HealthStatus = {
  status: "ok" | "degraded";
  checks: {
    database: "ok" | "unconfigured" | "error";
    environment: "ok" | "invalid";
    timestamp: string;
  };
  version: string;
  phase: string;
};

/**
 * Health check used by /api/health and the dashboard system panel.
 * Never exposes credentials or raw database errors.
 */
export async function getSystemHealth(): Promise<HealthStatus> {
  const envOk = isEnvironmentConfigured();
  let database: HealthStatus["checks"]["database"] = "unconfigured";

  if (envOk) {
    try {
      // The probe uses the privileged server client on purpose.
      //
      // It used to run with the anon key and no session, and the migrations grant `anon` nothing — so PostgREST
      // answered "permission denied for table departments" (42501) and this endpoint reported the database as
      // unhealthy while it was perfectly fine. That is the worst kind of alarm: permanently red, so people learn
      // to ignore it. A reachability probe should test reachability, not row access, so it asks with the key the
      // server already uses elsewhere and reads nothing but a boolean.
      const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
      const supabase = createSupabaseAdminClient();
      const { error } = await supabase.from("departments").select("id", { head: true, count: "exact" }).limit(1);
      database = error ? "error" : "ok";
    } catch {
      database = "error";
    }
  }

  return {
    status: envOk && database === "ok" ? "ok" : "degraded",
    checks: {
      database,
      environment: envOk ? "ok" : "invalid",
      timestamp: new Date().toISOString(),
    },
    version: "0.1.0",
    phase: "Phase 0 — Technical Foundation",
  };
}
