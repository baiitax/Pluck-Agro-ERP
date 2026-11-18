-- 0020 — approval delegation
--
-- Delegation transfers a bounded slice of a delegator's approval authority for a fixed window.
-- It never transfers permissions or administrative access.

create table if not exists public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_employee_id uuid not null references public.employees (id) on delete cascade on update cascade,
  delegate_employee_id uuid not null references public.employees (id) on delete cascade on update cascade,
  module text not null,
  transaction_type text not null,
  department_id uuid references public.departments (id) on delete set null on update cascade,
  currency_code text not null default 'NGN',
  delegated_limit numeric(18, 2) not null,
  effective_from date not null,
  effective_until date not null,
  reason text not null,
  status text not null default 'pending_approval',
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_delegations_distinct_parties check (delegator_employee_id <> delegate_employee_id),
  constraint approval_delegations_limit_positive check (delegated_limit > 0),
  constraint approval_delegations_period_valid check (effective_until >= effective_from),
  constraint approval_delegations_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint approval_delegations_status_check
    check (status in ('pending_approval', 'approved', 'rejected', 'revoked', 'expired')),
  constraint approval_delegations_reason_present check (length(btrim(reason)) >= 5),
  constraint approval_delegations_module_format check (module ~ '^[a-z][a-z0-9_]*$'),
  constraint approval_delegations_txn_format check (transaction_type ~ '^[a-z][a-z0-9_]*$')
);

create index if not exists approval_delegations_delegator_idx on public.approval_delegations (delegator_employee_id);
create index if not exists approval_delegations_delegate_idx on public.approval_delegations (delegate_employee_id);
create index if not exists approval_delegations_expiry_idx on public.approval_delegations (effective_until, status);

comment on table public.approval_delegations is
  'Time-bounded transfer of a portion of approval authority. Permissions are never delegated.';

drop trigger if exists approval_delegations_set_updated_at on public.approval_delegations;
create trigger approval_delegations_set_updated_at
  before update on public.approval_delegations
  for each row execute function private.set_updated_at();

-- Prevent approval cycles: no delegation chain may loop back to its originator.
create or replace function private.prevent_delegation_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cycle_found boolean;
begin
  if new.status not in ('pending_approval', 'approved') then
    return new;
  end if;

  with recursive chain(employee_id, depth) as (
    select new.delegate_employee_id, 1
    union all
    select d.delegate_employee_id, c.depth + 1
    from public.approval_delegations d
    join chain c on d.delegator_employee_id = c.employee_id
    where d.status = 'approved'
      and d.module = new.module
      and d.transaction_type = new.transaction_type
      and d.effective_until >= new.effective_from
      and c.depth < 12
  )
  select exists (select 1 from chain where employee_id = new.delegator_employee_id) into cycle_found;

  if cycle_found then
    raise exception 'This delegation would create an approval cycle'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists approval_delegations_prevent_cycle on public.approval_delegations;
create trigger approval_delegations_prevent_cycle
  before insert or update on public.approval_delegations
  for each row execute function private.prevent_delegation_cycle();

-- Delegated authority can never exceed the delegator's own applicable authority.
create or replace function private.validate_delegation_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delegator_max numeric(18, 2);
begin
  if new.status not in ('pending_approval', 'approved') then
    return new;
  end if;

  select max(maximum_amount) into delegator_max
  from public.approval_authorities
  where employee_id = new.delegator_employee_id
    and module = new.module
    and transaction_type = new.transaction_type
    and currency_code = new.currency_code
    and is_active
    and effective_from <= new.effective_until
    and (effective_until is null or effective_until >= new.effective_from);

  if delegator_max is null then
    raise exception 'The delegator holds no authority for %.% in %, so nothing can be delegated',
      new.module, new.transaction_type, new.currency_code
      using errcode = '23514';
  end if;

  if new.delegated_limit > delegator_max then
    raise exception 'Delegated limit % exceeds the delegator''s authority of %', new.delegated_limit, delegator_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists approval_delegations_validate_limit on public.approval_delegations;
create trigger approval_delegations_validate_limit
  before insert or update of delegated_limit, status, delegator_employee_id, module, transaction_type, currency_code
  on public.approval_delegations
  for each row execute function private.validate_delegation_limit();

-- Only one active delegation per delegatee per authority category at a time.
create unique index if not exists approval_delegations_active_unique_idx
  on public.approval_delegations (delegate_employee_id, module, transaction_type, currency_code)
  where status = 'approved';
