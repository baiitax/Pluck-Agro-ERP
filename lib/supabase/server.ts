import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Server Supabase client bound to the current request's cookies.
 *
 * Runs with the caller's identity, so RLS still applies. Use this for all authenticated
 * reads and writes in Server Components, Server Actions and Route Handlers.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render: cookies cannot be mutated here.
            // Session refresh is handled by the proxy, so this is safe to ignore.
          }
        },
      },
    },
  );
}
