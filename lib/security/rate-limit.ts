/**
 * Minimal in-process rate limiter for sensitive endpoints (login, password reset).
 *
 * Limitation: state is per server instance, so it is a defence-in-depth control rather than
 * a guarantee. Production hardening (Phase 1+) should move this to a shared store
 * (Upstash Redis / Postgres) or to Supabase Auth's built-in rate limits.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): RateLimitResult {
  const now = options.now ?? Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= options.limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test helper — clears all buckets. */
export function clearAllRateLimits(): void {
  buckets.clear();
}
