# Phase 2 report — Master Data Management, Business Partners & Operational Reference Data

**Date:** 17 November 2026
**Scope:** Pluck Agro ERP — Phase 2 (Parts A–P of the Phase 2 specification)
**Repository:** `pluck-agro-erp/`
**Baseline:** the verified Phase 0 + Phase 1 codebase (151 tests, 52 end-to-end checks, 44 routes)

Status vocabulary used throughout — the same five words used in the Phase 1 report, and nothing
outside them:

| Status | Meaning |
|---|---|
| **VERIFIED IMPLEMENTED** | Code exists, is reachable, and was exercised by an automated check that passed in this workspace. |
| **IMPLEMENTED BUT NOT VERIFIED** | Code exists and compiles, but exercising it needs a live Supabase project, which could not be created (see §17). |
| **PARTIALLY IMPLEMENTED** | Deliberately bounded subset, with the missing part named. |
| **NOT IMPLEMENTED** | Absent, by scope decision or because it belongs to a later phase. |
| **BLOCKED** | Cannot be completed in this environment for an environmental reason. |

---

## 1. Executive summary

Phase 2 adds the shared registers every other module will read: suppliers, customers, the product
catalogue, units of measure with effective-dated conversions, sites / warehouses / storage
locations, and the commercial reference data (currencies, exchange rates, payment terms, delivery
terms, tax categories). Around those registers it adds the governance the specification asks for:
per-row change history written by database triggers, a configurable status lifecycle, duplicate
candidate detection with a review workspace that never merges anything by itself, a staged CSV
import centre, and data-quality indicators computed from live rows.

The design decisions that carry the most weight:

- **Nothing is invented.** Reference data ships with only what the business has stated: units,
  ISO 4217 currency *codes* (one marked active), the eleven published Incoterms 2020 codes with
  their editions, and no payment terms, no supplier or customer categories, no product categories,
  no products, no partners, no exchange rates, no tax rates. Each of those screens therefore shows
  an honest empty state rather than plausible-looking sample data.
- **Money and quantities are exact.** Rates, factors, credit limits and packaging weights are
  PostgreSQL `NUMERIC`, and a decimal-safe BigInt engine (`lib/uom/decimal.ts`) does the arithmetic.
  `format()` refuses to drop digits, and conversion refuses rather than guesses.
- **Sensitive data is separated.** Supplier banking lives in its own table behind
  `master_data.supplier_banking.view` / `.manage`; customer credit lives in
  `customer_credit_profiles` behind `master_data.customer_credit.view` / `.manage`. The application
  only ever returns a masked account number, and every banking change is audited — a changed account
  number is audited as `critical`.
- **Merging is not implemented, on purpose.** Duplicate detection produces candidate pairs and a
  reviewer records a judgement. No merge runs, because a merge needs referential-integrity
  reconciliation against procurement and financial history, and Phase 2 deliberately has neither.

**Gate results in this workspace**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | 0 errors, 1 pre-existing React-Compiler advisory (`components/tables/data-table.tsx`) |
| `npx vitest run --project unit` | **210 passed** (14 files) |
| `npx vitest run --project database` | **82 passed** (4 files, real migrations on PGlite) |
| `npx playwright test` | **106 passed** (desktop + mobile) |
| `npx next build` | success, **74 routes** (30 of them master data) |

Migration chain `0001` → `0041` applies from empty on PostgreSQL (PGlite): **59 public tables,
139 permissions, 16 roles, 617 grants**.

## 2. Schema delivered

Twelve migrations, `0030` … `0041`:

| File | Contents |
|---|---|
| `0030_master_data_foundation.sql` | Reference/prefix registry (`master_data_entities`), configurable status transitions, per-row change history, the four shared trigger functions, widened audit event-category vocabulary |
| `0031_suppliers.sql` | `supplier_categories`, `suppliers`, `supplier_category_assignments`, `supplier_contacts`, `supplier_addresses`, `supplier_bank_accounts`, `supplier_documents` |
| `0032_customers.sql` | `customer_categories`, `customers`, `customer_category_assignments`, `customer_contacts`, `customer_addresses`, `customer_credit_profiles`, `customer_documents` |
| `0033_units_of_measure.sql` | `units_of_measure`, `unit_conversions` |
| `0034_products.sql` | `product_categories` (hierarchical), `products`, `product_variants`, `product_specifications`, `product_packaging`, `product_attribute_definitions`, `product_attribute_values`, `supplier_product_categories` |
| `0035_sites_warehouses.sql` | `sites`, `warehouses`, `warehouse_locations` |
| `0036_commercial_references.sql` | `currencies`, `exchange_rates`, `payment_terms`, `delivery_terms`, `tax_categories` |
| `0037_master_data_governance.sql` | `master_data_duplicate_candidates`, `master_data_import_jobs`, `master_data_import_rows`, `legacy_record_references`, the `master_data_quality_issues` view |
| `0038_master_data_rls.sql` | RLS enabled and policies written on all 38 master-data tables, plus grants |
| `0039_seed_master_data_reference.sql` | Hand-written reference seed: 14 units of measure, 5 standard conversions, 5 ISO 4217 currencies (only NGN active), the 11 Incoterms 2020 codes, 9 payment-term templates created inactive |
| `0040_seed_master_data_permissions.sql` | 64 `master_data.*` permissions — **generated**, never hand-edited |
| `0041_seed_master_data_grants.sql` | 292 role grants — **generated**, never hand-edited |

Conventions: UUID primary keys, `created_by` / `updated_by` / `created_at` / `updated_at` on every
record table, soft deactivation (`is_active` / status) rather than deletion, `NUMERIC` for every
rate, factor, weight and limit, and a business reference assigned by trigger from
`master_data_entities` (prefix + zero-padded sequence), never by the client.

## 3. Business reference numbering — VERIFIED IMPLEMENTED

Prefixes `PA-SUP`, `PA-CUS`, `PA-PRD`, `PA-WH` are rows in `master_data_entities`, each with its own
padding and `last_value`. Changing a policy is a data change, not a code change. The database test
asserts that two suppliers created in sequence receive `PA-SUP-000001`-style references that differ,
and that the configured prefix is read from the table rather than hard-coded.

## 4. Status lifecycles — VERIFIED IMPLEMENTED

Transitions live in `master_data_status_transitions` (`entity_type, from_status, to_status,
required_permission, requires_reason`). A trigger consults that table on every status update, so a
move that was not declared is rejected with `Illegal <entity> status transition`. The transition
also names the permission required for that edge, so a user who may edit a supplier cannot quietly
promote it to `verified`.

A reason is required for destructive edges (blocked, archived, discontinued, rejected). The reason
must accompany *that* transition: a reason left over from a previous change is not accepted, which a
database test exercises explicitly.

Statuses: supplier `draft → submitted → under_review → verified → active` (+ `rejected`, `inactive`,
`blocked`, `archived`); customer `lead → prospect → onboarding → verified → active` (+ `inactive`,
`blocked`, `archived`); product `draft → active → inactive → discontinued → archived`.

## 5. Suppliers — IMPLEMENTED BUT NOT VERIFIED (live data)

Register with server-side filters (search, status, verification, category), pagination, and a
profile with tabs for overview, contacts, addresses, approved supply, banking, documents and
history. Multiple classifications per supplier are supported: `primary_category_id` is for
reporting, `supplier_category_assignments` records the rest, and `supplier_product_categories`
records what the supplier is approved to supply. **A supplier is never restricted to one commodity
category.**

One primary contact and one primary address per supplier are enforced by partial unique indexes; the
service clears the previous primary before inserting the new one.

## 6. Customers — IMPLEMENTED BUT NOT VERIFIED (live data)

Register and profile (overview, contacts, addresses, credit reference, documents, history). Customer
types cover direct buyer, importer, distributor, manufacturer, wholesaler, retailer, trading company,
agent, domestic buyer and other — a customer is not modelled as a European export buyer only.

Credit data sits in its own table and its own permission. The credit tab states, in the interface,
that a stored limit does not authorise a credit sale and that no credit policy is applied. Saving a
credit reference is audited at `critical` severity.

## 7. Products — IMPLEMENTED BUT NOT VERIFIED (live data)

Catalogue with hierarchical categories, products, variants/grades, specifications, attribute
definitions and typed attribute values, and packaging configurations. Grade names are typed by the
business; the interface says so, and no grade is seeded.

The base unit is the anchor of all measurement. It may be changed while the product is a `draft`
only — the database refuses it afterwards, because changing it would silently re-interpret every
quantity already recorded against the product. A database test proves both halves of that rule.

## 8. Units of measure and conversions — VERIFIED IMPLEMENTED (engine), IMPLEMENTED BUT NOT VERIFIED (UI)

`lib/uom/decimal.ts` implements fixed-point decimal arithmetic on `BigInt`: parse, add, subtract,
multiply, divide with explicit scale, compare, round half-up, format without exponent notation.
`format()` throws rather than drop digits that carry value.

`lib/uom/convert.ts` exposes `convertQuantity()`, `getApplicableConversion()`, `validateConversion()`,
`getProductBaseUnit()` and `roundConvertedQuantity()`. It:

- refuses to convert when no rule exists for the pair and date;
- refuses a cross-category standard conversion (a bag is not a quantity of kilograms unless a
  product says what is in the bag);
- refuses a rule belonging to a different product;
- refuses an ambiguous path where two rules apply at once;
- respects `effective_from` / `effective_until` / `is_active`, so a historical conversion uses the
  factor that applied on its date.

Twenty conversion and decimal unit tests cover these paths, including `0.1 + 0.2 = 0.3` exactly and
`50 kg × 0.45359237 = 22.67961850`.

## 9. Sites, warehouses, storage locations — IMPLEMENTED BUT NOT VERIFIED (live data)

A site is the parent of warehouses; a warehouse belongs to exactly one site and contains
hierarchical storage locations (zone → aisle → rack → bin). Locations reuse the organisation tree
helper, which is cycle-safe. **No stock quantity, valuation or movement is stored** — this phase
records physical structure only, and the interface says so on the warehouse screen.

## 10. Commercial reference data — IMPLEMENTED BUT NOT VERIFIED (live data)

- **Currencies**: registry keyed by ISO 4217 code with decimal places. Symbols are display-only and
  never enter a calculation.
- **Exchange rates**: dated, typed (official / treasury / commercial / customs / other) and sourced.
  An approved rate is immutable: correcting a rate means recording a new one, so an applied rate
  stays reproducible. Enforced in the service and stated on the screen.
- **Payment terms / delivery terms / tax categories**: code-based reference rows with effective
  dates. **No tax rate is stored or computed**, and the tax screen explains why: an invented
  percentage would be mistaken for an authoritative rate.

## 11. Duplicate detection and review — VERIFIED IMPLEMENTED (scoring + persistence), IMPLEMENTED BUT NOT VERIFIED (live UI)

`lib/master-data/similarity.ts` normalises names (case, punctuation, legal suffixes), digits and
domains, and scores a pair with weighted field matches (registration number 30, code 30, tax id 25,
name 20, email 15, phone 12, bank account 10, website 8) against a 45/100 floor. Two missing phone
numbers do not count as a match.

A scan writes candidate pairs into `master_data_duplicate_candidates`; nothing else changes. A
reviewer records `open / confirmed_duplicate / not_duplicate / deferred`, with notes, and the
decision is audited. **No merge is performed** — the `merged` state exists for a future authorised
merge that must first reconcile referential integrity against procurement and financial history.

## 12. CSV import centre — VERIFIED IMPLEMENTED (parser/validator), IMPLEMENTED BUT NOT VERIFIED (live execution)

`lib/master-data/csv.ts` parses CSV with quoted delimiters, doubled quotes, quoted newlines, a BOM
and per-line error reporting; a row with the wrong column count is rejected rather than shifted. On
output it neutralises spreadsheet formula injection (`=`, `+`, `-`, `@`).

The pipeline is parse → validate → stage → preview → confirm → execute. Every uploaded row is
persisted with `accepted` / `rejected` / `imported` / `skipped_duplicate` and the messages that
decided it, so a rejected row is reviewable instead of lost. Idempotency is a `batch_key` derived
from entity, file name, row count and a content hash, with a unique constraint: uploading the same
file twice is refused rather than duplicating records. Both properties are covered by database
tests.

Import templates deliberately exclude banking and credit columns; a unit test asserts those column
names never appear in any template.

## 13. Data-quality framework — VERIFIED IMPLEMENTED

`public.master_data_quality_issues` is a SQL view over live rows, created `with (security_invoker =
true)` so the caller's RLS applies to the counts. It reports completeness, uniqueness, validity,
consistency, referential-integrity and timeliness signals (for example: suppliers with no contact
detail, suppliers never verified, documents past expiry, active products with no specification,
warehouses with no site, active currencies with no approved rate). The dashboard and the quality
workspace count this view; there is no scoring formula in TypeScript and no weighting. A database
test proves an indicator moves by exactly one when a gap is introduced and moves back when it is
filled.

## 14. Audit and change history — VERIFIED IMPLEMENTED

Two trails, on purpose. `master_data_change_history` records the field-level diff per row
(`change_type`, `changed_fields`, old/new JSON, actor, employee). `audit_logs` is the governance
record, written under the new `master_data` event category with actions
`master_data.created / updated / activated / deactivated / blocked / archived / verified / merged /
banking_changed / credit_changed / duplicate_resolved / import_staged / import_executed /
conversion_changed / exchange_rate_changed`, and severity `critical` for blocked, archived, banking
changes and credit changes.

Banking and base-unit changes are enhanced: the audit entry names the field that moved, and the
account number is never written — only its masked form.

## 15. Permissions — VERIFIED IMPLEMENTED (catalogue, seeds, grants)

64 `master_data.*` codes across 26 resources, generated from `lib/permissions/definitions.ts`. The
action set was extended from 20 to 25 to cover `verify`, `block`, `archive`, `review` and `execute`.
Grants are role *templates*: 292 master-data grants across 12 roles, and the sensitive ones are held
narrowly — only `finance_manager` holds both `supplier_banking.manage` and `customer_credit.manage`;
`auditor` holds neither. A database test asserts exactly that.

`sensitive_view` codes keep banking and credit out of the VIEW_ONLY scope, so "view everything" does
not become "view bank accounts".

## 16. User interface — IMPLEMENTED BUT NOT VERIFIED (live data)

Thirty routes: an overview dashboard with real counts, supplier / customer / product registers and
profiles with tabs, category management, units and conversions (with an interactive conversion
tester that calls the same server function procurement will call), sites, warehouses and storage
locations, the five commercial references, duplicate review, data quality, the import centre with a
job detail page, and change history. Every screen has loading, empty, error and permission-denied
states, and the empty states explain *why* they are empty. Navigation is filtered per caller
permission; the gate itself is server-side and repeated by RLS.

## 17. What was not verified, and why

No Supabase project exists for this work beyond what the standing instruction allows: the
organisation was at its project cap, and the instruction is never to pause or delete an existing
project to make room. Everything that requires an authenticated session against a live project is
therefore **implemented but not verified**. Concretely:

- creating, editing and transitioning partners and products through the UI;
- banking and credit screens with a real session (RLS verified at database level instead);
- staging and executing an import end to end;
- the duplicate review workspace against real candidate data;
- responsive behaviour of the new screens at mobile width in a real browser session.

The database-level behaviour that these depend on *is* verified: constraints, triggers, lifecycle
transitions, RLS denial, sensitive-table isolation, conversion factors as `NUMERIC`, import batch
idempotency, rejected-row persistence and the quality view.

## 18. Acceptance matrix

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| P2-001 | Supplier master record with categories, contacts, addresses, banking, documents | IMPLEMENTED BUT NOT VERIFIED | `0031`, `services/master-data/suppliers.ts`, 7 supplier tables |
| P2-002 | Suppliers support multiple classifications, not one commodity | IMPLEMENTED BUT NOT VERIFIED | `supplier_category_assignments`, `supplier_product_categories` |
| P2-003 | Customer master record with categories, contacts, addresses, documents | IMPLEMENTED BUT NOT VERIFIED | `0032`, `services/master-data/customers.ts` |
| P2-004 | Customers not limited to one market or to Europe | IMPLEMENTED BUT NOT VERIFIED | 10 customer types, `registration_country` free ISO field |
| P2-005 | Product catalogue: hierarchical categories, products, variants, specs, attributes, packaging | IMPLEMENTED BUT NOT VERIFIED | `0034`, `services/master-data/products.ts` |
| P2-006 | Units of measure with standard and product-specific conversions | VERIFIED IMPLEMENTED | `0033`, `lib/uom/convert.ts`, 20 unit tests, 3 database tests |
| P2-007 | Decimal-safe conversion; no float for critical quantities | VERIFIED IMPLEMENTED | `lib/uom/decimal.ts`, `NUMERIC` columns, `decimal.test.ts` |
| P2-008 | Effective-dated conversions; historical factors not rewritten | VERIFIED IMPLEMENTED | `isRuleEffective`, `asOf` in `convertQuantity`, conversion test |
| P2-009 | Sites, warehouses, hierarchical storage locations | IMPLEMENTED BUT NOT VERIFIED | `0035`, `services/master-data/locations.ts` |
| P2-010 | Currency registry and typed, sourced, effective-dated exchange rates | IMPLEMENTED BUT NOT VERIFIED | `0036`, `services/master-data/commercial.ts` |
| P2-011 | Applied rates never rewritten by a later update | PARTIALLY IMPLEMENTED | Approved rates are immutable in the service; no transaction history exists yet to prove the applied-rate path |
| P2-012 | Payment terms, delivery terms/Incoterms, tax categories | IMPLEMENTED BUT NOT VERIFIED | `0036`; no tax rate stored or computed |
| P2-013 | Legacy cross-reference (`source_system`, `source_table`, `source_record_id`, `target_entity`, `target_record_id`, `migration_batch_id`) | VERIFIED IMPLEMENTED | `legacy_record_references`, database test |
| P2-014 | Configurable reference numbering (`PA-SUP-…`, `PA-CUS-…`, `PA-PRD-…`, `PA-WH-…`) | VERIFIED IMPLEMENTED | `master_data_entities` + `private.next_master_reference`, database test |
| P2-015 | Supplier lifecycle DRAFT→SUBMITTED→UNDER_REVIEW→VERIFIED→ACTIVE + rejected/inactive/blocked/archived | VERIFIED IMPLEMENTED | transition table + guard trigger, database tests |
| P2-016 | Customer lifecycle LEAD…ARCHIVED | VERIFIED IMPLEMENTED | transition table + guard trigger |
| P2-017 | Product lifecycle DRAFT/ACTIVE/INACTIVE/DISCONTINUED/ARCHIVED | VERIFIED IMPLEMENTED | transition table + guard trigger, archive-reason test |
| P2-018 | Permission-controlled transitions | VERIFIED IMPLEMENTED | `required_permission` per edge, enforced by trigger |
| P2-019 | Duplicate detection with candidate scoring | VERIFIED IMPLEMENTED | `lib/master-data/similarity.ts`, 8 unit tests |
| P2-020 | Duplicate review never auto-merges | VERIFIED IMPLEMENTED | review records a status only; `merged` unreachable without a merge operation |
| P2-021 | Data-quality indicators from real rows | VERIFIED IMPLEMENTED | `master_data_quality_issues` view + 3 database tests |
| P2-022 | CSV import: template, parse, validate, preview, row-level rejection | VERIFIED IMPLEMENTED | `lib/master-data/csv.ts`, 12 unit tests |
| P2-023 | Import idempotency; failed rows never disappear | VERIFIED IMPLEMENTED | `batch_key` unique + row persistence, 2 database tests |
| P2-024 | Granular `master_data.*` permissions, suggested role mappings not auto-granted | VERIFIED IMPLEMENTED | 64 codes, 292 grants, permissions unit tests |
| P2-025 | RLS on every master-data table | VERIFIED IMPLEMENTED | `0038`, database test asserting no table lacks RLS |
| P2-026 | Separate sensitive tables for banking and credit | VERIFIED IMPLEMENTED | `supplier_bank_accounts`, `customer_credit_profiles`, 2 RLS denial tests |
| P2-027 | Banking data masked, access audited, never logged | VERIFIED IMPLEMENTED (service + audit) | `maskAccountNumber`, `supplier-banking.ts`, critical-severity audit |
| P2-028 | Master-data audit categories and enhanced banking/base-unit audit | VERIFIED IMPLEMENTED | `master_data.*` actions, `0030` event-category check, database test |
| P2-029 | Master Data workspace navigation and dashboard with real counts | IMPLEMENTED BUT NOT VERIFIED | 30 routes, `getMasterDataOverview` counts rows |
| P2-030 | Loading, empty, error and permission-denied states | IMPLEMENTED BUT NOT VERIFIED | `PermissionGuard`, `EmptyState`, `ErrorState`, `loading.tsx`, `error.tsx` |
| P2-031 | Unit, integration and end-to-end coverage | PARTIALLY IMPLEMENTED | 210 unit + 82 database tests pass; 106 end-to-end checks pass, but the authenticated journeys need a live project (§17) |
| P2-032 | Excluded workflows stay excluded | VERIFIED IMPLEMENTED | no requisition, quotation, PO, receipt, invoice, stock balance, valuation, transfer, dispatch or posting code exists; screens say so |

## 19. Outstanding items, stated plainly

1. **Authenticated verification** of every screen and service against a live Supabase project — the
   single largest gap, caused by the project cap, not by missing code.
2. **The 20 authenticated end-to-end journeys.** The unauthenticated surface is covered (106 checks);
   the journeys that create a supplier, move it through its lifecycle, import a CSV and review a
   duplicate need a seeded project.
3. **`applied_rate` provenance** (P2-011) cannot be demonstrated until a transaction records a rate.
4. **Merge operation** — deliberately absent; requires referential reconciliation and separate
   authorisation.
5. **Document file storage** — metadata tables exist and are used; no bucket is configured, so no
   upload control is shown.
