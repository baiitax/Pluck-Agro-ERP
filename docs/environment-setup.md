# Environment setup

## 1. Requirements

| Tool | Version |
|---|---|
| Node.js | 20.9+ (22 LTS recommended) |
| npm | 10+ |
| Supabase CLI | latest (`npx supabase`) — needed for migrations/types |
| Supabase project | PostgreSQL 15+ managed, PostgreSQL 17 recommended |

## 2. Environment variables

Copy `.env.example` → `.env.local`.

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | public | Canonical app URL for auth email redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Publishable/anon key (RLS still applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Bypasses RLS; used by audit writes and provisioning |
| `NODE_ENV` | server | `development` \| `test` \| `production` |
| `SUPABASE_PROJECT_REF` | tooling | Used by `npm run db:types` |

Validation lives in `lib/env.ts` and fails fast with an actionable message. The application
also renders an explicit "not configured" state instead of a blank page when variables are
missing.

> `NEXT_PUBLIC_*` values are inlined at build time by Next.js. Set them in the build
> environment (Vercel project settings), not only at runtime.

## 3. First-time database setup

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push            # applies supabase/migrations in order
npm run db:types                # regenerate types/database.types.ts (requires SUPABASE_PROJECT_REF)
```

Then, in the Supabase dashboard → Authentication → URL configuration:

- Site URL: your application origin
- Redirect URLs: `<origin>/auth/callback`
- Disable public sign-ups; enable email confirmations

## 4. Provision the first administrator

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run admin:bootstrap -- \
  --email md@pluckagro.com \
  --password 'ChangeMe-Str0ng!' \
  --name "Managing Director" \
  --employee-number PA-0001 \
  --employee-name "Ada Obi"
```

The script creates the auth user (or reuses an existing one), an optional employee record, the
profile, the `super_administrator` role and an audit event. It is idempotent for the profile and
role rows.

## 5. Local development

```bash
npm install
npm run dev
```

Commands:

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Unit tests |
| `npm run test:db` | Migrations + RLS (PGlite, no Docker required) |
| `npm run test:e2e` | Playwright (starts the app on :3200) |
| `npm run build` | Production build |
| `node scripts/generate-seed-sql.mjs` | Regenerate permission/role seed migrations |

## 6. Optional: local Supabase stack

`supabase/config.toml` is included. `supabase start` + `supabase db reset` applies migrations
and `supabase/seed.sql` (local fixtures only: departments, no users, no transactions).

## 7. Troubleshooting

| Symptom | Cause |
|---|---|
| "Supabase is not configured" on /login | Missing `NEXT_PUBLIC_*` values in the **build** environment |
| Redirect loop to /login after sign-in | No active profile for the auth user, or profile `is_active = false` |
| `has_permission()` always false | No active `user_roles` row, role inactive, or assignment expired |
| Empty admin tables despite data | RLS: your role lacks the corresponding `*.view` permission |
