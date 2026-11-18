"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Browser Supabase client.
 *
 * Uses only the public URL and publishable/anon key. Every query issued through this client
 * is subject to PostgreSQL Row Level Security — it can never read or write beyond the
 * authenticated user's policies.
 */
export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const env = getPublicEnv();
  browserClient = createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return browserClient;
}
