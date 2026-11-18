import { z } from "zod";

/**
 * Typed environment validation.
 *
 * Public values are referenced with literal `process.env.NEXT_PUBLIC_*` expressions so the
 * Next.js compiler can inline them into the browser bundle. Server-only values are only ever
 * read through `getServerEnv()`, which refuses to run in a browser context.
 */

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(scope: string, issues: string[]) {
    super(
      `Invalid ${scope} environment configuration:\n${issues.map((issue) => `  • ${issue}`).join("\n")}\n` +
        "See .env.example and docs/environment-setup.md.",
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

const urlSchema = z
  .string()
  .min(1, "must not be empty")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, "must be a valid http(s) URL");

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: urlSchema,
  NEXT_PUBLIC_SUPABASE_URL: urlSchema,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "must be a Supabase publishable/anon key"),
});

export const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "must be the Supabase service-role key (server-only)"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatIssues(scope: string, error: z.ZodError): EnvValidationError {
  return new EnvValidationError(
    scope,
    error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  );
}

/** Pure, testable parser used by unit tests. */
export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) throw formatIssues("public", result.error);
  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) throw formatIssues("server", result.error);

  if (result.data.SUPABASE_SERVICE_ROLE_KEY === result.data.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new EnvValidationError("server", [
      "SUPABASE_SERVICE_ROLE_KEY must not be the same value as NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
  }

  return result.data;
}

let cachedPublicEnv: PublicEnv | null = null;
let cachedServerEnv: ServerEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  cachedPublicEnv = parsePublicEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return cachedPublicEnv;
}

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new EnvValidationError("server", [
      "getServerEnv() was called in a browser context. Server secrets must never reach the client.",
    ]);
  }
  if (cachedServerEnv) return cachedServerEnv;
  cachedServerEnv = parseServerEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });
  return cachedServerEnv;
}

export function isEnvironmentConfigured(): boolean {
  const result = serverEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });
  return result.success;
}
