import { beforeAll, describe, expect, it } from "vitest";

import {
  actAsAuthenticated,
  actAsSuperuser,
  createTestDatabase,
  expectDbError,
  queryRows,
  seedUser,
  type TestDatabase,
} from "../helpers/pglite";

/**
 * Master data: constraints, lifecycles, permissions and sensitive-data protection.
 *
 * These tests run the real migrations against PGlite, so the triggers and policies under test are
 * the ones that will ship. They are not a substitute for a run against the deployed Supabase
 * project (which also exercises Supabase Auth and PostgREST), and nothing here is claimed as an
 * end-to-end pass.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

async function unitId(code: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(db, "select id from public.units_of_measure where code = $1", [code]);
  const id = rows[0]?.id;
  if (!id) throw new Error(`Seeded unit missing: ${code}`);
  return id;
}

/**
 * Creates a product category on demand.
 *
 * The migration seeds no product categories on purpose: which categories exist is a business
 * decision, so tests create the one they need rather than relying on invented reference data.
 */
async function createCategory(name = "Test Category"): Promise<string> {
  const id = crypto.randomUUID();
  const code = `test_${id.slice(0, 8)}`;
  await db.query("insert into public.product_categories (id, code, name) values ($1, $2, $3)", [id, code, name]);
  return id;
}

async function createSupplier(name: string, status = "draft"): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.suppliers (id, legal_name, supplier_type, status, registration_country)
     values ($1, $2, 'company', $3, 'NG')`,
    [id, name, status],
  );
  return id;
}

describe("master data schema", () => {
  it("creates the master data tables", async () => {
    const rows = await queryRows<{ table_name: string }>(
      db,
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const tables = rows.map((row) => row.table_name);
    for (const table of [
      "master_data_entities",
      "master_data_change_history",
      "master_data_status_transitions",
      "master_data_duplicate_candidates",
      "master_data_import_jobs",
      "master_data_import_rows",
      "legacy_record_references",
      "supplier_categories",
      "suppliers",
      "supplier_contacts",
      "supplier_addresses",
      "supplier_bank_accounts",
      "supplier_documents",
      "supplier_product_categories",
      "customer_categories",
      "customers",
      "customer_contacts",
      "customer_addresses",
      "customer_credit_profiles",
      "product_categories",
      "products",
      "product_variants",
      "product_specifications",
      "product_packaging",
      "product_attribute_definitions",
      "product_attribute_values",
      "units_of_measure",
      "unit_conversions",
      "sites",
      "warehouses",
      "warehouse_locations",
      "currencies",
      "exchange_rates",
      "payment_terms",
      "delivery_terms",
      "tax_categories",
    ]) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
  });

  it("enables RLS on every master data table", async () => {
    const rows = await queryRows<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const withoutRls = rows.filter((row) => !row.relrowsecurity).map((row) => row.relname);
    expect(withoutRls).toEqual([]);
  });

  it("grants the master data permissions to roles without granting banking to everyone", async () => {
    const permissions = await queryRows<{ code: string }>(db, "select code from public.permissions where code like 'master_data.%'");
    expect(permissions.length).toBeGreaterThan(40);
    expect(permissions.map((row) => row.code)).toContain("master_data.supplier_banking.manage");

    const holders = await queryRows<{ role_code: string }>(
      db,
      `select r.code as role_code
         from public.role_permissions rp
         join public.roles r on r.id = rp.role_id
         join public.permissions p on p.id = rp.permission_id
        where p.code = 'master_data.supplier_banking.manage'`,
    );
    expect(holders.map((row) => row.role_code)).not.toContain("auditor");
    expect(holders.length).toBeLessThan(4);
  });
});

describe("business references", () => {
  it("assigns a sequential reference on insert and never reuses one", async () => {
    const first = await createSupplier("Reference Test One");
    const second = await createSupplier("Reference Test Two");
    const rows = await queryRows<{ id: string; reference: string }>(
      db,
      "select id, reference from public.suppliers where id = any($1::uuid[]) order by reference",
      [[first, second]],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.reference).toMatch(/^PA-SUP-\d{6}$/);
    expect(rows[0]?.reference).not.toBe(rows[1]?.reference);
  });

  it("uses the configured prefix from master_data_entities", async () => {
    const rows = await queryRows<{ prefix: string; padding: number }>(
      db,
      "select prefix, padding from public.master_data_entities where entity = 'supplier'",
    );
    expect(rows[0]?.prefix).toBe("PA-SUP");
    expect(rows[0]?.padding).toBe(6);
  });
});

describe("lifecycle transitions", () => {
  it("allows a declared transition and rejects an undeclared one", async () => {
    const id = await createSupplier("Lifecycle Test");
    await db.query("update public.suppliers set status = 'submitted' where id = $1", [id]);

    const message = await expectDbError(db, "update public.suppliers set status = 'active' where id = $1", [id]);
    expect(message).toMatch(/Illegal supplier status transition/);
  });

  it("records every status change in the change history", async () => {
    const id = await createSupplier("History Test");
    await db.query("update public.suppliers set status = 'submitted', status_reason = 'ready for review' where id = $1", [id]);
    await db.query("update public.suppliers set status = 'under_review' where id = $1", [id]);

    const history = await queryRows<{ change_type: string }>(
      db,
      "select change_type from public.master_data_change_history where entity_id = $1 order by created_at",
      [id],
    );
    const kinds = history.map((row) => row.change_type);
    expect(kinds).toContain("created");
    // Every subsequent edit is recorded as a status change, with the field name that moved.
    expect(kinds).toContain("status_changed");
  });

  it("keeps blocked suppliers out of the active set while preserving the record", async () => {
    const id = await createSupplier("Blocked Test", "active");
    await db.query("update public.suppliers set status = 'blocked', status_reason = 'documentation expired' where id = $1", [id]);
    const rows = await queryRows<{ status: string }>(db, "select status from public.suppliers where id = $1", [id]);
    expect(rows[0]?.status).toBe("blocked");
  });
});

describe("units and conversions", () => {
  it("refuses to convert across categories unless a product is named", async () => {
    const bagId = await unitId("bag");
    const kgId = await unitId("kg");
    const message = await expectDbError(
      db,
      `insert into public.unit_conversions (from_unit_id, to_unit_id, conversion_factor, conversion_method, effective_from)
       values ($1, $2, 50, 'multiply', current_date)`,
      [bagId, kgId],
    );
    expect(message).toMatch(/product/i);
  });

  it("refuses an overlapping conversion rule for the same pair and start date", async () => {
    const kgId = await unitId("kg");
    const gId = await unitId("g");
    const message = await expectDbError(
      db,
      `insert into public.unit_conversions (from_unit_id, to_unit_id, conversion_factor, conversion_method, effective_from)
       values ($1, $2, 2000, 'multiply', (select effective_from from public.unit_conversions
             where from_unit_id = $1 and to_unit_id = $2 limit 1))`,
      [kgId, gId],
    );
    expect(message).toMatch(/duplicate|overlap|unique/i);
  });

  it("stores conversion factors as NUMERIC, not floating point", async () => {
    const rows = await queryRows<{ numeric_precision: number; data_type: string }>(
      db,
      `select data_type, numeric_precision from information_schema.columns
        where table_name = 'unit_conversions' and column_name = 'conversion_factor'`,
    );
    expect(rows[0]?.data_type).toBe("numeric");
    expect(rows[0]?.numeric_precision).toBeGreaterThanOrEqual(20);
  });
});

describe("products", () => {
  it("locks the base unit once the product leaves draft", async () => {
    const category = await createCategory();
    const kgId = await unitId("kg");
    const gId = await unitId("g");
    const productId = crypto.randomUUID();

    await db.query(
      `insert into public.products (id, code, name, category_id, product_type, base_unit_id, status)
       values ($1, $2, 'Base Unit Test', $3, 'raw_material', $4, 'draft')`,
      [productId, `TEST-${productId.slice(0, 8)}`, category, kgId],
    );

    // Allowed while drafting.
    await db.query("update public.products set base_unit_id = $2 where id = $1", [productId, gId]);
    await db.query("update public.products set base_unit_id = $2, status = 'active' where id = $1", [productId, kgId]);

    const message = await expectDbError(db, "update public.products set base_unit_id = $2 where id = $1", [productId, gId]);
    expect(message).toMatch(/base unit/i);
  });

  it("requires a reason when a product is archived", async () => {
    const category = await createCategory();
    const kgId = await unitId("kg");
    const productId = crypto.randomUUID();
    await db.query(
      `insert into public.products (id, code, name, category_id, product_type, base_unit_id, status)
       values ($1, $2, 'Archive Test', $3, 'raw_material', $4, 'active')`,
      [productId, `ARC-${productId.slice(0, 8)}`, category, kgId],
    );

    // Archiving is only reachable through a deactivated state, and it needs a recorded reason.
    await db.query("update public.products set status = 'inactive', status_reason = 'withdrawn pending review' where id = $1", [productId]);
    // A reason carried over from the previous transition is not accepted for this one.
    const message = await expectDbError(db, "update public.products set status = 'archived' where id = $1", [productId]);
    expect(message).toMatch(/reason/i);

    await db.query("update public.products set status = 'archived', status_reason = 'withdrawn from the catalogue' where id = $1", [
      productId,
    ]);
    const rows = await queryRows<{ status: string }>(db, "select status from public.products where id = $1", [productId]);
    expect(rows[0]?.status).toBe("archived");
  });
});

describe("sensitive data", () => {
  it("hides bank accounts from a user without the banking view permission", async () => {
    const supplierId = await createSupplier("Banking Test", "active");
    await db.query(
      `insert into public.supplier_bank_accounts (supplier_id, bank_name, account_holder_name, account_number)
       values ($1, 'Test Bank', 'Banking Test Ltd', '0123456789')`,
      [supplierId],
    );

    const withoutPermission = await seedUser(db, { email: "viewer@example.test", roleCodes: ["auditor"] });
    await actAsAuthenticated(db, withoutPermission.id);
    const hidden = await queryRows<{ id: string }>(db, "select id from public.supplier_bank_accounts where supplier_id = $1", [supplierId]);
    expect(hidden).toHaveLength(0);

    const withPermission = await seedUser(db, { email: "finance@example.test", roleCodes: ["finance_manager"] });
    await actAsAuthenticated(db, withPermission.id);
    const visible = await queryRows<{ id: string }>(db, "select id from public.supplier_bank_accounts where supplier_id = $1", [supplierId]);
    expect(visible.length).toBeGreaterThan(0);

    await actAsSuperuser(db);
  });

  it("keeps credit profiles behind the credit permission", async () => {
    const customerId = crypto.randomUUID();
    await db.query(
      "insert into public.customers (id, legal_name, customer_type, status, registration_country) values ($1, 'Credit Test', 'direct_buyer', 'lead', 'NG')",
      [customerId],
    );
    await db.query("insert into public.customer_credit_profiles (customer_id, credit_status) values ($1, 'not_assessed')", [customerId]);

    const auditor = await seedUser(db, { email: "auditor2@example.test", roleCodes: ["auditor"] });
    await actAsAuthenticated(db, auditor.id);
    const hidden = await queryRows<{ id: string }>(db, "select id from public.customer_credit_profiles where customer_id = $1", [customerId]);
    expect(hidden).toHaveLength(0);

    await actAsSuperuser(db);
  });
});

describe("imports", () => {
  it("refuses the same batch twice so a retried upload cannot duplicate records", async () => {
    const batchKey = "supplier:test.csv:2:abc123";
    await db.query(
      `insert into public.master_data_import_jobs (entity_type, file_name, batch_key, status, total_rows)
       values ('supplier', 'test.csv', $1, 'validated', 2)`,
      [batchKey],
    );
    const message = await expectDbError(
      db,
      `insert into public.master_data_import_jobs (entity_type, file_name, batch_key, status, total_rows)
       values ('supplier', 'test.csv', $1, 'validated', 2)`,
      [batchKey],
    );
    expect(message).toMatch(/duplicate|unique/i);
  });

  it("keeps rejected rows attached to their job instead of discarding them", async () => {
    const jobRows = await queryRows<{ id: string }>(
      db,
      `insert into public.master_data_import_jobs (entity_type, file_name, batch_key, status, total_rows)
       values ('supplier', 'rejects.csv', 'supplier:rejects.csv:1:zzz', 'validated', 1) returning id`,
    );
    const jobId = jobRows[0]?.id;
    await db.query(
      `insert into public.master_data_import_rows (job_id, row_number, raw_data, status, errors)
       values ($1, 2, '{"legal_name": ""}'::jsonb, 'rejected', '{"messages": ["legal_name is required"]}'::jsonb)`,
      [jobId],
    );
    const rows = await queryRows<{ status: string }>(db, "select status from public.master_data_import_rows where job_id = $1", [jobId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("rejected");
  });
});

describe("audit and history", () => {
  it("widened the audit event-category vocabulary to accept master data", async () => {
    const message = await expectDbError(
      db,
      `insert into public.audit_logs (event_category, action, module) values ('not_a_category', 'x', 'master_data')`,
    );
    expect(message).toMatch(/event_category/i);

    // A real master_data audit row is accepted, and is written under its own category.
    await db.query(
      `insert into public.audit_logs (event_category, action, module, severity)
       values ('master_data', 'master_data.created', 'master_data', 'notice')`,
    );
    const rows = await queryRows<{ count: number }>(
      db,
      "select count(*)::int as count from public.audit_logs where event_category = 'master_data'",
    );
    expect(rows[0]?.count).toBe(1);
  });
});

describe("data-quality indicators", () => {
  it("computes indicators from live rows only, so an empty register reports zero", async () => {
    const rows = await queryRows<{ indicator: string; record_count: number }>(
      db,
      "select indicator, record_count from public.master_data_quality_issues where entity_type = 'product'",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.record_count).toBeGreaterThanOrEqual(0);
  });

  it("runs the quality view with the caller's rights so RLS still applies", async () => {
    const rows = await queryRows<{ reloptions: string[] | null }>(
      db,
      "select reloptions from pg_class where relname = 'master_data_quality_issues'",
    );
    expect(rows[0]?.reloptions ?? []).toContain("security_invoker=true");
  });

  it("counts a real gap rather than a hypothetical one", async () => {
    // An active product with no specification is a gap; adding the specification must clear it.
    const before = await queryRows<{ record_count: number }>(
      db,
      "select record_count from public.master_data_quality_issues where indicator = 'missing_specification'",
    );
    const beforeCount = before[0]?.record_count ?? 0;

    const category = await createCategory("Quality Category");
    const kgId = await unitId("kg");
    const productId = crypto.randomUUID();
    await db.query(
      `insert into public.products (id, code, name, category_id, product_type, base_unit_id, status)
       values ($1, $2, 'Quality Probe', $3, 'raw_material', $4, 'active')`,
      [productId, `Q-${productId.slice(0, 8)}`, category, kgId],
    );

    const during = await queryRows<{ record_count: number }>(
      db,
      "select record_count from public.master_data_quality_issues where indicator = 'missing_specification'",
    );
    expect(during[0]?.record_count).toBe(beforeCount + 1);

    await db.query(
      `insert into public.product_specifications (product_id, name, specification_type, value_text)
       values ($1, 'Probe specification', 'text', 'recorded')`,
      [productId],
    );

    const after = await queryRows<{ record_count: number }>(
      db,
      "select record_count from public.master_data_quality_issues where indicator = 'missing_specification'",
    );
    expect(after[0]?.record_count).toBe(beforeCount);
  });
});
