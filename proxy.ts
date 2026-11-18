import { NextResponse, type NextRequest } from "next/server";

import { isEnvironmentConfigured } from "@/lib/env";
import { refreshSession } from "@/lib/supabase/session";

/**
 * Next.js 16 proxy (the successor to `middleware.ts`).
 *
 * Responsibilities, deliberately kept minimal:
 *  1. refresh the Supabase auth cookies on every request;
 *  2. perform a coarse gate so unauthenticated visitors never render the app shell;
 *  3. redirect authenticated users away from the auth pages.
 *
 * It is NOT the authorization boundary. Fine-grained permission checks happen in the
 * dashboard layout, in each Server Component and — authoritatively — in PostgreSQL RLS.
 */

const PUBLIC_PATHS = ["/", "/login", "/forgot-password", "/reset-password", "/api/health"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return pathname.startsWith("/auth/");
}

export default async function proxy(request: NextRequest) {
  if (!isEnvironmentConfigured()) {
    // Nothing to protect yet: render the pages so the operator sees the configuration error.
    return NextResponse.next();
  }

  const { response, userId } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  const isAuthPage =
    pathname === "/login" || pathname === "/forgot-password" || pathname === "/reset-password";

  if (!userId && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    if (pathname !== "/dashboard") {
      redirectUrl.searchParams.set("next", `${pathname}${search}`);
    }
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Preserve refreshed cookies on the redirect.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (userId && isAuthPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image optimisation:
     * _next/static, _next/image, favicon, and common static file extensions.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
