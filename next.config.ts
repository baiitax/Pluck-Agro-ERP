import type { NextConfig } from "next";

/**
 * Phase 0 configuration notes
 * ---------------------------
 * - `cacheComponents` / `partialPrefetching` are disabled for Phase 0 because every
 *   authenticated page reads the session cookie and therefore must be dynamic. Caching
 *   will be introduced deliberately (and audited for permission leakage) in a later phase.
 * - Server Actions body size is capped; document uploads will use signed Supabase Storage
 *   URLs in a later phase rather than posting files through Server Actions.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allows the sandboxed preview host to load dev assets. Production is unaffected.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "localhost"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
