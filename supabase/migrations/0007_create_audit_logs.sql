-- 0007 — audit_logs
-- Append-only. Ordinary application users may read (with audit.view) but never insert,
-- update or delete. Writes happen through the trusted server-side service using the
-- service-role client, or through an explicitly authorised SECURITY DEFINER path.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null on update cascade,
  action text not null,
  module text not null,
  entity_type text,
  entity_id uuid,
  description text,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (length(btrim(action)) > 0),
  constraint audit_logs_module_not_blank check (length(btrim(module)) > 0)
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_module_idx on public.audit_logs (module, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

comment on table public.audit_logs is 'Append-only audit history. Never contains passwords, tokens or secrets.';

-- Enforce append-only semantics in the database, not just by convention.
create or replace function private.block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('pluck.audit_maintenance', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'audit_logs is append-only; corrections must be recorded as new events'
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_block_mutation on public.audit_logs;
create trigger audit_logs_block_mutation
  before update or delete on public.audit_logs
  for each row execute function private.block_audit_mutation();
