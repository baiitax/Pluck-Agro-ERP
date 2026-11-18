-- 0019 — approval authority configuration
--
-- Phase 1 configures authority only. It does not execute approval workflows.
-- No company approval limits are seeded or invented: every row must be entered by an
-- authorised administrator against management-approved policy.

create table if not exists public.approval_authorities (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees (id) on delete cascade on update cascade,
  role_id uuid references public.roles (id) on delete cascade on update cascade,
  department_id uuid references public.departments (id) on delete set null on update cascade,
  module text not null,
  transaction_type text not null,
  authority_level int not null default 1,
  currency_code text not null default 'NGN',
  minimum_amount numeric(18, 2) not null default 0,
  maximum_amount numeric(18, 2) not null,
  scope_type text not null default 'GLOBAL',
  scope_id uuid,
  effective_from date not null default current_date,
  effective_until date,
  justification text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_authorities_principal_exclusive
    check (num_nonnulls(employee_id, role_id) = 1),
  constraint approval_authorities_amounts_valid
    check (maximum_amount >= minimum_amount and minimum_amount >= 0),
  constraint approval_authorities_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint approval_authorities_scope_type_check
    check (scope_type in ('GLOBAL', 'DEPARTMENT', 'LOCATION', 'WAREHOUSE', 'ENTITY')),
  constraint approval_authorities_department_scope
    check (scope_type <> 'DEPARTMENT' or department_id is not null),
  constraint approval_authorities_period_valid
    check (effective_until is null or effective_until >= effective_from),
  constraint approval_authorities_level_positive check (authority_level >= 1),
  constraint approval_authorities_module_format check (module ~ '^[a-z][a-z0-9_]*$'),
  constraint approval_authorities_txn_format check (transaction_type ~ '^[a-z][a-z0-9_]*$')
);

create index if not exists approval_authorities_employee_idx on public.approval_authorities (employee_id);
create index if not exists approval_authorities_role_idx on public.approval_authorities (role_id);
create index if not exists approval_authorities_lookup_idx
  on public.approval_authorities (module, transaction_type, currency_code, is_active);
create index if not exists approval_authorities_expiry_idx on public.approval_authorities (effective_until);

comment on table public.approval_authorities is
  'Configured approval authority. Holding an approve permission is NOT sufficient; an applicable active authority row is also required.';

drop trigger if exists approval_authorities_set_updated_at on public.approval_authorities;
create trigger approval_authorities_set_updated_at
  before update on public.approval_authorities
  for each row execute function private.set_updated_at();
