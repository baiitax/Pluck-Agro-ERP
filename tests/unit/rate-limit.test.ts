import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, clearAllRateLimits, resetRateLimit } from "@/lib/security/rate-limit";

describe("rate limiter", () => {
  beforeEach(() => clearAllRateLimits());

  it("allows attempts up to the limit, then blocks", () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(checkRateLimit("login:1.2.3.4", { limit: 3, windowMs: 60_000, now }).allowed).toBe(true);
    }

    const blocked = checkRateLimit("login:1.2.3.4", { limit: 3, windowMs: 60_000, now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const now = 2_000_000;
    checkRateLimit("reset:9.9.9.9", { limit: 1, windowMs: 1_000, now });
    expect(checkRateLimit("reset:9.9.9.9", { limit: 1, windowMs: 1_000, now }).allowed).toBe(false);
    expect(checkRateLimit("reset:9.9.9.9", { limit: 1, windowMs: 1_000, now: now + 1_500 }).allowed).toBe(true);
  });

  it("tracks keys independently and supports manual reset", () => {
    checkRateLimit("a", { limit: 1, windowMs: 10_000 });
    expect(checkRateLimit("b", { limit: 1, windowMs: 10_000 }).allowed).toBe(true);
    expect(checkRateLimit("a", { limit: 1, windowMs: 10_000 }).allowed).toBe(false);
    resetRateLimit("a");
    expect(checkRateLimit("a", { limit: 1, windowMs: 10_000 }).allowed).toBe(true);
  });
});
