-- 0005 — user_roles
-- Role assignments are history-preserving: revocation deactivates the row instead of deleting it.

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade on update cascade,
  role_id uuid not null references public.roles (id) on delete restrict on update cascade,
  assigned_by uuid references public.profiles (id) on delete set null on update cascade,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  constraint user_roles_expiry_after_assignment check (expires_at is null or expires_at > assigned_at)
);

create unique index if not exists user_roles_active_unique_idx
  on public.user_roles (user_id, role_id)
  where is_active;

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_id_idx on public.user_roles (role_id);

comment on table public.user_roles is 'Active and historical role assignments for ERP users.';

-- A user must never be able to write their own role assignments. This is enforced again in
-- RLS and in the application service; the constraint here is a last line of defence.
create or replace function private.block_self_role_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_by is not null and new.assigned_by = new.user_id then
    raise exception 'A user cannot assign roles to themselves'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists user_roles_block_self_assignment on public.user_roles;
create trigger user_roles_block_self_assignment
  before insert or update on public.user_roles
  for each row execute function private.block_self_role_assignment();
