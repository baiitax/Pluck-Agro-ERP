-- 0004 — roles, permissions and role_permissions
-- Roles are data, not hard-coded privilege strings. Permissions use the module.action format
-- and are seeded as controlled system data by migration 0011.

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  description text,
  is_system_role boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_name_unique unique (name),
  constraint roles_code_unique unique (code),
  constraint roles_code_format check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint roles_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  code text not null,
  description text,
  created_at timestamptz not null default now(),
  constraint permissions_code_unique unique (code),
  constraint permissions_module_action_unique unique (module, action),
  constraint permissions_code_format check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint permissions_code_matches_parts check (code = module || '.' || action),
  constraint permissions_action_check
    check (action in ('view', 'create', 'update', 'approve', 'manage', 'post', 'adjust', 'deactivate'))
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade on update cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade on update cascade,
  created_at timestamptz not null default now(),
  constraint role_permissions_unique unique (role_id, permission_id)
);

create index if not exists role_permissions_role_id_idx on public.role_permissions (role_id);
create index if not exists role_permissions_permission_id_idx on public.role_permissions (permission_id);

comment on table public.roles is 'Configurable roles. System roles are protected templates seeded by migration.';
comment on table public.permissions is 'Controlled permission definitions in module.action form.';
comment on table public.role_permissions is 'Role → permission grants.';

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function private.set_updated_at();
