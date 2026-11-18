-- 0011 — role grants
--
-- Supabase projects ship the anon / authenticated / service_role roles. The DO blocks make the
-- migration portable to a bare PostgreSQL instance (used by the local RLS test harness) where
-- those roles may not exist yet.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema public to authenticated';
    execute 'grant usage on schema private to authenticated';
    execute 'grant select, insert, update, delete on all tables in schema public to authenticated';
    -- Audit history is append-only and read-only for application users.
    execute 'revoke insert, update, delete on public.audit_logs from authenticated';
    execute 'grant execute on function public.current_profile_id() to authenticated';
    execute 'grant execute on function public.is_active_profile() to authenticated';
    execute 'grant execute on function public.has_permission(text) to authenticated';
    execute 'grant execute on function public.has_role(text) to authenticated';
    execute 'grant execute on function public.current_user_permissions() to authenticated';
    execute 'grant execute on function private.current_profile_id() to authenticated';
    execute 'grant execute on function private.is_active_profile() to authenticated';
    execute 'grant execute on function private.has_permission(text) to authenticated';
    execute 'grant execute on function private.has_role(text) to authenticated';
    execute 'grant execute on function private.current_user_permissions() to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on schema private from anon';
  end if;
end;
$$;
