-- 0002 — employees
-- Employee records are deliberately independent of authentication: a factory worker may
-- exist in the ERP without ever having a login.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text,
  phone text,
  department_id uuid references public.departments (id) on delete restrict on update cascade,
  job_title text,
  employment_status text not null default 'active',
  date_joined date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_number_unique unique (employee_number),
  constraint employees_number_format check (employee_number ~ '^[A-Za-z0-9./-]{2,32}$'),
  constraint employees_first_name_not_blank check (length(btrim(first_name)) > 0),
  constraint employees_last_name_not_blank check (length(btrim(last_name)) > 0),
  constraint employees_employment_status_check
    check (employment_status in ('active', 'suspended', 'terminated', 'on_leave')),
  constraint employees_email_format
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint employees_date_joined_sane
    check (date_joined is null or date_joined >= date '1950-01-01')
);

create unique index if not exists employees_email_unique_idx
  on public.employees (lower(email))
  where email is not null;

create index if not exists employees_department_id_idx on public.employees (department_id);
create index if not exists employees_status_idx on public.employees (employment_status);
create index if not exists employees_name_idx on public.employees (last_name, first_name);

comment on table public.employees is 'Employee master records. Independent of auth users; a profile links an auth user to an employee.';

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function private.set_updated_at();
