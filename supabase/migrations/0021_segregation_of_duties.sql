-- 0021 — segregation-of-duties rule framework
--
-- Configurable rules only. No conflicting-duty rule is seeded: Pluck Agro management must
-- approve each policy before it is enforced. The evaluation service exists so that later
-- workflow phases can block, warn or require an override.

create table if not exists public.segregation_of_duties_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  module text not null,
  transaction_type text not null,
  first_action text not null,
  conflicting_action text not null,
  enforcement_level text not null default 'WARN',
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sod_rules_code_unique unique (code),
  constraint sod_rules_code_format check (code ~ '^[A-Z0-9_-]{3,40}$'),
  constraint sod_rules_name_not_blank check (length(btrim(name)) > 0),
  constraint sod_rules_enforcement_check check (enforcement_level in ('BLOCK', 'WARN', 'REQUIRE_OVERRIDE')),
  constraint sod_rules_distinct_actions check (first_action <> conflicting_action),
  constraint sod_rules_action_format check (first_action ~ '^[a-z][a-z0-9_]*$' and conflicting_action ~ '^[a-z][a-z0-9_]*$'),
  constraint sod_rules_module_format check (module ~ '^[a-z][a-z0-9_]*$')
);

create index if not exists sod_rules_active_idx on public.segregation_of_duties_rules (is_active, module);

comment on table public.segregation_of_duties_rules is
  'Configurable conflicting-duty rules. Evaluated by future workflow services; Phase 1 provides configuration and validation only.';

drop trigger if exists sod_rules_set_updated_at on public.segregation_of_duties_rules;
create trigger sod_rules_set_updated_at
  before update on public.segregation_of_duties_rules
  for each row execute function private.set_updated_at();

-- Durable record of overrides granted for REQUIRE_OVERRIDE rules.
create table if not exists public.sod_overrides (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.segregation_of_duties_rules (id) on delete cascade on update cascade,
  employee_id uuid not null references public.employees (id) on delete cascade on update cascade,
  entity_type text,
  entity_id uuid,
  justification text not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint sod_overrides_justification_present check (length(btrim(justification)) >= 10)
);

create index if not exists sod_overrides_employee_idx on public.sod_overrides (employee_id);
