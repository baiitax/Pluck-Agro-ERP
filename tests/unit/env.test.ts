import { describe, expect, it } from "vitest";

import { EnvValidationError, parsePublicEnv, parseServerEnv } from "@/lib/env";

const valid = {
  NEXT_PUBLIC_APP_URL: "https://erp.pluckagro.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop",
};

describe("environment validation", () => {
  it("accepts a complete configuration", () => {
    const env = parseServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "service-role-key-1234567890" });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects missing mandatory public values with an actionable message", () => {
    try {
      parsePublicEnv({ NEXT_PUBLIC_APP_URL: valid.NEXT_PUBLIC_APP_URL });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const envError = error as EnvValidationError;
      expect(envError.issues.join(" ")).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(envError.message).toContain("docs/environment-setup.md");
    }
  });

  it("rejects a non-http app URL", () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_APP_URL: "ftp://example.com" })).toThrow(
      EnvValidationError,
    );
  });

  it("refuses to accept the service-role key as the anon key", () => {
    expect(() =>
      parseServerEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "identical-key-value-1234567890",
        SUPABASE_SERVICE_ROLE_KEY: "identical-key-value-1234567890",
      }),
    ).toThrow(/must not be the same value/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() =>
      parseServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "service-role-key-1234567890", NODE_ENV: "staging" }),
    ).toThrow(EnvValidationError);
  });
});
