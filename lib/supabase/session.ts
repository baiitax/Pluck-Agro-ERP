import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/env";

export type SessionRefreshResult = {
  response: NextResponse;
  userId: string | null;
};

/**
 * Refreshes the Supabase auth session for an incoming request and returns cookies that must
 * be forwarded to the response. Called from the root `proxy.ts`.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefreshResult> {
  let response = NextResponse.next({ request });

  let env;
  try {
    env = getPublicEnv();
  } catch {
    // Misconfigured deployment: let the pages render an explicit configuration error instead
    // of failing every request inside the proxy.
    return { response, userId: null };
  }
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() validates the JWT with Supabase Auth (do not trust getSession()).
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return { response, userId: null };
  }

  return { response, userId: data.user?.id ?? null };
}
