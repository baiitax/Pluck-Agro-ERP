-- 0006 — approval_limits
-- Data model only. Phase 0 does NOT implement approval routing or thresholds; the workflow
-- engine in a later phase will consume this table. No amounts are invented here.

create table if not exists public.approval_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade on update cascade,
  role_id uuid references public.roles (id) on delete cascade on update cascade,
  module text not null,
  transaction_type text not null,
  currency_code text not null default 'NGN',
  minimum_amount numeric(18, 2) not null default 0,
  maximum_amount numeric(18, 2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_limits_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint approval_limits_amounts_valid check (maximum_amount >= minimum_amount and minimum_amount >= 0),
  constraint approval_limits_exactly_one_holder
    check (num_nonnulls(user_id, role_id) = 1)
);

create index if not exists approval_limits_user_id_idx on public.approval_limits (user_id);
create index if not exists approval_limits_role_id_idx on public.approval_limits (role_id);

comment on table public.approval_limits is 'Value-based approval authority (data model only in Phase 0).';

drop trigger if exists approval_limits_set_updated_at on public.approval_limits;
create trigger approval_limits_set_updated_at
  before update on public.approval_limits
  for each row execute function private.set_updated_at();
