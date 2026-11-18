# Architecture

## 1. Shape of the system

```text
Browser ── Next.js App Router (Vercel)
             │
             ├── Presentation: Server Components, client components, forms, tables
             ├── Application: Server Actions, Route Handlers, services/*, Zod validation
             ├── Authorization: services/authorization + lib/permissions (RBAC)
             ├── Data: lib/supabase/{server,client,admin}.ts
             ▼
        Supabase
             ├── PostgreSQL (RLS everywhere, SECURITY DEFINER helpers)
             ├── Auth (email/password, cookie sessions)
             └── Storage (private buckets — later phases)
```

**Pattern:** modular monolith. One deployable Next.js application, organised by business
domain, with a single database and transactional consistency across modules. Microservices are
explicitly out of scope; they can be extracted later if real scale demands it.

## 2. Layering rules

| Layer | Location | May do | May not do |
|---|---|---|---|
| Presentation | `app/**/page.tsx`, `components/**` | Render, collect input, call actions | Contain SQL, permission logic or business rules |
| Application | `app/**/actions.ts`, `services/**` | Validate, authorize, orchestrate, audit | Render UI |
| Data | `lib/supabase/**`, `services/*/get-*.ts` | Query Supabase with the caller's identity | Be imported by client components (`server-only`) |
| Database | `supabase/migrations/**` | Constraints, triggers, RLS, helper functions | Contain business policy that belongs in code |

Client components never import `services/**` or `lib/supabase/admin.ts`; the `server-only`
package makes such an import a build error rather than a runtime leak.

## 3. Request lifecycle (authenticated page)

1. `proxy.ts` (Next.js 16's replacement for `middleware.ts`) refreshes Supabase auth cookies
   and performs a coarse gate: no session → redirect to `/login?next=…`.
2. `app/(dashboard)/layout.tsx` calls `resolveCurrentPrincipal()`: verifies the session with
   Supabase Auth, loads the profile, rejects inactive profiles/employees, and resolves roles →
   permissions.
3. The page calls `requirePermission('…')` before querying. Missing permission → authorization
   error, not a rendered page.
4. Queries run through the request-scoped server client, so PostgreSQL RLS independently
   filters every row the query touches.
5. Mutations run through a Server Action → service → permission check → Zod parse → write →
   audit event → `revalidatePath`.

Both layers (application services and RLS) enforce access. Neither is trusted alone.

## 4. Server Action contract

Actions return a discriminated result rather than throwing:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: AppErrorCode; message: string; details?: Record<string, string[]> } };
```

`lib/errors/index.ts` maps unknown failures to safe codes (`FORBIDDEN`, `VALIDATION_ERROR`,
`CONFLICT`, …) and never leaks SQL text or stack traces to end users.

## 5. Supabase clients

| Client | File | Identity | RLS |
|---|---|---|---|
| Browser | `lib/supabase/client.ts` | Signed-in user | Enforced |
| Server | `lib/supabase/server.ts` | Signed-in user (cookies) | Enforced |
| Admin | `lib/supabase/admin.ts` | service-role | **Bypassed** — server-only, authorization-first, audit-required |

The admin client is used for exactly three things in Phase 0: trusted audit writes, post-login
bookkeeping (`last_login_at`) and operator-driven provisioning (`scripts/bootstrap-admin.ts`).

## 6. Error and empty states

Every data-driven surface implements: loading (`loading.tsx`, `TableSkeleton`), empty
(`EmptyState`), error (`app/error.tsx`, `ErrorState`), permission denied (`PermissionGuard`) and
not-configured (`Alert` on login/dashboard when env is missing).

## 7. Extensibility for later phases

- New transactional modules add: migration (tables + RLS), service module, actions, pages.
- Posting operations (stock movements, journals) will be implemented as transactional RPC
  functions or single-statement services with database-enforced balance checks — not as
  multi-step client writes.
- `approval_limits` already exists as data for the future workflow engine; no routing or
  thresholds are implemented or invented here.
