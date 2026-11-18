-- 0016 — organisational structure: department hierarchy, positions, employee enhancements,
-- employment history and centrally generated employee numbers.

-- ---------------------------------------------------------------------------
-- Departments: hierarchy and accountability
-- ---------------------------------------------------------------------------
alter table public.departments
  add column if not exists parent_department_id uuid references public.departments (id) on delete restrict on update cascade,
  add column if not exists department_head_employee_id uuid references public.employees (id) on delete set null on update cascade,
  add column if not exists cost_center_code text,
  add column if not exists created_by uuid references public.profiles (id) on delete set null on update cascade,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null on update cascade;

alter table public.departments
  add constraint departments_not_own_parent check (parent_department_id is null or parent_department_id <> id),
  add constraint departments_cost_center_format check (cost_center_code is null or cost_center_code ~ '^[A-Z0-9-]{2,24}$');

create index if not exists departments_parent_idx on public.departments (parent_department_id);
create index if not exists departments_head_idx on public.departments (department_head_employee_id);

-- Circular hierarchy prevention: walk up the parent chain.
create or replace function private.prevent_department_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cursor_id uuid := new.parent_department_id;
  depth int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Department hierarchy cannot contain a cycle'
        using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 32 then
      raise exception 'Department hierarchy exceeds the supported depth'
        using errcode = '23514';
    end if;
    select parent_department_id into cursor_id from public.departments where id = cursor_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists departments_prevent_cycle on public.departments;
create trigger departments_prevent_cycle
  before insert or update of parent_department_id on public.departments
  for each row execute function private.prevent_department_cycle();

-- Deactivation guard: a department may not be deactivated while it holds active employees or
-- active child departments.
create or replace function private.guard_department_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_employees int;
  active_children int;
begin
  if old.is_active and not new.is_active then
    select count(*) into active_employees
    from public.employees
    where department_id = new.id
      and employment_status in ('active', 'probation', 'on_leave');

    if active_employees > 0 then
      raise exception 'Department % still has % active employee(s); reassign them first', new.code, active_employees
        using errcode = '23514';
    end if;

    select count(*) into active_children
    from public.departments
    where parent_department_id = new.id and is_active;

    if active_children > 0 then
      raise exception 'Department % still has % active child department(s)', new.code, active_children
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists departments_guard_deactivation on public.departments;
create trigger departments_guard_deactivation
  before update of is_active on public.departments
  for each row execute function private.guard_department_deactivation();

-- ---------------------------------------------------------------------------
-- Positions
-- ---------------------------------------------------------------------------
create table if not exists public.employee_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  code text not null,
  department_id uuid references public.departments (id) on delete set null on update cascade,
  description text,
  grade text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_positions_code_unique unique (code),
  constraint employee_positions_code_format check (code ~ '^[A-Z0-9-]{2,24}$'),
  constraint employee_positions_title_not_blank check (length(btrim(title)) > 0)
);

create index if not exists employee_positions_department_idx on public.employee_positions (department_id);

comment on table public.employee_positions is 'Job positions. Positions carry no permissions; access comes from roles.';

drop trigger if exists employee_positions_set_updated_at on public.employee_positions;
create trigger employee_positions_set_updated_at
  before update on public.employee_positions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Employees: extended employment information
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists display_name text,
  add column if not exists employment_type text not null default 'permanent',
  add column if not exists employment_end_date date,
  add column if not exists supervisor_employee_id uuid references public.employees (id) on delete set null on update cascade,
  add column if not exists work_location text,
  add column if not exists employee_category text,
  add column if not exists notes text,
  add column if not exists position_id uuid references public.employee_positions (id) on delete set null on update cascade,
  add column if not exists deactivated_at timestamptz,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.employees drop constraint if exists employees_employment_status_check;
alter table public.employees
  add constraint employees_employment_status_check
    check (employment_status in ('active', 'on_leave', 'suspended', 'resigned', 'terminated', 'retired', 'probation'));

alter table public.employees
  add constraint employees_employment_type_check
    check (employment_type in ('permanent', 'contract', 'probation', 'intern', 'consultant', 'casual')),
  add constraint employees_not_own_supervisor check (supervisor_employee_id is null or supervisor_employee_id <> id),
  add constraint employees_end_date_after_join
    check (employment_end_date is null or date_joined is null or employment_end_date >= date_joined);

create index if not exists employees_supervisor_idx on public.employees (supervisor_employee_id);
create index if not exists employees_position_idx on public.employees (position_id);
create index if not exists employees_type_idx on public.employees (employment_type);

-- ---------------------------------------------------------------------------
-- Employment / organisational history
-- ---------------------------------------------------------------------------
create table if not exists public.employee_department_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade on update cascade,
  department_id uuid references public.departments (id) on delete set null on update cascade,
  position_id uuid references public.employee_positions (id) on delete set null on update cascade,
  supervisor_employee_id uuid references public.employees (id) on delete set null on update cascade,
  employment_status text,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  reason text,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint employee_history_period_valid check (effective_until is null or effective_until > effective_from)
);

create index if not exists employee_history_employee_idx
  on public.employee_department_history (employee_id, effective_from desc);
create unique index if not exists employee_history_open_unique_idx
  on public.employee_department_history (employee_id)
  where effective_until is null;

comment on table public.employee_department_history is
  'Append-only organisational history. Maintained by trigger; application users cannot write it directly.';

-- Record history automatically when organisational fields change.
create or replace function private.record_employee_org_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.department_id is not distinct from old.department_id
     and new.position_id is not distinct from old.position_id
     and new.supervisor_employee_id is not distinct from old.supervisor_employee_id
     and new.employment_status is not distinct from old.employment_status then
    return new;
  end if;

  update public.employee_department_history
     set effective_until = now()
   where employee_id = new.id and effective_until is null;

  insert into public.employee_department_history (
    employee_id, department_id, position_id, supervisor_employee_id, employment_status, effective_from, changed_by
  ) values (
    new.id, new.department_id, new.position_id, new.supervisor_employee_id, new.employment_status, now(), auth.uid()
  );

  return new;
end;
$$;

drop trigger if exists employees_record_org_change on public.employees;
create trigger employees_record_org_change
  after insert or update of department_id, position_id, supervisor_employee_id, employment_status on public.employees
  for each row execute function private.record_employee_org_change();

-- ---------------------------------------------------------------------------
-- Emergency contacts (restricted visibility, separate from the employee register)
-- ---------------------------------------------------------------------------
create table if not exists public.employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade on update cascade,
  contact_name text not null,
  relationship text,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_emergency_contacts_unique unique (employee_id)
);

drop trigger if exists employee_emergency_contacts_set_updated_at on public.employee_emergency_contacts;
create trigger employee_emergency_contacts_set_updated_at
  before update on public.employee_emergency_contacts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Central employee numbering
-- ---------------------------------------------------------------------------
create sequence if not exists public.employee_number_seq start with 1 increment by 1;

create or replace function private.next_employee_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prefix text := 'PA-EMP-';
  padding int := 6;
  candidate text;
begin
  select coalesce((setting_value #>> '{}'), prefix) into prefix
    from public.system_settings where setting_key = 'employees.number_prefix';
  select coalesce((setting_value #>> '{}')::int, padding) into padding
    from public.system_settings where setting_key = 'employees.number_padding';

  prefix := coalesce(prefix, 'PA-EMP-');
  padding := least(greatest(coalesce(padding, 6), 3), 12);

  loop
    candidate := prefix || lpad(nextval('public.employee_number_seq')::text, padding, '0');
    exit when not exists (select 1 from public.employees where employee_number = candidate);
  end loop;

  return candidate;
end;
$$;

create or replace function public.next_employee_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$ begin return private.next_employee_number(); end; $$;

revoke all on function private.next_employee_number() from public;
revoke all on function public.next_employee_number() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.next_employee_number() to authenticated';
    execute 'grant usage, select on sequence public.employee_number_seq to authenticated';
  end if;
end;
$$;

insert into public.system_settings (setting_key, setting_value, description)
values
  ('employees.number_prefix', '"PA-EMP-"'::jsonb, 'Prefix used when generating employee numbers'),
  ('employees.number_padding', '6'::jsonb, 'Zero-padding width for the generated employee number')
on conflict (setting_key) do nothing;
