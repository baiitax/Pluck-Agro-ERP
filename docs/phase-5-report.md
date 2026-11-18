# Phase 5 — Quality Management: implementation report

**Date:** 17 November 2026
**Scope delivered:** quality parameters and specifications, sampling plans, inspections, samples, results and
conformance, dispositions and release, quality holds, non-conformance reports (NCR), corrective and preventive
actions (CAPA), certificates of analysis, lot traceability, quality reporting, and the quality workspace.
**Migrations:** `0074`–`0083` (10 files).

---

## 1. Executive summary

Phase 5 is implemented and its behaviour is verified at the database level by an executed suite. The seam the
phase exists for works: a lot received in Phase 4 arrives **restricted pending inspection**, and the only thing
that makes its stock available again is a quality disposition recorded by an authorised person against an
approved inspection.

Three things are deliberately absent, and the interface says so where a user would otherwise expect them:
**no quality limits** (moisture, purity, grading bands and acceptance criteria are Pluck Agro's own definitions
and can only arrive as specification rows an authorised person approves), **no laboratory accreditation or
certificate numbers** (the columns exist and are filled from a real document, never seeded), and **no quality
score, supplier rating or first-pass yield** (the reports show counts; a composite score would be an invented
judgement).

| Item | Result |
| --- | --- |
| Migrations `0074`–`0083` | Apply clean on PostgreSQL (PGlite) from `0001` |
| Schema after Phase 5 | 137 tables, 50 views, **248** permissions, **1 055** role→permission grants, 16 roles |
| Database tests | **151 / 151 passed** (was 135 before this phase's permanent suite; 16 new) |
| Unit tests | **179 / 179 passed** (was 168; 11 new) |
| End-to-end tests | **266 / 266 passed** (was 224; 42 new, 21 tests × 2 viewports) |
| ESLint | 0 errors, 1 pre-existing advisory (`react-hooks/incompatible-library` on TanStack Table) |
| TypeScript | clean (`tsc --noEmit`) |
| Production build | succeeded, **139 routes** (16 of them `/quality/**`) |

Everything in that table was executed in this session; the commands are listed in §9.

**Read §10 before deploying.** The migrations for this phase have not yet been applied to the deployed Supabase
project, so the live site must not receive this code before that step.

---

## 2. What was built

### 2.1 Foundation (`0074`)

| Object | Purpose |
| --- | --- |
| `quality_numbering` | Reference series allocated under a row lock: `PA-QSP`, `PA-QIN`, `PA-QNC`, `PA-QCA`, `PA-QCO`. |
| `quality_status_transitions` | Every legal lifecycle edge with the permission it requires and whether it demands a reason. Nothing sets a status outside this table. |
| `quality_status_history` | Append-only trail of every transition, with actor, timestamp and reason. |
| `quality_settings` | Policy switches. `inspection.require_approval_before_disposition`, `hold.require_reason` and `certificate.require_release_disposition` are on; `inspection.allow_partial_result_submission` is off. |
| `quality.escalation.*`, `inspection.retest_interval_days`, `inspection.default_sample_basis` | **Seeded with no value.** The readers refuse with an explanatory message while they are unset; a guessed interval would silently become a quality decision. |

The migration also extends `permissions_action_check` with the three verbs this phase needs — `collect`, `record`,
`hold` — so `quality.*` codes are made of words that mean what the officer does.

### 2.2 Specifications (`0075`)

| Object | Purpose |
| --- | --- |
| `quality_parameters` | The measurable catalogue: moisture, purity, appearance, foreign matter. Name, result type (`numeric`, `text`, `pass_fail`, `observation`), unit, method reference. **Seeded empty.** |
| `quality_specifications` | One product + stage + version. `draft → approved → superseded`. |
| `quality_specification_parameters` | A line: min/max/target, expected text, mandatory flag, criticality. Immutable once the specification is approved (trigger). |
| `quality_approve_specification` | Refuses a draft that contains a mandatory line with neither a limit nor an expected value — a specification that cannot decide anything is not approvable — then supersedes the previous approved version rather than editing it. |
| `quality_effective_specification` | Resolves the single approved version for a product+stage, so an inspection never has to guess. |

### 2.3 Sampling, inspections and results (`0076`)

| Object | Purpose |
| --- | --- |
| `quality_sampling_plans` | Percentage or fixed basis, per product and stage. **Seeded empty** (the sampling policy is Pluck Agro's). |
| `quality_inspections` | The quality record: lot, specification version, stage, type, inspector, status, summary. |
| `quality_samples` | What was physically drawn, with quantity and unit. |
| `quality_inspection_results` | One row per (inspection, parameter). `conformance` is **computed by trigger** from the recorded limits and refuses any attempt by a caller to set it. |
| `quality_submit_inspection` | Derives the inspection summary from the results and refuses while a mandatory parameter has no result (unless the policy allows partial submission). Results and the specification snapshot freeze on submission. |
| `quality_approve_inspection` | The approval gate that a disposition requires. |

The conformance rule that matters: **a result with no limit to judge against is `not_evaluated`, never `conforming`.**
Recorded evidence that nothing compares against is not a pass.

### 2.4 Dispositions, holds and release (`0077`)

| Object | Purpose |
| --- | --- |
| `quality_dispositions` | `release \| reject \| hold \| rework \| downgrade \| quarantine`, with a mandatory reason, optional quantity, instruction and review date. One per inspection. |
| `quality_holds` | A quality hold row per lot, linked to the Phase 4 `inventory_restrictions` row it created, carrying `restriction_state` of `pending / confirmed / failed`. |
| `quality_record_disposition` | The function the phase exists for; see below. |
| `quality_place_hold`, `quality_release_hold` | Hold and partial release through the Phase 4 restriction seam. |
| `quality_revoke_disposition` | Reverses a disposition with a reason, re-restricting the stock. |

`quality_record_disposition`:

1. refuses an inspection that is not approved (policy `inspection.require_approval_before_disposition`);
2. refuses a **release** against a `non_conforming` inspection — a result that failed its own limits cannot be
   released by choosing a different disposition;
3. refuses a second `recorded` disposition on the same inspection;
4. **releases** this inspection's confirmed quality holds and every `pending_inspection` restriction on the lot
   (excluding a `quarantined_receipt_reason` restriction, which only a receipt quarantine may lift) — and only
   then is the stock available;
5. for `reject | quarantine | hold | rework | downgrade`, places a hold of
   `least(target quantity, inventory_lot_available)` through `inventory_apply_restriction`;
6. records the result of that call **honestly**: if the inventory side refuses, the `quality_holds` row is
   written with `restriction_state = 'failed'`, the database's own error text is stored, and the stock is left
   exactly as it was. The UI lists failed holds with that text and **offers no release button** for them.

### 2.5 Non-conformance and corrective action (`0078`)

| Object | Purpose |
| --- | --- |
| `quality_ncrs` | Title, description, severity (`critical/major/minor/observation`), source (`inspection/supplier/internal/customer_complaint/audit/deviation`), containment, root cause, status. |
| `quality_capa_actions` | Corrective or preventive actions with owner, due date and status. |
| `quality_close_ncr` | Refuses while any linked action is still open, and requires a root cause. |
| `quality_verify_capa` | Verification is a **separate permission from completion**: the person who completed an action is not automatically the person who can declare it effective, and verification requires written evidence. |

An NCR is deliberately a different object from a rejected disposition: a rejection records a decision about stock,
an NCR records a problem to investigate. Both can exist for the same lot.

### 2.6 Certificates of analysis (`0079`)

`quality_certificates` stores a **frozen snapshot** — `content` jsonb holding the results, the limits they were
judged against, the specification version, the lot references and the disposition reference, captured at issue.
A certificate can never silently re-derive from data that changed after it was issued. Issuing requires a
`release` disposition (policy `certificate.require_release_disposition`); a re-issue supersedes the previous
certificate rather than editing it; and voiding requires a reason. `laboratory_name` and
`accreditation_reference` are free-text columns filled from a real document and seeded with nothing.

### 2.7 Views and reporting (`0080`)

Ten views, all `security_invoker = true`, so the caller's own row-level security applies and a view can never be a
way around a policy:

`quality_specification_register`, `quality_inspection_register`, `quality_lot_status`, `quality_release_register`,
`quality_open_holds`, `quality_ncr_register`, `quality_capa_register`, `quality_certificate_register`,
`quality_lot_traceability`, `quality_dashboard_summary`.

Nothing is cached and nothing stores a judgement: every figure is derived at read time. `quality_lot_traceability`
joins the Phase 4 ledger and the production batch provenance into one chain, so a lot can be followed from receipt
through inspection, disposition and batch consumption without a second copy of the truth.

### 2.8 Permissions and RLS (`0081`–`0083`)

33 new `quality.*` codes (248 total, up from 215) and **180 new grants across 13 roles** (1 055 in total), generated from
`lib/permissions/definitions.ts` by `scripts/generate-seed-sql.mjs` into `0082`/`0083`.

Separations that matter:

- `quality.result.record` (enters evidence) is distinct from `quality.inspection.approve` (accepts it) and
  `quality.disposition.record` (decides what happens to the stock). `quality_control_officer` holds the first two
  and not the third.
- `quality.certificate.issue` is separate from `quality.disposition.record`; a certificate records a decision that
  was already made.
- `quality.capa.verify` is separate from `quality.capa.complete`.
- `quality.reports.view` gives the figures without granting any write.

`0081` follows the Phase 2–4 posture: configuration tables readable by any active profile, transactional tables
readable only with the matching `quality.*.view`, writes gated on the specific permission, and no `DELETE` grant
on an append-only table.

### 2.9 Interface

16 routes under `app/(dashboard)/quality/**`:

| Route | Page |
| --- | --- |
| `/quality` | Overview: open inspections, holds, NCRs, expiring releases. |
| `/quality/specifications`, `/new`, `/[specificationId]` | Register, raise a version, detail with lines, approval and supersession history. |
| `/quality/inspections`, `/new`, `/[inspectionId]` | Register, open an inspection, detail with **every expected parameter shown (missing ones included)**, result form, sample form, submit/approve/disposition/certificate panels. |
| `/quality/dispositions` | Register with the full reason text; releases highlighted. |
| `/quality/holds` | Open holds, restricted quantity vs held quantity, failed-restriction banner. |
| `/quality/ncr`, `/new`, `/[ncrId]` | Register, raise, detail with investigation, CAPA table with inline complete/verify, close panel. |
| `/quality/certificates`, `/[certificateId]` | Register, and the certificate document rendering the frozen snapshot, with supersede and void panels. |
| `/quality/traceability` | Lot quality position and the full chain for a lot. |
| `/quality/reports` | **Counts only.** No quality score, no supplier rating, no first-pass yield. |

The inspection detail page is the one place where the honesty rules are most visible: a parameter with no result
is displayed as *not evaluated*, never as a pass, and the disposition panel refuses to offer `release` on a
non-conforming inspection in the UI as well as in the database.

---

## 3. Defects found and fixed during verification

### 3.1 A view cannot answer a question its columns do not carry

`quality_inspection_register` had no `decided_at`, and the detail page wanted the disposition timestamp. The first
draft reached through to the base table; that is exactly the pattern that produces a page reading two different
snapshots. The register view was widened with the columns the page needs (`description`, `containment_action`,
`root_cause`, `status_reason` on the NCR register too) and the generated types regenerated. **Rule adopted: a page
reads one view, not a view plus a table.**

### 3.2 Generated types make every view column nullable

`hidden={{ id: row.id }}` failed type-check on view-sourced ids. Coalesced at the call site (`row.id ?? ""`) rather
than by casting, so the possibility of a null is still visible to the reader.

### 3.3 The permission drift guard was right, and the seeds were the thing that had to change

`tests/unit/permissions.test.ts` failed in three places the moment quality codes were added: the closed
`PERMISSION_ACTIONS` vocabulary (38 → 41), the "every catalogued code is seeded" case and the role-grant parity
case — the last two because the test only knew the four pre-quality seed files and therefore saw 215 of 248 codes.
The test was extended to read `0082`/`0083`, to assert the `quality.` prefix on that file and to assert that `0025`
never deletes a `quality.` row. This is the guard working as designed.

### 3.4 Stale "Phase 0" copy on the sign-in page

The authentication shell still advertised *"Phase 0 — Technical Foundation … operational modules follow in later
phases"* — untrue after five phases. The platform phase label now comes from `config/app.config.ts` and the copy
describes the delivery model without naming unshipped modules (the Phase 2 suite forbids the login page from
disclosing module names, and it caught the first attempt at this wording). The dashboard description, the
sidebar footer, the module placeholder and the security card were corrected the same way.

### 3.5 The navigation still advertised shipped modules as planned

`Procurement`, `Production`, `Inventory` and `Quality Control` were all marked `status: "planned"` with notes
saying they would "land in a later phase". They are delivered. All four are now `ready`; the unit test that
asserted `/procurement` was not ready now names `/export`, which genuinely is still a placeholder.

---

## 4. Design decisions now locked

1. **A quality hold is a stock movement-level fact, not a status label.** Every hold writes through the Phase 4
   availability function; every release does the same in reverse. A failed hold is recorded as failed with the
   database's own message.
2. **Nothing can release stock except a disposition, and only from an approved inspection.**
3. **A non-conforming inspection cannot be released** by any route, including choosing a different disposition.
4. **A result with no limit is `not_evaluated`, never a pass.** Conformance is computed by trigger and a caller
   cannot set it.
5. **Approval freezes; correction means a new version.** Approved specifications, submitted inspection results and
   issued certificates are immutable; supersession is the only way forward.
6. **No quality limit, sampling basis, retest interval or accreditation reference is seeded.** Where the value is
   unknown the setting is NULL and the function refuses with an explanation.
7. **No composite metric.** Reports count inspections, holds, NCRs and certificates; they do not score a supplier
   or compute a yield.

---

## 5. Permissions

33 new codes (248 total, 215 before), 180 grants over 13 roles (1 055 in total). Notable: `quality_control_officer` holds 31 of 33 (everything
except issuing a certificate against a disposition it did not make, and the report export); `managing_director`
holds 13 read/approve codes; `storekeeper` holds 3 (`quality.inspection.view`, `quality.hold.view`,
`quality.lot.view`) because a storekeeper must see that stock is held but must not decide it.

---

## 6. Verification evidence

### 6.1 Commands actually run

```
npx tsc --noEmit                                           # clean
npx eslint .                                               # 0 errors, 1 advisory (pre-existing)
npx vitest run --project unit                              # 179 passed (13 files)
npx vitest run --project database                          # 151 passed (7 files)
npm run build                                              # success, 139 routes
npx playwright test                                        # 266 passed (2 viewports)
```

The Playwright run needed the browser binary and its system libraries, which the sandbox does not carry by
default: `npx playwright install chromium` plus `playwright install-deps chromium` (via `sudo apt-get`). A CI image
with the standard Playwright dependencies needs neither step.

### 6.2 New permanent tests

| File | Covers |
| --- | --- |
| `tests/database/quality.test.ts` (16 tests) | Approval refuses a specification that cannot decide anything and freezes an approved one; supersession instead of editing; conformance computed from recorded limits and a caller refused when trying to set it; a result with no limit labelled `not_evaluated`; the summary derived on submission and results frozen afterwards; submission refused with a mandatory result missing; **the Phase 4 `pending_inspection` restriction released and only then the stock available**; a disposition refused on an unapproved inspection; stock kept restricted on rejection with the hold recorded; a non-conforming inspection refused for release; a hold recorded as `failed` when the inventory side refuses; a disposition recorded only once; NCR close refused while an action is open and root cause required; verification refused on an incomplete action; certificate issuing a frozen snapshot, refused without a release, superseding rather than editing; the lot quality position and hold counts derived from posted rows. |
| `tests/unit/quality.test.ts` (11 tests) | Every status vocabulary cross-checked against the SQL check constraints; a label and tone for every status; the `failed` hold label saying *Restriction FAILED*; form schemas for specifications, results (six decimal places, text until PostgreSQL casts it), dispositions (a substantive reason), holds, NCRs, CAPA verification (evidence required), parameter codes and inspections. |
| `tests/e2e/phase5-quality.spec.ts` (21 tests × 2 viewports) | All 12 quality routes gate an anonymous visitor; 4 deep links are gated before the identifier is used; the login page discloses no quality vocabulary; no inspection, hold or conformance figure is rendered anonymously; a certificate or inspection deep link produces no document; no quality route answers 500 when the backend is unreachable. |
| `tests/unit/permissions.test.ts` (updated) | The drift guard extended to the Phase 5 seed files and the 41-verb vocabulary. |

---

## 7. Known limitations

1. **No authenticated end-to-end run against a deployed backend.** The quality pages typecheck, lint, build and
   render behind authentication, but the journey *sign in → raise a specification → inspect a lot → disposition →
   release → issue a certificate* has not been executed in a browser against a live Supabase project. The
   database-level behaviour underneath it is covered by the 16 executed database tests. This is the same gap
   Phase 4 recorded, and it is not closed by this phase.
2. **No data has been inspected.** No parameter catalogue, no sampling plan, no specification and no lot exists —
   all of it is company data and none of it was invented.
3. **`services/quality/certificates.ts` does not exist.** Certificate reads live in `dispositions.ts`; splitting
   them would have produced two modules with one writer between them.
4. **No print/PDF rendering of a certificate.** The page renders the frozen `content` snapshot and the browser's
   own print is the only output path; no template engine or PDF service is wired up.
5. **Retest scheduling is stated, not implemented as a job.** `inspection.retest_interval_days` is NULL and no
   scheduler exists; the release view flags lots, but nothing emails or escalates.

---

## 8. Production readiness

| Area | Status |
| --- | --- |
| Schema, constraints, lifecycle guards | **VERIFIED IMPLEMENTED** (executed database suite) |
| Disposition → Phase 4 restriction release | **VERIFIED IMPLEMENTED** (executed database suite) |
| Conformance computation and freezing | **VERIFIED IMPLEMENTED** |
| NCR / CAPA lifecycle | **VERIFIED IMPLEMENTED** |
| Certificate snapshot and supersession | **VERIFIED IMPLEMENTED** |
| Reporting views | **VERIFIED IMPLEMENTED** (counts only, by design) |
| Quality workspace (16 routes) | **IMPLEMENTED BUT NOT VERIFIED** — typechecks, lints, builds, renders behind auth; no authenticated click-through against a live backend |
| RLS for Phase 5 tables | **IMPLEMENTED BUT NOT VERIFIED** — policies written in `0081` and exercised only by the PGlite suite; no live evaluation as `authenticated` with JWT claims, because the migrations are not yet applied to the deployed project |
| Migrations `0074`–`0083` on the deployed Supabase project | **NOT APPLIED** — see §10 |
| Authenticated end-to-end scenario | **NOT IMPLEMENTED** as an automated test |

---

## 9. Files added or changed in this phase

**Migrations:** `0074`–`0081` (foundation, specifications, inspections, dispositions/release, NCR/CAPA,
certificates, views, RLS), `0082`/`0083` (generated permission and grant seeds).

**Services:** `services/quality/{shared,specifications,inspections,dispositions,ncr,reporting}.ts` (1 579 lines).

**Library:** `lib/quality/statuses.ts`, `lib/validation/quality.schemas.ts`.

**Generated types:** `types/database.types.ts` regenerated — 137 tables, 50 views (10 quality views added to
`scripts/generate-database-types.py`).

**Routes:** `app/(dashboard)/quality/**` — 15 route files plus `actions.ts` and `layout.tsx`.

**Configuration:** `config/app.config.ts` (phase label), `config/navigation.config.ts` (four operations modules
moved from `planned` to `ready`), `app/(auth)/layout.tsx`, `app/(dashboard)/dashboard/page.tsx`,
`app/(dashboard)/administration/page.tsx`, `components/layout/app-sidebar.tsx`,
`components/shared/module-placeholder.tsx`.

**Tests:** `tests/database/quality.test.ts`, `tests/unit/quality.test.ts`,
`tests/e2e/phase5-quality.spec.ts`; `tests/unit/permissions.test.ts` updated.

**Docs:** this report.

---

## 10. Deployment order — read before pushing

`0074`–`0083` are **not** applied to the deployed project. That project is not visible to the Supabase connector available here (the
connector lists six unrelated projects, none of them this one), so the migrations could not be applied from this
session. The last verified state of the live database is 73 migrations (`0001`–`0073`), 121 tables, 41 views,
217 permissions, 887 grants — note that the offline catalogue at `0073` seeds 215 codes, so the live permission
count should be reconciled against `0025`/`0040`/`0051`/`0065` when the next batch is applied. After
`0074`–`0083` the expected totals are 137 tables, 50 views, 248 permissions and 1 055 grants.

Vercel deploys `main` on push. If Phase 5 code reaches production before the migrations, every `/quality` route
will query tables that do not exist and fail at request time (the pages will render an error, not a leak — the
queries are all behind authorisation and the routes are all `force-dynamic`).

**Required order:**

1. Apply `0074`–`0083` to the live project, stopping on the first error. Each file is independently numbered and
   the two seeds are generated.
2. Verify: `select count(*) from public.quality_specifications;` returns 0 (not an error), and
   `select count(*) from public.permissions where code like 'quality.%';` returns 33.
3. Then push the Phase 5 commit and let Vercel deploy.

`docs/live-database-migration.md` records how the earlier phases were applied; the database password was supplied
in conversation and used only in a temporary file, never in a tracked one. The same handling applies here.

---

## 11. What Phase 6 inherits

Phase 6 (sales, dispatch, export) can now rely on a real quality position per lot: `quality_lot_status` answers
"is this release-eligible" from the ledger and the dispositions rather than from a flag, and
`quality_lot_traceability` already joins receipt, inspection and batch provenance. The rows a sales or dispatch
gate would need — a released lot with a certificate — can now exist.

Nothing in this report claims that stock has been inspected, that a certificate has been issued, or that any
quality limit has been agreed. Those are company facts and remain outstanding.
