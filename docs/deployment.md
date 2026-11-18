# Deployment

## 1. Target platform

Vercel (or any Node.js 20+ host that supports Next.js 16 App Router and long-lived server
rendering). The database, auth and storage are Supabase-managed.

## 2. Pre-deployment checklist

- [ ] Supabase production project created; migrations applied via `supabase db push`
- [ ] `npm run test:db` green against the migration set being deployed
- [ ] Permission/role seeds applied (`0012`–`0014`)
- [ ] Auth URL configuration updated (Site URL + `/auth/callback` redirect)
- [ ] Public sign-ups disabled
- [ ] Environment variables set for **production, preview and development** targets
- [ ] `SUPABASE_SERVICE_ROLE_KEY` stored as a *sensitive* variable, never `NEXT_PUBLIC_*`
- [ ] First administrator provisioned through `admin:bootstrap`
- [ ] Backups enabled on the Supabase plan in use

## 3. Environment variables on Vercel

| Key | Environments | Type |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production/Preview | plain |
| `NEXT_PUBLIC_SUPABASE_URL` | Production/Preview/Development | plain |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production/Preview/Development | plain |
| `SUPABASE_SERVICE_ROLE_KEY` | Production (and Preview if needed) | **sensitive** |
| `NODE_ENV` | managed by Vercel | — |

## 4. Deployment procedure

```bash
npm ci
npm run lint && npm run typecheck && npm run test && npm run test:db && npm run build
git push origin main          # Vercel builds and promotes
```

Database changes ship **before** the application that depends on them:

1. Apply migrations to Supabase (`supabase db push`).
2. Deploy the application.
3. Run smoke tests.

## 5. Post-deployment smoke tests

| Check | Expected |
|---|---|
| `GET /api/health` | `200` with `status: "ok"` (503 + `degraded` means DB/env problem) |
| `GET /login` | Sign-in form renders, no configuration alert |
| `GET /dashboard` unauthenticated | `307` → `/login?next=…` |
| Sign in as the bootstrapped admin | Dashboard loads; role badge visible |
| `GET /administration/users` as non-admin | Redirected/denied, never rendered |
| Audit log | Contains `system.admin_bootstrapped` and the sign-in event |
| Browser devtools → search bundle for `service_role` | No match |

## 6. Rollback

- **Application:** Vercel instant rollback to the previous deployment.
- **Database:** migrations are forward-only. Write a compensating migration; never edit an
  applied one. Take a Supabase backup before destructive changes.
- **Seeds:** idempotent by design (`on conflict`), safe to re-run.

## 7. Operational responsibilities

| Item | Owner |
|---|---|
| Database backups & restoration drills | Platform owner |
| Auth email deliverability (SMTP) | Platform owner |
| Role/permission review | System Administrator |
| Audit review | Auditor / Management |
| Secret rotation | Platform owner (rotate service-role key annually and on staff change) |
