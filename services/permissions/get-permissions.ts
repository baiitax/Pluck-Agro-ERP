import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Permission } from "@/types/database.types";

export async function getPermissions(): Promise<Permission[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("permissions")
    .select("*")
    .order("module", { ascending: true })
    .order("action", { ascending: true })
    .returns<Permission[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}
