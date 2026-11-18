# Authentication

## 1. Provider

Supabase Auth only. No custom password storage, hashing or reset tokens exist anywhere in this
repository. Passwords are handled exclusively by Supabase, meeting the PRD requirement to
remove the legacy insecure password handling.

## 2. Sign-in flow

```text
/login  ──▶ signInAction (Server Action)
             ├── Zod validation (email normalised, password non-empty)
             ├── rate limit: 8 attempts / 5 min per IP+email (in-process)
             ├── supabase.auth.signInWithPassword()
             │      └── failure → generic "Invalid email or password" + audit auth.login_failed
             ├── resolveCurrentPrincipal()
             │      ├── no profile          → sign out, generic denial message
             │      ├── inactive profile    → sign out, "account deactivated"
             │      ├── inactive employee   → sign out, "employee record not active"
             │      └── authenticated       → continue
             ├── completeLogin(): last_login_at + audit auth.login_succeeded
             └── redirect to `next` (validated to a local path) or /dashboard
```

A valid Supabase session alone never grants ERP access. Identity resolution requires a
profile, an active profile, an active linked employee record, and at least one active role.

## 3. Sessions

- Cookies are managed by `@supabase/ssr` (`getAll` / `setAll`).
- `proxy.ts` refreshes the session on every request and validates it with `auth.getUser()`
  (JWT verified with Supabase Auth — not just decoded).
- Server Components, Server Actions and Route Handlers use the request-scoped client in
  `lib/supabase/server.ts`.
- Sign-out clears the Supabase session and redirects to `/login?status=signed_out`.
- Deactivation takes effect on the user's next request because the profile is re-read every
  request; no cached permission is trusted.

## 4. Password recovery

1. `/forgot-password` → `resetPasswordForEmail` with `redirectTo=/auth/callback?next=/reset-password`.
2. The response is identical whether or not the address exists (no account enumeration).
3. `/auth/callback` exchanges the code for a session.
4. `/reset-password` renders the form **only** when a recovery session exists; otherwise it
   instructs the user to request a new link.
5. `updateUser({ password })` enforces the password policy (≥10 chars, upper, lower, number),
   then signs out so the new credential is used explicitly.

## 5. Provisioning

Self-registration is disabled. Accounts are created by an administrator:

- create/identify the Supabase Auth user,
- link an employee record,
- create the `profiles` row,
- assign roles.

`npm run admin:bootstrap` performs this for the first Super Administrator and writes a
`system.admin_bootstrapped` audit event. No default credentials are committed.

## 6. Configuration requirements

| Setting | Value |
|---|---|
| Site URL | application origin |
| Redirect URLs | `<origin>/auth/callback` |
| Email signups | disabled |
| Email confirmations | enabled (recommended) |
| JWT expiry | 3600s (default), rotation enabled |

## 7. Known limitations (Phase 0)

- MFA for privileged roles is documented as required by the PRD but **not enabled** yet.
- Sign-in rate limiting is in-process; it must move to a shared store (or Supabase Auth limits)
  before horizontal scaling.
- Failed-login auditing is best-effort and does not lock accounts.
