import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The caller's profile id, or null when unauthenticated. Used for created_by/updated_by stamps. */
export async function getActiveProfileId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Escapes a value for use inside a PostgREST `or()` filter, which is comma/parenthesis delimited. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[%,()*]/g, " ").trim();
}

/** Splits a comma-separated id list from a form into a uuid array, dropping blanks. */
export function toIdList(value: FormDataEntryValue | FormDataEntryValue[] | null): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}
