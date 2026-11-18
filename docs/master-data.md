# Master data — design reference

This is the reference a developer or a data steward needs in order to work on the master-data
workspace without re-deriving the decisions from the code.

## 1. The registers

| Register | Tables | Notes |
|---|---|---|
| Suppliers | `suppliers`, `supplier_categories`, `supplier_category_assignments`, `supplier_contacts`, `supplier_addresses`, `supplier_bank_accounts`, `supplier_documents`, `supplier_product_categories` | A supplier holds one *primary* category for reporting plus any number of assignments and approved product categories. Never restricted to one commodity. |
| Customers | `customers`, `customer_categories`, `customer_category_assignments`, `customer_contacts`, `customer_addresses`, `customer_credit_profiles`, `customer_documents` | Customer types cover importers, distributors, manufacturers, wholesalers, retailers, agents and domestic buyers. Credit lives in its own permissioned table. |
| Products | `product_categories`, `products`, `product_variants`, `product_specifications`, `product_packaging`, `product_attribute_definitions`, `product_attribute_values` | Categories are hierarchical; specifications and packaging are recorded facts, never defaults. |
| Measurement | `units_of_measure`, `unit_conversions` | One base unit per category; conversions are effective-dated and may be product-specific. |
| Locations | `sites`, `warehouses`, `warehouse_locations` | Structure only. No balances, valuations or movements in this phase. |
| Commercial references | `currencies`, `exchange_rates`, `payment_terms`, `delivery_terms`, `tax_categories` | Effective-dated where the fact can change over time. No tax rate is stored. |
| Governance | `master_data_change_history`, `master_data_duplicate_candidates`, `master_data_import_jobs`, `master_data_import_rows`, `legacy_record_references`, `master_data_quality_issues` (view) | |

## 2. Business references

`master_data_entities` holds one row per entity with `prefix`, `padding` and `last_value`. A
before-insert trigger calls `private.next_master_reference(entity)` and writes the reference; clients
never supply one. Changing a prefix or padding is a data change and applies to future records only —
existing references are never rewritten, because they are quoted on documents.

## 3. Status lifecycle

`master_data_status_transitions` declares every legal edge, the permission that edge requires, and
whether a reason is mandatory. `private.guard_master_status()` is installed on each master table and:

1. rejects an undeclared edge (`check_violation`);
2. rejects the move when the caller lacks the edge's permission (`insufficient_privilege`);
3. requires a reason of at least 10 characters **that differs from the stored reason** for edges
   configured as reason-required.

The user interface reads the same table, filtered by the caller's permissions, so a user is never
offered a move the database will reject.

## 4. Two trails, on purpose

- `master_data_change_history` — the field-level diff a data steward reads: which fields changed,
  from what to what, by whom.
- `audit_logs` — the governance record: category `master_data`, one of the
  `master_data.*` actions, severity, request correlation.

Neither replaces the other, and both are written by triggers so a change through any path is
recorded.

## 5. Decimal and conversion rules

Quantities, factors, rates, weights and limits are `NUMERIC` in the database and never a JavaScript
float in the application. `lib/uom/decimal.ts` implements fixed-point arithmetic on `BigInt`:
parse, add, subtract, multiply, divide at an explicit scale, compare, round half-up, format.
`format()` throws instead of dropping digits.

`lib/uom/convert.ts` is the only place a conversion happens. It refuses:

- a pair with no rule in force on the requested date;
- a cross-category standard rule (a bag is not a mass without knowing the product);
- a rule belonging to another product;
- an ambiguous pair where two rules apply.

Working scale is 12; a converted quantity is rounded to the target unit's configured precision, and
the rounding is explicit.

## 6. Sensitive data

| Data | Table | View permission | Manage permission | Audit severity |
|---|---|---|---|---|
| Supplier bank accounts | `supplier_bank_accounts` | `master_data.supplier_banking.view` | `master_data.supplier_banking.manage` | `warning`, `critical` when the account number changes |
| Customer credit | `customer_credit_profiles` | `master_data.customer_credit.view` | `master_data.customer_credit.manage` | `critical` |

Application rules: only the masked account number leaves the service (`maskAccountNumber` keeps the
last four digits); an account number is never written to a log or an audit entry; accounts are
deactivated, never hard-deleted; deletion requires a reason of at least 10 characters. Credit
recorded here does not authorise a credit sale, and the interface says so.

## 7. Duplicates

`lib/master-data/similarity.ts` normalises and scores candidate pairs against a 45/100 floor, with
weights: registration number 30, code 30, tax id 25, name 20, email 15, phone 12, bank account 10,
website 8. Scans only *write candidates*. A reviewer records a judgement; merging is a separate,
unimplemented operation because it needs referential reconciliation against history that does not
exist yet.

## 8. Imports

Parse → validate → stage → preview → confirm → execute. Every row is persisted with its verdict and
messages. `batch_key` (entity + file name + row count + content hash) is unique, which is what makes
a retried upload safe. Banking and credit columns are excluded from every template by design.

## 9. Data quality

`public.master_data_quality_issues` is a view (`security_invoker = true`) with one row per
indicator: `entity_type`, `indicator`, `description`, `severity`, `record_count`. The interface
counts it. Adding an indicator means adding a `union all` branch — not writing a scoring formula in
TypeScript.

## 10. Adding a new register

1. Write the migration: table, constraints, indexes, `select private.install_master_triggers(...)`.
2. Add the entity to `master_data_entities` if it needs a business reference.
3. Declare its transitions in `master_data_status_transitions` if it has a lifecycle.
4. Add permissions in `lib/permissions/definitions.ts`, then regenerate the seeds with
   `node scripts/generate-seed-sql.mjs` — never hand-edit `0040`/`0041`.
5. Write the RLS policies (select/write separated, sensitive tables behind their own code).
6. Write the service in `services/master-data/`, with `requirePermission` first and
   `recordMasterAudit` after the write.
7. Add the screen under `app/(dashboard)/master-data/`, guarded by the page-level helper and backed
   by the service.
8. Add a database test for the constraints and a unit test for any pure logic.
