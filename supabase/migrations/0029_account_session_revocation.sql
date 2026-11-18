-- 0029 — application-level session revocation
--
-- Supabase Auth does not expose a "revoke every session for this user" admin endpoint in the
-- SDK version pinned here. Instead of pretending, the ERP keeps its own revocation stamp:
-- any session whose `last_sign_in_at` predates `sessions_valid_after` is rejected by
-- `resolveCurrentPrincipal()` on every request. The stamp is written only by the trusted
-- account service, and it is protected from self-service edits below.

alter table public.profiles
  add column if not exists sessions_valid_after timestamptz not null default 'epoch',
  add column if not exists sessions_revoked_at timestamptz,
  add column if not exists sessions_revoked_by uuid references public.profiles (id) on delete set null;

comment on column public.profiles.sessions_valid_after is
  'Sessions issued before this instant are rejected. Set by the session-revocation service.';

-- Extend the privileged-column guard so a user can never clear their own revocation stamp.
create or replace function private.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and not (private.has_permission('access.assignments.manage') or private.has_permission('access.accounts.suspend')) then
    new.employee_id := old.employee_id;
    new.is_active := old.is_active;
    new.account_status := old.account_status;
    new.last_login_at := old.last_login_at;
    new.sessions_valid_after := old.sessions_valid_after;
    new.sessions_revoked_at := old.sessions_revoked_at;
    new.sessions_revoked_by := old.sessions_revoked_by;
  end if;
  return new;
end;
$$;
