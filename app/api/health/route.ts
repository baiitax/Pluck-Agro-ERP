import { NextResponse } from "next/server";

import { getSystemHealth } from "@/services/system/health-check";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness endpoint.
 *
 * Returns configuration and database reachability only — no credentials, dependency versions
 * or stack traces that could aid an attacker.
 */
export async function GET() {
  const health = await getSystemHealth();
  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
