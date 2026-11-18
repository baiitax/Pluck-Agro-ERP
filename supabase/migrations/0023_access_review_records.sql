-- 0023 — access review records
-- Periodic attestation that each account still needs the access it holds.

create table if not exists public.access_review_records (
  id uuid primary key default gen_random_uuid(),
  review_period text not null,
  employee_id uuid references public.employees (id) on delete cascade on update cascade,
  user_id uuid references public.profiles (id) on delete cascade on update cascade,
  reviewer_user_id uuid references public.profiles (id) on delete set null on update cascade,
  review_status text not null default 'pending',
  findings text,
  decision text,
  reviewed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_review_period_format check (review_period ~ '^[0-9]{4}-(Q[1-4]|[0-9]{2})$'),
  constraint access_review_status_check
    check (review_status in ('pending', 'in_review', 'completed', 'flagged')),
  constraint access_review_decision_check
    check (decision is null or decision in ('retain', 'amend', 'revoke')),
  constraint access_review_completed_requires_date
    check (review_status <> 'completed' or reviewed_at is not null)
);

create unique index if not exists access_review_period_user_unique_idx
  on public.access_review_records (review_period, user_id)
  where user_id is not null;

create index if not exists access_review_status_idx on public.access_review_records (review_status, review_period);

comment on table public.access_review_records is
  'Per-period access attestation. Completed reviews record a decision of retain | amend | revoke.';

drop trigger if exists access_review_records_set_updated_at on public.access_review_records;
create trigger access_review_records_set_updated_at
  before update on public.access_review_records
  for each row execute function private.set_updated_at();
