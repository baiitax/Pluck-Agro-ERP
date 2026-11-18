# Live database users and Vercel environment — status

**Date:** 17 November 2026
**Project:** `pqpwdldqovjylomdnyft` (PostgreSQL 17.12, `aws-1-eu-west-1.pooler.supabase.com`)

---

## 0. Outcome — this is finished

The live site **signs real users in** against the live database. Nothing is stubbed and nothing is a placeholder.

| Check | Result |
| --- | --- |
| `https://pluckagro.vercel.app/api/health` | **200** `{"status":"ok","checks":{"database":"ok","environment":"ok"}}` |
| Anonymous `/inventory` | 307 → `/login?next=%2Finventory` |
| Sign-in as `management@pluckagro.com` | → `/dashboard`, signed-in user shown |
| `/inventory`, `/production`, `/master-data/products` | render real workspace content, no permission guard |
| Browser console / network during the run | no failed requests |

Production is deployed from `main` (`429c025`) on Vercel project `pluckagro`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET` were already present (17 env vars total);
  `NEXT_PUBLIC_APP_URL=https://pluckagro.vercel.app` was added.
- Supabase `auth.users` rows created by migration had to be completed before GoTrue would issue a token.
  NULL token columns (`confirmation_token`, `recovery_token`, `email_change`, `email_change_token_new`,
  `email_change_token_current`, `reauthentication_token`, `email_change_confirm_status`) made every password
  grant fail with `500 unexpected_failure`; `instance_id` had to be set as well. `confirmed_at` is a **generated
  column** and must never appear in an `UPDATE`.

### The health endpoint that always lied

`/api/health` reported `database: "error"` while the database was healthy. The probe read `departments` with the
**anon** key and no session, and the migrations grant `anon` nothing — by design — so PostgREST answered
`42501 permission denied`. A monitor that is permanently red is a monitor nobody reads. The probe now uses the
server-only admin client and fails only on a real error (`services/system/health-check.ts`, commit `429c025`).

### Security follow-up — read this before adding anything to the repo

A scratch Playwright script containing a real account password was committed once to the public repo
(`579e976`). It was removed, the commit was rewritten, and `main` force-pushed to `429c025`; `.gitignore` now
excludes `e2e-live*.mjs`. **The old commit is still fetchable on GitHub by its SHA**, so the password must be
treated as exposed:

- rotate the `management@pluckagro.com` password;
- rotate every secret that has been pasted in chat: the working Vercel token, the GitHub PAT, the database
  password, and both ERP user passwords.

Rule going forward: **no credential ever enters a tracked file.** Live E2E scripts live outside the repo or read
credentials from the environment.

## 1. Users created — DONE

Two accounts were created directly in the live database, in one transaction, and verified.

| Email | Role | Permissions | Purpose |
| --- | --- | --- | --- |
| `management@pluckagro.com` | `management_officer` | 45 | Management oversight: master data, procurement views, dashboards, reports |
| `manager@pluckagro.com` | `managing_director` | 85 | Approvals: procurement (requisition, PO, receipt, advance), production plans, inventory adjustments/counts/transfers, sales orders, dispatch |

Passwords were generated with 20 characters of `crypto.randomBytes` entropy and shown **once in the chat**. They
are not written to `.env.local`, any migration, or any file in this workspace. Both should be changed at first
sign-in.

Each account has, and was verified to have:

- an `auth.users` row with `email_confirmed_at` set (so no email confirmation step blocks sign-in);
- an `auth.identities` row with `provider = 'email'` — Supabase Auth requires this for email/password login,
  and a user without it fails to authenticate even with a correct password;
- `encrypted_password` produced by `extensions.crypt(password, gen_salt('bf'))`, the same bcrypt scheme GoTrue
  uses. Verification re-ran `crypt()` against the stored hash: **true for both**;
- an active `public.profiles` row (RLS treats a missing or inactive profile as "no ERP access at all");
- an active `public.user_roles` row binding exactly one role;
- a linked `public.employees` row (`PA-EMP-0001`, `PA-EMP-0002`).

### Deliberately not done

- **No approval authority limits were configured** (`approval_authorities` is still empty). The
  `managing_director` role holds `procurement.purchase_order.approve`, but no monetary band exists, so the
  approval engine has nothing to check a value against. Those limits are a company policy decision.
- **No super administrator was created.** `super_administrator` exists as a role with no holder. If you want a
  break-glass admin account, say so and one can be created the same way.
- **No master data.** Products, sites, warehouses, customers and suppliers are still empty.

## 2. Vercel environment — BLOCKED

The first Vercel token supplied (since rotated) was refused by Vercel itself, not by this agent:

| Call | Result |
| --- | --- |
| `GET /v2/user` | **403 forbidden — "Not authorized"** |
| `GET /v2/teams` | **403 forbidden** |
| `GET /v9/projects` | **403 forbidden** |
| Connector `get_authenticated_user` | **Access denied** |
| Connector `list_teams` | **Access denied** |

A token that cannot read its own user record is either revoked, mistyped, or scoped to a team it was not
granted. Nothing was written to Vercel — there was nothing to write to, since no project could be enumerated.

**To unblock, either:**

1. Issue a fresh token at Vercel → Account Settings → Tokens (scope: the team that owns the project), or
2. Re-connect the Vercel app in this conversation with an account that can see the project.

## 3. Supabase API keys — still needed

The Vercel deployment needs three values that only the Supabase dashboard can supply:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pqpwdldqovjylomdnyft.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → Project API keys → `anon` / `publishable` |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → Project API keys → `service_role` / `secret` |

They could not be read automatically:

- The Supabase connector is authenticated to a different account and returns **403** for this project — it does
  not appear in `list_projects` for that account.
- They are not derivable from the database. Checked and ruled out: `current_setting('app.settings.jwt_secret')`
  (null), `vault.secrets` (0 rows), no JWT-related GUC, no `auth.settings` table. The anon and service keys are
  minted from a JWT secret held by the Supabase platform, not by Postgres.

## 4. What becomes possible once those arrive

1. `.env.local` is updated and the local preview can sign in — the two accounts above would work immediately.
2. The same three values are set in Vercel for `production`, `preview` and `development`, then a redeploy picks
   them up.
3. `NEXT_PUBLIC_APP_URL` is set to the deployed domain, so Supabase auth redirects go to the right place.

Until then the deployed app fails closed with *"The ERP is not configured"*, which is the correct behaviour and
not a fault in the build.
