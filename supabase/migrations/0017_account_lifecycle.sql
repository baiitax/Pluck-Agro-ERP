-- 0017 — ERP account lifecycle
--
-- profiles.account_status is the detailed lifecycle state. profiles.is_active remains the single
-- enforcement gate used by RLS helpers, and is derived from account_status by trigger so the two
-- can never disagree.

alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists status_reason text,
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists invitation_count int not null default 0;

alter table public.profiles
  add constraint profiles_account_status_check
    check (account_status in ('invited', 'pending_setup', 'active', 'suspended', 'deactivated', 'locked'));

create index if not exists profiles_account_status_idx on public.profiles (account_status);
create index if not exists profiles_last_login_idx on public.profiles (last_login_at desc);

comment on column public.profiles.account_status is
  'Lifecycle state: invited | pending_setup | active | suspended | deactivated | locked. Employment status is separate (employees.employment_status).';

-- Allowed lifecycle transitions.
create or replace function private.validate_account_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.account_status is distinct from old.account_status then
    if not (
      (old.account_status = 'invited'       and new.account_status in ('pending_setup', 'active', 'deactivated'))
      or (old.account_status = 'pending_setup' and new.account_status in ('active', 'deactivated'))
      or (old.account_status = 'active'     and new.account_status in ('suspended', 'deactivated', 'locked'))
      or (old.account_status in ('suspended', 'locked') and new.account_status in ('active', 'deactivated'))
      or (old.account_status = 'deactivated' and new.account_status = 'active')
    ) then
      raise exception 'Illegal account status transition: % -> %', old.account_status, new.account_status
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate_status_transition on public.profiles;
create trigger profiles_validate_status_transition
  before update on public.profiles
  for each row execute function private.validate_account_status_transition();

-- Derive is_active from account_status and stamp lifecycle timestamps.
create or replace function private.sync_account_status()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.account_status = 'active');

  if new.account_status is not distinct from old.account_status then
    return new;
  end if;

  if new.account_status = 'invited' then
    new.invited_at := coalesce(new.invited_at, now());
    new.invitation_count := coalesce(old.invitation_count, 0) + 1;
  elsif new.account_status = 'active' then
    new.activated_at := now();
    new.suspended_at := null;
    new.deactivated_at := null;
  elsif new.account_status = 'suspended' then
    new.suspended_at := now();
  elsif new.account_status = 'deactivated' then
    new.deactivated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_account_status_sync on public.profiles;
create trigger profiles_account_status_sync
  before insert or update on public.profiles
  for each row execute function private.sync_account_status();

-- Privileged column guard: non-administrators cannot change their own account status or
-- employee link, even though they may update their display name and avatar.
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
  end if;
  return new;
end;
$$;

-- One active ERP identity per employee.
create unique index if not exists profiles_employee_unique_active_idx
  on public.profiles (employee_id)
  where employee_id is not null;

-- Account activity log (separate from the audit trail: this is per-account telemetry).
create table if not exists public.account_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade on update cascade,
  activity_type text not null,
  description text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint account_activity_type_check
    check (activity_type in ('invited', 'invitation_resent', 'activated', 'suspended', 'deactivated',
                             'reactivated', 'password_recovery_requested', 'sessions_revoked',
                             'login_succeeded', 'login_failed', 'role_assigned', 'role_revoked'))
);

create index if not exists account_activity_user_idx on public.account_activity (user_id, created_at desc);
