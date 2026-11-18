import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Privileged server-only client.
 *
 * The service-role key bypasses Row Level Security. It is used ONLY for operations that
 * cannot be expressed through user-scoped policies — account provisioning, trusted audit
 * writes and administrative reads after an explicit application-level permission check.
 *
 * Rules:
 *  - never import this module from a client component or a file that is not server-only;
 *  - always authorize the caller with `requirePermission()` before using it;
 *  - always record an audit event for mutations performed with it.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();

  if (typeof window !== "undefined") {
    throw new Error("createSupabaseAdminClient() must never run in the browser.");
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { "X-Client-Info": "pluck-agro-erp/server-admin" } },
  });
}
