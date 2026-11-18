#!/usr/bin/env node
/**
 * Regenerates types/database.types.ts from the linked Supabase project.
 *
 * Requires the Supabase CLI to be installed and authenticated:
 *   npx supabase login
 *   npx supabase link --project-ref <ref>
 *   SUPABASE_PROJECT_REF=<ref> npm run db:types
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef) {
  console.error("SUPABASE_PROJECT_REF is required (Project Settings → General → Reference ID).");
  process.exit(1);
}

try {
  const output = execFileSync(
    "npx",
    ["--yes", "supabase@latest", "gen", "types", "typescript", "--project-id", projectRef, "--schema", "public"],
    { encoding: "utf8" },
  );
  writeFileSync("types/database.types.ts", output);
  console.info("Wrote types/database.types.ts");
} catch (error) {
  console.error("Type generation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
