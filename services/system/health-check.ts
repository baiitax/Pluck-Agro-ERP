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
      const { createSupabaseServerClient } = await import("@/lib/supabase/server");
      const supabase = await createSupabaseServerClient();
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
