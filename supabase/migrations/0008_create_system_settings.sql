-- 0008 — system_settings
-- Non-secret configuration only. Credentials belong in environment variables or Supabase
-- Vault, never in application tables.

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null,
  setting_value jsonb,
  description text,
  is_sensitive boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_settings_key_unique unique (setting_key),
  constraint system_settings_key_format check (setting_key ~ '^[a-z][a-z0-9_.]{2,95}$')
);

comment on table public.system_settings is 'Application configuration (non-secret). Secrets must not be stored here.';

drop trigger if exists system_settings_set_updated_at on public.system_settings;
create trigger system_settings_set_updated_at
  before update on public.system_settings
  for each row execute function private.set_updated_at();

insert into public.system_settings (setting_key, setting_value, description)
values
  ('app.name', '"Pluck Agro ERP"'::jsonb, 'Application display name'),
  ('app.phase', '"Phase 0 — Technical Foundation"'::jsonb, 'Current implementation phase'),
  ('security.self_registration_enabled', 'false'::jsonb, 'Public self-registration is disabled; accounts are provisioned by administrators'),
  ('security.password_min_length', '10'::jsonb, 'Minimum password length enforced by the application'),
  ('localization.default_currency', '"NGN"'::jsonb, 'Default currency code'),
  ('localization.timezone', '"Africa/Lagos"'::jsonb, 'Default business timezone')
on conflict (setting_key) do nothing;
