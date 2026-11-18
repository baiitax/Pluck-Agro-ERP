-- 0022 — audit governance enhancements
-- Adds event identity, categorisation, employee attribution, request correlation, severity and
-- structured metadata. Existing rows are backfilled; the table remains append-only.

alter table public.audit_logs
  add column if not exists event_id uuid not null default gen_random_uuid(),
  add column if not exists event_category text,
  add column if not exists actor_employee_id uuid references public.employees (id) on delete set null on update cascade,
  add column if not exists metadata jsonb,
  add column if not exists request_id text,
  add column if not exists severity text not null default 'info';

update public.audit_logs
   set event_category = coalesce(
     case
       when module = 'auth' then 'authentication'
       when module in ('users', 'access') then 'account_management'
       when module in ('roles', 'permissions') then 'authorization'
       when module in ('employees', 'departments') then 'employee_management'
       when module in ('governance', 'approvals', 'delegations') then 'governance'
       when module = 'system' then 'system_administration'
       else 'general'
     end
   )
 where event_category is null;

update public.audit_logs a
   set request_id = null
 where a.request_id is null;

alter table public.audit_logs
  add constraint audit_logs_event_category_check
    check (event_category in ('authentication', 'employee_management', 'account_management',
                              'authorization', 'governance', 'system_administration', 'general')),
  add constraint audit_logs_severity_check
    check (severity in ('info', 'notice', 'warning', 'critical'));

create unique index if not exists audit_logs_event_id_unique_idx on public.audit_logs (event_id);
create index if not exists audit_logs_category_idx on public.audit_logs (event_category, created_at desc);
create index if not exists audit_logs_severity_idx on public.audit_logs (severity, created_at desc);
create index if not exists audit_logs_actor_employee_idx on public.audit_logs (actor_employee_id, created_at desc);
create index if not exists audit_logs_request_idx on public.audit_logs (request_id);

comment on column public.audit_logs.event_id is 'Stable external event identifier; safe to quote in reports and support requests.';
comment on column public.audit_logs.severity is 'info | notice | warning | critical';

-- Redaction helper used by the read layer: strips obviously sensitive keys from JSON payloads
-- so tokens/passwords can never be displayed even if a future writer records them by mistake.
create or replace function private.redact_audit_payload(payload jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when payload is null then null
    when jsonb_typeof(payload) = 'object' then (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from (
        select key,
               case
                 when lower(key) similar to '%(password|token|secret|credential|authorization|service_role)%'
                   then '"«redacted»"'::jsonb
                 else value
               end as value
        from jsonb_each(payload)
      ) redacted
    )
    else payload
  end;
$$;
