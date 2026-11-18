import { beforeAll, describe, expect, it } from "vitest";

import {
  actAsAuthenticated,
  actAsSuperuser,
  createTestDatabase,
  expectDbError,
  queryRows,
  seedUser,
  type TestDatabase,
  type SeededUser,
} from "../helpers/pglite";

/**
 * Procurement: schema, lifecycles, numbering, approval authority, receipt posting and boundaries.
 *
 * These tests run the real migrations against PGlite, so the triggers, functions and policies under
 * test are the ones that ship. What they cannot exercise: Supabase Auth itself, PostgREST, and true
 * multi-connection concurrency (PGlite is a single connection). The concurrency guarantee is tested
 * by *simulation* — a second posting after another posting has consumed the outstanding quantity —
 * and the row locking that provides it is visible in `post_goods_receipt`.
 */

let db: TestDatabase;
let buyer: SeededUser;
let approver: SeededUser;
let storekeeper: SeededUser;
let finance: SeededUser;

let departmentId: string;
let unitId: string;
let productId: string;
let supplierId: string;
let secondSupplierId: string;
let warehouseId: string;
let unverifiedSupplierId: string;

const TODAY = new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function asBuyer() {
  await actAsAuthenticated(db, buyer.id);
}
async function asApprover() {
  await actAsAuthenticated(db, approver.id);
}
/** Privileged session (migration owner) — used only to read state past RLS, never to bypass a rule. */
async function asSuperuser() {
  await actAsSuperuser(db);
}
async function asStorekeeper() {
  await actAsAuthenticated(db, storekeeper.id);
}
async function asFinance() {
  await actAsAuthenticated(db, finance.id);
}

/**
 * Moves a document from submitted to under review as the approving role.
 *
 * The lifecycle deliberately requires the *review* permission for that edge, so the test cannot skip
 * it by acting as the author.
 */
async function sendForReview(entity: "purchase_requisition" | "purchase_order" | "goods_receipt" | "supplier_advance", id: string) {
  // Receipts are reviewed by the receiving side; the other documents are reviewed by an approver.
  if (entity === "goods_receipt") await asBuyer();
  else await asApprover();
  const table =
    entity === "purchase_requisition" ? "purchase_requisitions"
      : entity === "purchase_order" ? "purchase_orders"
      : entity === "goods_receipt" ? "goods_receipts"
      : "supplier_advances";
  await db.query(`update public.${table} set status = 'under_review' where id = $1`, [id]);
}

beforeAll(async () => {
  db = await createTestDatabase();

  buyer = await seedUser(db, { email: "buyer@pluck.test", roleCodes: ["procurement_officer"] });
  approver = await seedUser(db, { email: "md@pluck.test", roleCodes: ["managing_director"] });
  storekeeper = await seedUser(db, { email: "store@pluck.test", roleCodes: ["storekeeper"] });
  finance = await seedUser(db, { email: "finance@pluck.test", roleCodes: ["finance_officer"] });

  departmentId = crypto.randomUUID();
  await db.query("insert into public.departments (id, name, code) values ($1, 'Procurement', 'PROC')", [
    departmentId,
  ]);
  await db.query("update public.employees set department_id = $1 where id = $2", [departmentId, buyer.employeeId]);
  await db.query("update public.employees set department_id = $1 where id = $2", [departmentId, approver.employeeId]);

  const units = await queryRows<{ id: string }>(
    db,
    "select id from public.units_of_measure where code = 'kg'",
  );
  unitId = units[0]!.id;

  const categoryId = crypto.randomUUID();
  await db.query("insert into public.product_categories (id, code, name) values ($1, 'grain', 'Grain')", [
    categoryId,
  ]);
  productId = crypto.randomUUID();
  await db.query(
    `insert into public.products (id, code, name, category_id, base_unit_id, product_type, status)
     values ($1, 'MAIZE-W', 'Maize white', $2, $3, 'raw_material', 'active')`,
    [productId, categoryId, unitId],
  );

  const supplierCategoryId = crypto.randomUUID();
  await db.query(
    "insert into public.supplier_categories (id, code, name) values ($1, 'grains', 'Grains')",
    [supplierCategoryId],
  );

  supplierId = crypto.randomUUID();
  await db.query(
    `insert into public.suppliers (id, legal_name, primary_category_id, status, verification_status)
     values ($1, 'Savannah Grains Ltd', $2, 'active', 'verified')`,
    [supplierId, supplierCategoryId],
  );
  secondSupplierId = crypto.randomUUID();
  await db.query(
    `insert into public.suppliers (id, legal_name, primary_category_id, status, verification_status)
     values ($1, 'Northern Farms Ltd', $2, 'active', 'verified')`,
    [secondSupplierId, supplierCategoryId],
  );
  unverifiedSupplierId = crypto.randomUUID();
  await db.query(
    `insert into public.suppliers (id, legal_name, primary_category_id, status, verification_status)
     values ($1, 'Unverified Traders', $2, 'draft', 'unverified')`,
    [unverifiedSupplierId, supplierCategoryId],
  );

  const siteId = crypto.randomUUID();
  await db.query(
    "insert into public.sites (id, site_code, name, country, site_type) values ($1, 'JOS', 'Jos plant', 'NG', 'factory')",
    [siteId],
  );
  warehouseId = crypto.randomUUID();
  await db.query(
    "insert into public.warehouses (id, warehouse_code, name, site_id) values ($1, 'WH-JOS', 'Jos main', $2)",
    [warehouseId, siteId],
  );

  // Approval authority is configuration, so the test configures it explicitly rather than relying on
  // a hard-coded limit. The managing director may approve purchase orders up to 50,000,000 NGN.
  await db.query(
    `insert into public.approval_authorities
       (employee_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, justification)
     values ($1, 'procurement', 'purchase_order', 'NGN', 0, 50000000, 'Test configuration for procurement approvals')`,
    [approver.employeeId],
  );
  await db.query(
    `insert into public.approval_authorities
       (employee_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, justification)
     values ($1, 'procurement', 'purchase_requisition', 'NGN', 0, 50000000, 'Test configuration for requisition approvals')`,
    [approver.employeeId],
  );
  await db.query(
    `insert into public.approval_authorities
       (employee_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, justification)
     values ($1, 'procurement', 'goods_receipt', 'NGN', 0, 50000000, 'Test configuration for receipt approvals')`,
    [approver.employeeId],
  );
  await db.query(
    `insert into public.approval_authorities
       (employee_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, justification)
     values ($1, 'procurement', 'supplier_advance', 'NGN', 0, 50000000, 'Test configuration for advance approvals')`,
    [approver.employeeId],
  );
  await db.query(
    `insert into public.approval_authorities
       (employee_id, module, transaction_type, currency_code, minimum_amount, maximum_amount, justification)
     values ($1, 'procurement', 'purchase_order_amendment', 'NGN', 0, 50000000, 'Test configuration for amendment approvals')`,
    [approver.employeeId],
  );
});

/** Creates a draft requisition with one line and returns its id. */
async function createRequisition(quantity = "10000"): Promise<string> {
  await asBuyer();
  const rows = await queryRows<{ id: string }>(
    db,
    `insert into public.purchase_requisitions
       (requesting_employee_id, department_id, requisition_date, required_delivery_date, purpose, priority, created_by)
     values ($1, $2, $3, $4, 'Maize for Q1 production', 'high', $5)
     returning id`,
    [buyer.employeeId, departmentId, TODAY, inDays(14), buyer.id],
  );
  const id = rows[0]!.id;
  await db.query(
    `insert into public.purchase_requisition_items
       (requisition_id, line_number, product_id, product_description, quantity, unit_id, estimated_unit_price)
     values ($1, 1, $2, 'Maize white', $3, $4, 450.00)`,
    [id, productId, quantity, unitId],
  );
  return id;
}

async function createIssuedOrder(options: { quantity?: string; price?: string } = {}): Promise<{
  orderId: string;
  itemId: string;
}> {
  const quantity = options.quantity ?? "10000";
  const price = options.price ?? "465";

  await asBuyer();
  const orders = await queryRows<{ id: string }>(
    db,
    `insert into public.purchase_orders
       (supplier_id, supplier_name_snapshot, order_date, expected_delivery_date, currency_code,
        delivery_warehouse_id, department_id, procurement_officer_employee_id, created_by)
     values ($1, 'Northern Farms Ltd', $2, $3, 'NGN', $4, $5, $6, $7)
     returning id`,
    [secondSupplierId, TODAY, inDays(10), warehouseId, departmentId, buyer.employeeId, buyer.id],
  );
  const orderId = orders[0]!.id;

  const items = await queryRows<{ id: string }>(
    db,
    `insert into public.purchase_order_items
       (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
        unit_id, unit_code_snapshot, quantity, unit_price)
     values ($1, 1, $2, 'MAIZE-W', 'Maize white', $3, 'kg', $4, $5)
     returning id`,
    [orderId, productId, unitId, quantity, price],
  );

  await db.query("update public.purchase_orders set status = 'submitted' where id = $1", [orderId]);
  await sendForReview("purchase_order", orderId);
  await db.query("select public.procurement_decide('purchase_order', $1, 'approve', 'Within budget')", [orderId]);
  await db.query("select public.procurement_decide('purchase_order', $1, 'issue', null)", [orderId]);

  return { orderId, itemId: items[0]!.id };
}

/**
 * Creates an approved goods receipt awaiting posting.
 * The receipt deliberately splits one delivery into accepted, rejected and quarantined quantities.
 */
async function createApprovedReceipt(
  orderId: string,
  itemId: string,
  quantities: { received: string; accepted: string; rejected: string; quarantined: string },
): Promise<string> {
  await asBuyer();
  const receipts = await queryRows<{ id: string }>(
    db,
    `insert into public.goods_receipts
       (purchase_order_id, supplier_id, warehouse_id, receipt_date, supplier_delivery_note_number,
        receiving_employee_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [orderId, secondSupplierId, warehouseId, TODAY, `DN-${crypto.randomUUID().slice(0, 8)}`,
      buyer.employeeId, buyer.id],
  );
  const id = receipts[0]!.id;

  await db.query(
    `insert into public.goods_receipt_items
       (goods_receipt_id, purchase_order_item_id, line_number, product_id, product_description,
        unit_id, unit_code_snapshot, ordered_quantity, received_quantity, accepted_quantity,
        rejected_quantity, quarantined_quantity, rejection_reason)
     values ($1, $2, 1, $3, 'Maize white', $4, 'kg', 0, $5, $6, $7, $8,
             case when $7::numeric > 0 then 'Damaged bags' else null end)`,
    [id, itemId, productId, unitId, quantities.received, quantities.accepted, quantities.rejected,
      quantities.quarantined],
  );

  await db.query("update public.goods_receipts set status = 'submitted' where id = $1", [id]);
  await sendForReview("goods_receipt", id);
  await asApprover();
  await db.query("select public.procurement_decide('goods_receipt', $1, 'approve', 'Counted and inspected')", [id]);

  return id;
}

describe("procurement schema", () => {
  it("creates every procurement table and protects them with RLS", async () => {
    const tables = await queryRows<{ table_name: string; row_security: string }>(
      db,
      `select c.relname as table_name, c.relrowsecurity::text as row_security
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (c.relname like 'purchase%' or c.relname like 'supplier_%' or c.relname like 'goods_%'
               or c.relname like 'procurement_%' or c.relname = 'notifications')`,
    );

    const names = tables.map((table) => table.table_name);
    for (const expected of [
      "purchase_requisitions",
      "purchase_requisition_items",
      "purchase_requisition_allocations",
      "supplier_quotation_requests",
      "supplier_quotations",
      "supplier_quotation_items",
      "supplier_quotation_comparisons",
      "supplier_quotation_selections",
      "purchase_orders",
      "purchase_order_items",
      "purchase_order_versions",
      "purchase_order_amendments",
      "goods_receipts",
      "goods_receipt_items",
      "goods_receipt_postings",
      "supplier_advances",
      "supplier_advance_payment_details",
      "supplier_reconciliations",
      "procurement_documents",
      "procurement_approvals",
      "procurement_status_history",
      "procurement_integration_outbox",
      "procurement_legacy_imports",
      "notifications",
    ]) {
      expect(names, expected).toContain(expected);
    }

    for (const table of tables) {
      expect(table.row_security, `${table.table_name} must have RLS enabled`).toBe("true");
    }
  });

  it("declares every procurement lifecycle edge it relies on", async () => {
    const rows = await queryRows<{ entity_type: string; from_status: string; to_status: string; required_permission: string | null }>(
      db,
      "select entity_type, from_status, to_status, required_permission from public.procurement_status_transitions",
    );

    const edges = new Set(rows.map((row) => `${row.entity_type}:${row.from_status}->${row.to_status}`));
    for (const edge of [
      "purchase_requisition:draft->submitted",
      "purchase_requisition:under_review->approved",
      "supplier_quotation:under_evaluation->selected",
      "purchase_order:under_review->approved",
      "purchase_order:approved->issued",
      "purchase_order:issued->partially_received",
      "purchase_order:partially_received->fully_received",
      "goods_receipt:under_review->approved",
      "goods_receipt:approved->posted",
      "supplier_advance:submitted->approved",
      "supplier_advance:paid->partially_applied",
    ]) {
      expect(edges, edge).toContain(edge);
    }

    // Every edge names the permission it needs, so no transition is permission-free by accident.
    for (const row of rows) {
      expect(row.required_permission, `${row.entity_type} ${row.from_status}->${row.to_status}`).toBeTruthy();
    }
  });

  it("numbers documents from configuration, not from a row count", async () => {
    const rows = await queryRows<{ reference: string }>(db, "select private.next_procurement_reference('purchase_order') as reference");
    expect(rows[0]!.reference).toMatch(/^PA-PO-\d{4}-\d{6}$/);

    // Deleting a document does not recycle its number, because the counter is not a count.
    const before = rows[0]!.reference;
    await asSuperuser();
    const config = await queryRows<{ prefix: string; padding: number; last_value: string }>(
      db,
      "select prefix, padding, last_value::text from public.procurement_numbering where entity = 'purchase_order'",
    );
    expect(config[0]!.prefix).toBe("PA-PO");
    expect(Number(config[0]!.last_value)).toBeGreaterThan(0);
    expect(before).toContain(config[0]!.prefix);
  });
});

describe("requisitions", () => {
  it("creates, submits and approves a requisition through the configured lifecycle", async () => {
    const id = await createRequisition();

    const draft = await queryRows<{ reference: string; status: string; estimated_total: string }>(
      db,
      "select reference, status, estimated_total from public.purchase_requisitions where id = $1",
      [id],
    );
    expect(draft[0]!.reference).toMatch(/^PA-REQ-\d{4}-\d{6}$/);
    expect(draft[0]!.status).toBe("draft");
    expect(Number(draft[0]!.estimated_total)).toBe(4_500_000);

    await db.query("update public.purchase_requisitions set status = 'submitted' where id = $1", [id]);
    await sendForReview("purchase_requisition", id);

    // Approval runs through the single execution path, which checks authority and records the decision.
    await asApprover();
    await db.query("select public.procurement_decide('purchase_requisition', $1, 'approve', 'Needed for the season')", [id]);

    await asSuperuser();
    const approved = await queryRows<{ status: string }>(
      db,
      "select status from public.purchase_requisitions where id = $1",
      [id],
    );
    expect(approved[0]!.status).toBe("approved");

    const history = await queryRows<{ from_status: string; to_status: string }>(
      db,
      "select from_status, to_status from public.procurement_status_history where entity_id = $1 order by created_at",
      [id],
    );
    expect(history.map((row) => `${row.from_status}->${row.to_status}`)).toEqual([
      "draft->submitted",
      "submitted->under_review",
      "under_review->approved",
    ]);

    const trail = await queryRows<{ decision: string; amount_at_decision: string; authority_id: string | null }>(
      db,
      "select decision, amount_at_decision, authority_id from public.procurement_approvals where entity_id = $1",
      [id],
    );
    expect(trail[0]!.decision).toBe("approved");
    expect(trail[0]!.authority_id).toBeTruthy();
  });

  it("refuses an undeclared status change", async () => {
    const id = await createRequisition();
    await asBuyer();
    const message = await expectDbError(
      db,
      "update public.purchase_requisitions set status = 'fulfilled' where id = $1",
      [id],
    );
    expect(message).toContain("Illegal purchase_requisition status transition");
  });

  it("refuses content edits once the requisition has left draft", async () => {
    const id = await createRequisition();
    await db.query("update public.purchase_requisitions set status = 'submitted' where id = $1", [id]);
    const message = await expectDbError(
      db,
      "update public.purchase_requisitions set purpose = 'Changed after submission' where id = $1",
      [id],
    );
    expect(message).toContain("cannot be edited");
  });

  it("refuses to submit a requisition with no lines", async () => {
    await asBuyer();
    const rows = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_requisitions
         (requesting_employee_id, department_id, requisition_date, required_delivery_date, purpose, created_by)
       values ($1, $2, $3, $4, 'No lines yet', $5) returning id`,
      [buyer.employeeId, departmentId, TODAY, inDays(7), buyer.id],
    );
    const message = await expectDbError(
      db,
      "update public.purchase_requisitions set status = 'submitted' where id = $1",
      [rows[0]!.id],
    );
    expect(message).toContain("at least one line");
  });
});

describe("quotations and supplier selection", () => {
  async function recordQuotation(requisitionId: string, supplier: string, price: string, lead: number) {
    await asBuyer();
    const rows = await queryRows<{ id: string }>(
      db,
      `insert into public.supplier_quotations
         (supplier_id, requisition_id, quotation_date, valid_until, currency_code, status,
          delivery_lead_time_days, delivery_charges, recorded_by, created_by)
       values ($1, $2, $3, $4, 'NGN', 'received', $5, 15000, $6, $6)
       returning id`,
      [supplier, requisitionId, TODAY, inDays(30), lead, buyer.id],
    );
    const id = rows[0]!.id;
    await db.query(
      `insert into public.supplier_quotation_items
         (quotation_id, line_number, product_id, product_description, quantity, unit_id, unit_price)
       values ($1, 1, $2, 'Maize white', 10000, $3, $4)`,
      [id, productId, unitId, price],
    );
    return id;
  }

  it("computes quotation totals from lines and disclosed charges", async () => {
    const requisitionId = await createRequisition();
    const quotationId = await recordQuotation(requisitionId, supplierId, "450", 7);

    await asSuperuser();
    const rows = await queryRows<{ subtotal: string; total_amount: string }>(
      db,
      "select subtotal, total_amount from public.supplier_quotations where id = $1",
      [quotationId],
    );
    // 10,000 kg × 450 = 4,500,000, plus 15,000 delivery.
    expect(Number(rows[0]!.subtotal)).toBe(4_500_000);
    expect(Number(rows[0]!.total_amount)).toBe(4_515_000);
  });

  it("records a selection with justification and never re-derives it from price", async () => {
    const requisitionId = await createRequisition();
    const cheap = await recordQuotation(requisitionId, supplierId, "450", 7);
    const dearer = await recordQuotation(requisitionId, secondSupplierId, "465", 3);

    await asSuperuser();
    const totals = await queryRows<{ id: string; total_amount: string }>(
      db,
      "select id, total_amount from public.supplier_quotations where id in ($1, $2)",
      [cheap, dearer],
    );
    const totalOf = (id: string) => Number(totals.find((row) => row.id === id)!.total_amount);

    await asBuyer();
    const comparison = await queryRows<{ id: string }>(
      db,
      `insert into public.supplier_quotation_comparisons (requisition_id, title, currency_note, created_by)
       values ($1, 'Maize sourcing comparison', 'All offers in NGN', $2) returning id`,
      [requisitionId, buyer.id],
    );
    const comparisonId = comparison[0]!.id;

    for (const quotationId of [cheap, dearer]) {
      await db.query(
        `insert into public.supplier_quotation_comparison_quotes
           (comparison_id, quotation_id, total_at_comparison, currency_code, lead_time_days_at_comparison)
         values ($1, $2, $3, 'NGN', 5)`,
        [comparisonId, quotationId, totalOf(quotationId)],
      );
    }

    const lowest = await queryRows<{ quotation_id: string }>(
      db,
      "select quotation_id from public.supplier_quotation_comparison_view where comparison_id = $1 and is_lowest_price",
      [comparisonId],
    );
    expect(lowest[0]!.quotation_id).toBe(cheap);

    // The higher offer is selected, on a recorded commercial reason.
    const selection = await queryRows<{ selected_was_lowest: boolean; lowest_price_quotation_id: string }>(
      db,
      `insert into public.supplier_quotation_selections
         (comparison_id, selected_quotation_id, selected_supplier_id, requisition_id, justification, decided_by)
       values ($1, $2, $3, $4, 'Three-day lead time protects the production start date', $5)
       returning selected_was_lowest, lowest_price_quotation_id`,
      [comparisonId, dearer, secondSupplierId, requisitionId, buyer.id],
    );
    expect(selection[0]!.selected_was_lowest).toBe(false);
    expect(selection[0]!.lowest_price_quotation_id).toBe(cheap);
  });

  it("refuses a selection for a quotation that was not compared", async () => {
    const requisitionId = await createRequisition();
    const compared = await recordQuotation(requisitionId, supplierId, "450", 7);
    const notCompared = await recordQuotation(requisitionId, secondSupplierId, "470", 9);

    await asSuperuser();
    const totals = await queryRows<{ id: string; total_amount: string }>(
      db,
      "select id, total_amount from public.supplier_quotations where id = $1",
      [compared],
    );
    await asBuyer();
    const comparison = await queryRows<{ id: string }>(
      db,
      `insert into public.supplier_quotation_comparisons (requisition_id, title, created_by)
       values ($1, 'Partial comparison', $2) returning id`,
      [requisitionId, buyer.id],
    );
    const comparisonId = comparison[0]!.id;
    await db.query(
      `insert into public.supplier_quotation_comparison_quotes (comparison_id, quotation_id, total_at_comparison, currency_code)
       values ($1, $2, $3, 'NGN')`,
      [comparisonId, compared, totals[0]!.total_amount],
    );

    const message = await expectDbError(
      db,
      `insert into public.supplier_quotation_selections
         (comparison_id, selected_quotation_id, selected_supplier_id, justification, decided_by)
       values ($1, $2, $3, 'Chosen for unrelated reasons entirely', $4)`,
      [comparisonId, notCompared, secondSupplierId, buyer.id],
    );
    expect(message).toContain("not part of this comparison");
  });

  it("requires a justification for a selection", async () => {
    const requisitionId = await createRequisition();
    const quotationId = await recordQuotation(requisitionId, supplierId, "450", 7);
    await asSuperuser();
    const totals = await queryRows<{ total_amount: string }>(
      db,
      "select total_amount from public.supplier_quotations where id = $1",
      [quotationId],
    );
    await asBuyer();
    const comparison = await queryRows<{ id: string }>(
      db,
      `insert into public.supplier_quotation_comparisons (requisition_id, title, created_by)
       values ($1, 'Single-option check', $2) returning id`,
      [requisitionId, buyer.id],
    );
    const comparisonId = comparison[0]!.id;
    await db.query(
      `insert into public.supplier_quotation_comparison_quotes (comparison_id, quotation_id, total_at_comparison, currency_code)
       values ($1, $2, $3, 'NGN')`,
      [comparisonId, quotationId, totals[0]!.total_amount],
    );

    const message = await expectDbError(
      db,
      `insert into public.supplier_quotation_selections
         (comparison_id, selected_quotation_id, selected_supplier_id, justification, decided_by)
       values ($1, $2, $3, 'short', $4)`,
      [comparisonId, quotationId, supplierId, buyer.id],
    );
    expect(message).toContain("at least 10 characters");
  });
});

describe("purchase orders", () => {
  it("refuses a purchase order for an unverified supplier until an exception exists", async () => {
    await asBuyer();
    const message = await expectDbError(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Unverified Traders', current_date, 'NGN', $2)`,
      [unverifiedSupplierId, buyer.id],
    );
    expect(message).toContain("cannot be ordered from");

    await asApprover();
    await db.query(
      `insert into public.procurement_supplier_exceptions (supplier_id, scope, justification, approved_by)
       values ($1, 'purchase_order', 'Emergency sourcing approved by management', $2)`,
      [unverifiedSupplierId, approver.id],
    );

    await asBuyer();
    const rows = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Unverified Traders', current_date, 'NGN', $2) returning id`,
      [unverifiedSupplierId, buyer.id],
    );
    expect(rows[0]!.id).toBeTruthy();
  });

  it("calculates line and document totals in NUMERIC, not floating point", async () => {
    await asBuyer();
    const orders = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Northern Farms Ltd', current_date, 'NGN', $2) returning id`,
      [supplierId, buyer.id],
    );
    const orderId = orders[0]!.id;

    await db.query(
      `insert into public.purchase_order_items
         (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
          unit_id, unit_code_snapshot, quantity, unit_price, discount_amount, additional_charges)
       values ($1, 1, $2, 'MAIZE-W', 'Maize white', $3, 'kg', 3333.333, 0.07, 1.11, 2.22)`,
      [orderId, productId, unitId],
    );

    const rows = await queryRows<{ subtotal: string; total_amount: string; discount_total: string; charges_total: string }>(
      db,
      "select subtotal, total_amount, discount_total, charges_total from public.purchase_orders where id = $1",
      [orderId],
    );
    // 3333.333 × 0.07 = 233.33331 → 233.33; − 1.11 + 2.22 = 234.44 exactly.
    expect(rows[0]!.subtotal).toBe("233.33");
    expect(rows[0]!.discount_total).toBe("1.11");
    expect(rows[0]!.charges_total).toBe("2.22");
    expect(rows[0]!.total_amount).toBe("234.44");
  });

  it("refuses an approval from a user without authority or permission", async () => {
    await asBuyer();
    const orders = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Savannah Grains Ltd', current_date, 'NGN', $2) returning id`,
      [supplierId, buyer.id],
    );
    const orderId = orders[0]!.id;
    await db.query(
      `insert into public.purchase_order_items
         (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
          unit_id, unit_code_snapshot, quantity, unit_price)
       values ($1, 1, $2, 'MAIZE-W', 'Maize white', $3, 'kg', 100, 500)`,
      [orderId, productId, unitId],
    );
    await db.query("update public.purchase_orders set status = 'submitted' where id = $1", [orderId]);
    await sendForReview("purchase_order", orderId);

    // The storekeeper holds goods_receipt permissions but no purchase-order approval permission.
    await asStorekeeper();
    const message = await expectDbError(db, "select public.procurement_decide('purchase_order', $1, 'approve', null)", [
      orderId,
    ]);
    expect(message).toContain("requires permission procurement.purchase_order.approve");

    await asSuperuser();
    const status = await queryRows<{ status: string }>(db, "select status from public.purchase_orders where id = $1", [
      orderId,
    ]);
    expect(status[0]!.status).toBe("under_review");
  });

  it("refuses self-approval even for an authorised user", async () => {
    // The managing director is recorded as the author of the order and then tries to approve it.
    await asBuyer();
    const orders = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Savannah Grains Ltd', current_date, 'NGN', $2) returning id`,
      [supplierId, buyer.id],
    );
    const orderId = orders[0]!.id;
    await asSuperuser();
    await db.query("update public.purchase_orders set created_by = $1 where id = $2", [approver.id, orderId]);
    await asBuyer();
    await db.query(
      `insert into public.purchase_order_items
         (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
          unit_id, unit_code_snapshot, quantity, unit_price)
       values ($1, 1, $2, 'MAIZE-W', 'Maize white', $3, 'kg', 10, 100)`,
      [orderId, productId, unitId],
    );
    await db.query("update public.purchase_orders set status = 'submitted' where id = $1", [orderId]);
    await sendForReview("purchase_order", orderId);

    const message = await expectDbError(db, "select public.procurement_decide('purchase_order', $1, 'approve', null)", [
      orderId,
    ]);
    expect(message).toContain("cannot approve");
  });

  it("refuses approval when no approval authority covers the amount", async () => {
    await asBuyer();
    const orders = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Savannah Grains Ltd', current_date, 'NGN', $2) returning id`,
      [supplierId, buyer.id],
    );
    const orderId = orders[0]!.id;
    // 2,000 tonnes at 60,000 = 120,000,000 NGN, well beyond the configured 50,000,000 ceiling.
    await db.query(
      `insert into public.purchase_order_items
         (purchase_order_id, line_number, product_id, product_code_snapshot, product_description,
          unit_id, unit_code_snapshot, quantity, unit_price)
       values ($1, 1, $2, 'MAIZE-W', 'Maize white', $3, 'kg', 2000000, 60000)`,
      [orderId, productId, unitId],
    );
    await db.query("update public.purchase_orders set status = 'submitted' where id = $1", [orderId]);
    await sendForReview("purchase_order", orderId);

    await asApprover();
    const message = await expectDbError(db, "select public.procurement_decide('purchase_order', $1, 'approve', null)", [
      orderId,
    ]);
    expect(message).toContain("no approval authority covering");

    const covers = await queryRows<{ covers: boolean }>(
      db,
      "select public.procurement_authority_covers('procurement', 'purchase_order', 120000000, 'NGN') as covers",
    );
    expect(covers[0]!.covers).toBe(false);
  });

  it("issues an approved order and freezes it, writing an immutable version", async () => {
    const { orderId } = await createIssuedOrder();

    await asSuperuser();
    const order = await queryRows<{ status: string; version: number; total_amount: string }>(
      db,
      "select status, version, total_amount from public.purchase_orders where id = $1",
      [orderId],
    );
    expect(order[0]!.status).toBe("issued");
    expect(order[0]!.version).toBe(1);
    expect(Number(order[0]!.total_amount)).toBe(4_650_000);

    const versions = await queryRows<{ version: number; total_amount: string; snapshot: unknown }>(
      db,
      "select version, total_amount, snapshot from public.purchase_order_versions where purchase_order_id = $1",
      [orderId],
    );
    expect(versions).toHaveLength(1);
    expect(Number(versions[0]!.total_amount)).toBe(4_650_000);
    expect(versions[0]!.snapshot).toBeTruthy();

    // The issued document is immutable.
    await asBuyer();
    const message = await expectDbError(
      db,
      "update public.purchase_orders set total_amount = 1 where id = $1",
      [orderId],
    );
    expect(message).toContain("cannot be edited");

    const lineMessage = await expectDbError(
      db,
      "update public.purchase_order_items set quantity = 1 where purchase_order_id = $1",
      [orderId],
    );
    expect(lineMessage).toContain("cannot be changed");
  });

  it("versions are write-protected so history cannot be rewritten", async () => {
    const { orderId } = await createIssuedOrder();
    await asSuperuser();
    const message = await expectDbError(
      db,
      "update public.purchase_order_versions set total_amount = 0 where purchase_order_id = $1",
      [orderId],
    );
    expect(message).toContain("immutable");
  });
});

describe("amendments", () => {
  it("applies an approved amendment, bumps the version and keeps both snapshots", async () => {
    const { orderId, itemId } = await createIssuedOrder();

    await asBuyer();
    const amendments = await queryRows<{ id: string; reference: string }>(
      db,
      `insert into public.purchase_order_amendments
         (purchase_order_id, reason, base_version, requested_by, requested_employee_id)
       values ($1, 'Supplier confirmed a larger available quantity', 1, $2, $3)
       returning id, reference`,
      [orderId, buyer.id, buyer.employeeId],
    );
    const amendmentId = amendments[0]!.id;
    expect(amendments[0]!.reference).toMatch(/^PA-AMD-/);

    await db.query(
      `insert into public.purchase_order_amendment_items
         (amendment_id, purchase_order_item_id, change_type, previous_value, new_value, quantity)
       values ($1, $2, 'quantity', '10000', '12000', 12000)`,
      [amendmentId, itemId],
    );
    await db.query("update public.purchase_order_amendments set status = 'submitted' where id = $1", [amendmentId]);

    await asApprover();
    await db.query("select public.procurement_decide('purchase_order_amendment', $1, 'approve', 'Approved increase')", [
      amendmentId,
    ]);
    await asBuyer();
    const applied = await queryRows<{ version: number; total_amount: string }>(
      db,
      "select version, total_amount from public.apply_purchase_order_amendment($1, false)",
      [amendmentId],
    );

    expect(applied[0]!.version).toBe(2);
    expect(Number(applied[0]!.total_amount)).toBe(5_580_000); // 12,000 × 465

    const versions = await queryRows<{ version: number; total_amount: string }>(
      db,
      "select version, total_amount from public.purchase_order_versions where purchase_order_id = $1 order by version",
      [orderId],
    );
    expect(versions.map((row) => Number(row.total_amount))).toEqual([4_650_000, 5_580_000]);

    const amendment = await queryRows<{ status: string; previous_total: string; new_total: string; resulting_version: number }>(
      db,
      "select status, previous_total, new_total, resulting_version from public.purchase_order_amendments where id = $1",
      [amendmentId],
    );
    expect(amendment[0]!.status).toBe("applied");
    expect(Number(amendment[0]!.previous_total)).toBe(4_650_000);
    expect(Number(amendment[0]!.new_total)).toBe(5_580_000);
    expect(amendment[0]!.resulting_version).toBe(2);
  });

  it("refuses to reduce a quantity below what has already been received", async () => {
    const { orderId, itemId } = await createIssuedOrder();
    const receiptId = await createApprovedReceipt(orderId, itemId, {
      received: "4000",
      accepted: "4000",
      rejected: "0",
      quarantined: "0",
    });
    await asStorekeeper();
    await db.query("select public.post_goods_receipt($1, $2, false)", [receiptId, "amend-guard-key-1"]);

    await asBuyer();
    const amendments = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_order_amendments (purchase_order_id, reason, base_version, requested_by, requested_employee_id)
       values ($1, 'Reduce the order to the quantity received', 1, $2, $3) returning id`,
      [orderId, buyer.id, buyer.employeeId],
    );
    const amendmentId = amendments[0]!.id;
    await db.query(
      `insert into public.purchase_order_amendment_items
         (amendment_id, purchase_order_item_id, change_type, previous_value, new_value, quantity)
       values ($1, $2, 'quantity', '10000', '3500', 3500)`,
      [amendmentId, itemId],
    );
    await db.query("update public.purchase_order_amendments set status = 'submitted' where id = $1", [amendmentId]);
    await asApprover();
    await db.query("select public.procurement_decide('purchase_order_amendment', $1, 'approve', 'Approved reduction')", [
      amendmentId,
    ]);
    await asBuyer();

    const message = await expectDbError(db, "select public.apply_purchase_order_amendment($1, false)", [amendmentId]);
    expect(message).toContain("needs explicit confirmation");
  });

  it("refuses to apply an amendment raised against an old version", async () => {
    const { orderId, itemId } = await createIssuedOrder();
    await asBuyer();
    const amendments = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_order_amendments (purchase_order_id, reason, base_version, requested_by, requested_employee_id)
       values ($1, 'Stale amendment against an old version', 1, $2, $3) returning id`,
      [orderId, buyer.id, buyer.employeeId],
    );
    const amendmentId = amendments[0]!.id;
    await db.query(
      `insert into public.purchase_order_amendment_items
         (amendment_id, purchase_order_item_id, change_type, previous_value, new_value, quantity)
       values ($1, $2, 'quantity', '10000', '11000', 11000)`,
      [amendmentId, itemId],
    );
    await db.query("update public.purchase_order_amendments set status = 'submitted' where id = $1", [amendmentId]);
    await asApprover();
    await db.query("select public.procurement_decide('purchase_order_amendment', $1, 'approve', 'First amendment approved')", [
      amendmentId,
    ]);
    await asBuyer();
    await db.query("select public.apply_purchase_order_amendment($1, false)", [amendmentId]);

    // A second amendment still claims base version 1.
    const second = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_order_amendments (purchase_order_id, reason, base_version, requested_by, requested_employee_id)
       values ($1, 'Second change built on the version in force', 1, $2, $3) returning id`,
      [orderId, buyer.id, buyer.employeeId],
    );
    await db.query(
      `insert into public.purchase_order_amendment_items
         (amendment_id, purchase_order_item_id, change_type, previous_value, new_value, quantity)
       values ($1, $2, 'quantity', '11000', '12500', 12500)`,
      [second[0]!.id, itemId],
    );
    await db.query("update public.purchase_order_amendments set status = 'submitted' where id = $1", [second[0]!.id]);
    await asApprover();
    await db.query("select public.procurement_decide('purchase_order_amendment', $1, 'approve', 'Approved second change')", [
      second[0]!.id,
    ]);
    await asBuyer();
    const message = await expectDbError(db, "select public.apply_purchase_order_amendment($1, false)", [second[0]!.id]);
    expect(message).toContain("Rebase the amendment");
  });
});

describe("goods receipts", () => {
  it("posts a partial delivery, splitting accepted, rejected and quarantined quantity", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "10000" });
    const receiptId = await createApprovedReceipt(orderId, itemId, {
      received: "4000",
      accepted: "3700",
      rejected: "200",
      quarantined: "100",
    });

    await asBuyer();
    const result = await queryRows<{ posting_reference: string; already_posted: boolean }>(
      db,
      "select posting_reference, already_posted from public.post_goods_receipt($1, $2, false)",
      [receiptId, "partial-post-key-1"],
    );
    expect(result[0]!.posting_reference).toMatch(/^PA-PST-/);
    expect(result[0]!.already_posted).toBe(false);

    await asSuperuser();
    const receipt = await queryRows<{ status: string; posting_reference: string; posted_at: string }>(
      db,
      "select status, posting_reference, posted_at from public.goods_receipts where id = $1",
      [receiptId],
    );
    expect(receipt[0]!.status).toBe("posted");
    expect(receipt[0]!.posted_at).toBeTruthy();

    const position = await queryRows<{
      ordered_quantity: string; received_quantity: string; accepted_quantity: string;
      rejected_quantity: string; quarantined_quantity: string; outstanding_quantity: string;
    }>(
      db,
      "select ordered_quantity, received_quantity, accepted_quantity, rejected_quantity, quarantined_quantity, outstanding_quantity from public.purchase_order_receipt_status where purchase_order_item_id = $1",
      [itemId],
    );
    expect(Number(position[0]!.received_quantity)).toBe(4000);
    expect(Number(position[0]!.accepted_quantity)).toBe(3700);
    expect(Number(position[0]!.rejected_quantity)).toBe(200);
    expect(Number(position[0]!.quarantined_quantity)).toBe(100);
    expect(Number(position[0]!.outstanding_quantity)).toBe(6000);

    const order = await queryRows<{ status: string }>(
      db,
      "select status from public.purchase_orders where id = $1",
      [orderId],
    );
    expect(order[0]!.status).toBe("partially_received");

    // Accepted is not rejected + quarantined; accepted stock is reported separately.
    const quality = await queryRows<{ indicator: string; record_count: number }>(
      db,
      "select indicator, record_count from public.procurement_data_quality where indicator in ('rejected_or_quarantined_reported_as_accepted', 'posted_without_outbox_event')",
    );
    expect(quality.every((row) => Number(row.record_count) === 0)).toBe(true);
  });

  it("emits exactly one durable inventory handoff event per posted receipt", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "500" });
    const receiptId = await createApprovedReceipt(orderId, itemId, {
      received: "500", accepted: "500", rejected: "0", quarantined: "0",
    });
    await asStorekeeper();
    await db.query("select public.post_goods_receipt($1, $2, false)", [receiptId, "outbox-key-1"]);

    await asSuperuser();
    const events = await queryRows<{ event_type: string; status: string; idempotency_key: string; payload: { items?: unknown[] } }>(
      db,
      "select event_type, status, idempotency_key, payload from public.procurement_integration_outbox where entity_id = $1",
      [receiptId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("procurement.goods_receipt.posted");
    // `pending` means no inventory consumer has recorded it: stock has not moved.
    expect(events[0]!.status).toBe("pending");
    expect(events[0]!.idempotency_key).toBe(`grn-posted:${receiptId}`);
    expect(Array.isArray(events[0]!.payload.items)).toBe(true);

    // Phase 4 now owns the inventory side of this handoff. Posting a receipt still moves no stock by
    // itself: the event stays `pending` until `inventory_consume_goods_receipt` consumes it, and until
    // then no lot exists for the receipt. That is the invariant this test has always protected.
    const lots = await queryRows<{ id: string }>(
      db,
      "select id from public.inventory_lots where goods_receipt_id = $1",
      [receiptId],
    );
    expect(lots).toHaveLength(0);

    const consumed = await queryRows<{ id: string }>(
      db,
      "select id from public.inventory_consume_goods_receipt($1)",
      [receiptId],
    );
    expect(consumed.length).toBeGreaterThan(0);

    const afterHandoff = await queryRows<{ status: string }>(
      db,
      "select status from public.procurement_integration_outbox where entity_id = $1",
      [receiptId],
    );
    expect(afterHandoff[0]!.status).toBe("consumed");
  });

  it("refuses a second posting of the same receipt and returns the original reference", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "100" });
    const receiptId = await createApprovedReceipt(orderId, itemId, {
      received: "100", accepted: "100", rejected: "0", quarantined: "0",
    });

    await asStorekeeper();
    const first = await queryRows<{ posting_reference: string; already_posted: boolean }>(
      db,
      "select posting_reference, already_posted from public.post_goods_receipt($1, $2, false)",
      [receiptId, "duplicate-key-1"],
    );
    const second = await queryRows<{ posting_reference: string; already_posted: boolean }>(
      db,
      "select posting_reference, already_posted from public.post_goods_receipt($1, $2, false)",
      [receiptId, "duplicate-key-2"],
    );

    expect(second[0]!.already_posted).toBe(true);
    expect(second[0]!.posting_reference).toBe(first[0]!.posting_reference);

    await asSuperuser();
    const postings = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.goods_receipt_postings where goods_receipt_id = $1",
      [receiptId],
    );
    expect(postings[0]!.count).toBe("1");

    const events = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.procurement_integration_outbox where entity_id = $1",
      [receiptId],
    );
    expect(events[0]!.count).toBe("1");
  });

  it("supports several receipts against one order and completes it when the balance arrives", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "1000" });

    const firstReceipt = await createApprovedReceipt(orderId, itemId, {
      received: "600", accepted: "600", rejected: "0", quarantined: "0",
    });
    await asStorekeeper();
    await db.query("select public.post_goods_receipt($1, $2, false)", [firstReceipt, "multi-key-1"]);

    const secondReceipt = await createApprovedReceipt(orderId, itemId, {
      received: "400", accepted: "400", rejected: "0", quarantined: "0",
    });
    await asStorekeeper();
    await db.query("select public.post_goods_receipt($1, $2, false)", [secondReceipt, "multi-key-2"]);

    await asSuperuser();
    const order = await queryRows<{ status: string }>(db, "select status from public.purchase_orders where id = $1", [orderId]);
    expect(order[0]!.status).toBe("fully_received");

    const position = await queryRows<{ received_quantity: string; outstanding_quantity: string }>(
      db,
      "select received_quantity, outstanding_quantity from public.purchase_order_receipt_status where purchase_order_item_id = $1",
      [itemId],
    );
    expect(Number(position[0]!.received_quantity)).toBe(1000);
    expect(Number(position[0]!.outstanding_quantity)).toBe(0);
  });

  it("prevents over-receipt, including a stale receipt that would double-consume the balance", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "1000" });
    const receiptId = await createApprovedReceipt(orderId, itemId, {
      received: "700", accepted: "700", rejected: "0", quarantined: "0",
    });

    // The receipt was validated while 1,000 was outstanding; then another receipt takes 600 of it.
    // Posting the stale 700 must not be allowed to consume the same quantity twice.
    const competitor = await createApprovedReceipt(orderId, itemId, {
      received: "600", accepted: "600", rejected: "0", quarantined: "0",
    });
    await asStorekeeper();
    await db.query("select public.post_goods_receipt($1, $2, false)", [competitor, "race-key-1"]);

    const message = await expectDbError(db, "select public.post_goods_receipt($1, $2, false)", [
      receiptId,
      "race-key-2",
    ]);
    expect(message).toContain("would over-receive");

    await asSuperuser();
    const postings = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.goods_receipt_postings where purchase_order_id = $1",
      [orderId],
    );
    expect(postings[0]!.count).toBe("1");
  });

  it("refuses to post a receipt that has not been approved", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "50" });
    await asBuyer();
    const receipts = await queryRows<{ id: string }>(
      db,
      `insert into public.goods_receipts (purchase_order_id, supplier_id, warehouse_id, receipt_date, created_by)
       values ($1, $2, $3, current_date, $4) returning id`,
      [orderId, secondSupplierId, warehouseId, buyer.id],
    );
    await db.query(
      `insert into public.goods_receipt_items
         (goods_receipt_id, purchase_order_item_id, line_number, product_id, product_description, unit_id,
          unit_code_snapshot, ordered_quantity, received_quantity, accepted_quantity)
       values ($1, $2, 1, $3, 'Maize white', $4, 'kg', 0, 50, 50)`,
      [receipts[0]!.id, itemId, productId, unitId],
    );

    const message = await expectDbError(db, "select public.post_goods_receipt($1, $2, false)", [
      receipts[0]!.id,
      "unapproved-key-1",
    ]);
    expect(message).toContain("Only an approved goods receipt can be posted");
  });

  it("refuses a quantity split that does not add up", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "100" });
    await asBuyer();
    const receipts = await queryRows<{ id: string }>(
      db,
      `insert into public.goods_receipts (purchase_order_id, supplier_id, warehouse_id, receipt_date, created_by)
       values ($1, $2, $3, current_date, $4) returning id`,
      [orderId, secondSupplierId, warehouseId, buyer.id],
    );
    const message = await expectDbError(
      db,
      `insert into public.goods_receipt_items
         (goods_receipt_id, purchase_order_item_id, line_number, product_id, product_description, unit_id,
          unit_code_snapshot, ordered_quantity, received_quantity, accepted_quantity, rejected_quantity,
          rejection_reason)
       values ($1, $2, 1, $3, 'Maize white', $4, 'kg', 0, 100, 90, 5, 'Torn bags')`,
      [receipts[0]!.id, itemId, productId, unitId],
    );
    expect(message).toContain("goods_receipt_items_split_matches");
  });

  it("refuses a duplicate supplier delivery note", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "100" });
    await asBuyer();
    const note = `DN-${crypto.randomUUID().slice(0, 6)}`;
    for (const attempt of [1, 2]) {
      const query = `insert into public.goods_receipts
          (purchase_order_id, supplier_id, warehouse_id, receipt_date, supplier_delivery_note_number, created_by)
        values ($1, $2, $3, current_date, $4, $5) returning id`;
      if (attempt === 1) {
        await db.query(query, [orderId, secondSupplierId, warehouseId, note, buyer.id]);
      } else {
        const message = await expectDbError(db, query, [orderId, secondSupplierId, warehouseId, note, buyer.id]);
        expect(message).toContain("goods_receipts_delivery_note_unique");
      }
    }
    void itemId;
  });
});

describe("supplier advances and supplier ledger", () => {
  async function createPaidAdvance(amount = "2000000"): Promise<string> {
    await asBuyer();
    const advances = await queryRows<{ id: string }>(
      db,
      `insert into public.supplier_advances
         (supplier_id, supplier_name_snapshot, transaction_date, amount, currency_code, purpose,
          payment_method, requested_by, requested_employee_id, created_by)
       values ($1, 'Northern Farms Ltd', current_date, $2, 'NGN', 'Advance to secure the maize allocation',
               'bank_transfer', $3, $4, $3)
       returning id`,
      [secondSupplierId, amount, buyer.id, buyer.employeeId],
    );
    const id = advances[0]!.id;
    await db.query("update public.supplier_advances set status = 'submitted' where id = $1", [id]);
    await asApprover();
    await db.query("select public.procurement_decide('supplier_advance', $1, 'approve', 'Approved for treasury')", [id]);
    await db.query("update public.supplier_advances set status = 'payment_pending' where id = $1", [id]);

    // Treasury confirmation is an explicit act with a reference, not a status flip.
    const message = await expectDbError(
      db,
      "update public.supplier_advances set status = 'paid' where id = $1",
      [id],
    );
    expect(message).toContain("treasury confirmation reference");

    await db.query(
      `update public.supplier_advances
          set status = 'paid', treasury_confirmed_by = $1, treasury_confirmed_at = now(),
              treasury_confirmation_reference = 'TRZ-0001'
        where id = $2`,
      [buyer.id, id],
    );
    return id;
  }

  it("tracks an advance, its confirmed applications and its outstanding balance", async () => {
    const advanceId = await createPaidAdvance("2000000");

    await asSuperuser();
    const before = await queryRows<{ status: string; outstanding_amount: string }>(
      db,
      "select status, outstanding_amount from public.supplier_advances where id = $1",
      [advanceId],
    );
    expect(before[0]!.status).toBe("paid");
    expect(Number(before[0]!.outstanding_amount)).toBe(2_000_000);

    await asApprover();
    await db.query(
      `insert into public.supplier_advance_applications
         (advance_id, target_type, target_reference, applied_amount, confirmation_status, confirmed_by, confirmed_at, created_by)
       values ($1, 'supplier_invoice', 'INV-77', 500000, 'confirmed', $2, now(), $2)`,
      [advanceId, approver.id],
    );

    const after = await queryRows<{ status: string; outstanding_amount: string }>(
      db,
      "select status, outstanding_amount from public.supplier_advances where id = $1",
      [advanceId],
    );
    expect(after[0]!.status).toBe("partially_applied");
    expect(Number(after[0]!.outstanding_amount)).toBe(1_500_000);

    const message = await expectDbError(
      db,
      `insert into public.supplier_advance_applications
         (advance_id, target_type, target_reference, applied_amount, confirmation_status, confirmed_by, confirmed_at)
       values ($1, 'supplier_invoice', 'INV-78', 9000000, 'confirmed', $2, now())`,
      [advanceId, approver.id],
    );
    expect(message).toContain("exceed the advance amount");
  });

  it("pending applications do not reduce the advance balance", async () => {
    const advanceId = await createPaidAdvance("1000000");
    await asApprover();
    await db.query(
      `insert into public.supplier_advance_applications
         (advance_id, target_type, target_reference, applied_amount, created_by)
       values ($1, 'supplier_invoice', 'INV-90', 400000, $2)`,
      [advanceId, approver.id],
    );
    await asSuperuser();
    const row = await queryRows<{ outstanding_amount: string; status: string }>(
      db,
      "select outstanding_amount, status from public.supplier_advances where id = $1",
      [advanceId],
    );
    expect(Number(row[0]!.outstanding_amount)).toBe(1_000_000);
    expect(row[0]!.status).toBe("paid");
  });

  it("shows the supplier position without pretending a purchase order is a payable", async () => {
    await asSuperuser();
    const rows = await queryRows<{
      ordered_amount: string;
      invoiced_amount: string;
      confirmed_payable: string | null;
      advance_balance: string;
    }>(
      db,
      "select ordered_amount, invoiced_amount, confirmed_payable, advance_balance from public.supplier_balances where supplier_id = $1",
      [secondSupplierId],
    );
    const position = rows[0]!;
    expect(Number(position.ordered_amount)).toBeGreaterThan(0);
    // No supplier invoice has been recorded through transaction references for this supplier, so the
    // payable balance is deliberately null rather than an invented figure.
    expect(Number(position.invoiced_amount)).toBe(0);
    expect(position.confirmed_payable).toBeNull();
  });

  it("records a supplier invoice reference and derives a payable only from it", async () => {
    await asFinance();
    await db.query(
      `insert into public.supplier_transaction_references
         (supplier_id, transaction_type, transaction_reference, transaction_date, amount, currency_code, source, created_by)
       values ($1, 'supplier_invoice', 'INV-2026-0001', current_date, 3000000, 'NGN', 'finance_import', $2)`,
      [secondSupplierId, approver.id],
    );

    await asSuperuser();
    const rows = await queryRows<{ invoiced_amount: string; confirmed_payable: string | null }>(
      db,
      "select invoiced_amount, confirmed_payable from public.supplier_balances where supplier_id = $1",
      [secondSupplierId],
    );
    expect(Number(rows[0]!.invoiced_amount)).toBe(3_000_000);
    // Payable = invoiced − paid (0 paid so far). Still not the ordered value.
    expect(Number(rows[0]!.confirmed_payable)).toBe(3_000_000);

    const message = await expectDbError(
      db,
      `insert into public.supplier_transaction_references
         (supplier_id, transaction_type, transaction_reference, transaction_date, amount, currency_code)
       values ($1, 'supplier_invoice', 'INV-2026-0001', current_date, 1, 'NGN')`,
      [secondSupplierId],
    );
    expect(message).toContain("supplier_transaction_references_unique");
  });

  it("builds a chronological supplier ledger linked to the original documents", async () => {
    await asSuperuser();
    const rows = await queryRows<{ activity_type: string; activity_id: string; activity_reference: string }>(
      db,
      "select activity_type, activity_id, activity_reference from public.supplier_ledger where supplier_id = $1 order by activity_date",
      [secondSupplierId],
    );
    const types = new Set(rows.map((row) => row.activity_type));
    expect(types.has("purchase_order")).toBe(true);
    expect(types.has("goods_receipt")).toBe(true);
    expect(types.has("supplier_advance")).toBe(true);
    for (const row of rows) {
      expect(row.activity_id).toBeTruthy();
      expect(row.activity_reference).toBeTruthy();
    }
  });
});

describe("sensitive procurement data", () => {
  it("hides advance payment details from a user without the payment permission", async () => {
    const advance = await queryRows<{ id: string }>(
      db,
      "select id from public.supplier_advances limit 1",
    );
    const advanceId = advance[0]!.id;

    await asSuperuser();
    await db.query(
      `insert into public.supplier_advance_payment_details
         (advance_id, paying_account_note, payment_reference, approved_amount, created_by)
       values ($1, 'Treasury operating account', 'TRF-99120', 2000000, $2)
       on conflict (advance_id) do nothing`,
      [advanceId, buyer.id],
    );

    // The procurement officer may record and read advances, but not their payment details.
    await asBuyer();
    const hidden = await queryRows<{ advance_id: string }>(
      db,
      "select advance_id from public.supplier_advance_payment_details where advance_id = $1",
      [advanceId],
    );
    expect(hidden).toHaveLength(0);

    // Finance holds the sensitive permission and sees the row.
    await asFinance();
    const visible = await queryRows<{ payment_reference: string }>(
      db,
      "select payment_reference from public.supplier_advance_payment_details where advance_id = $1",
      [advanceId],
    );
    expect(visible[0]?.payment_reference).toBe("TRF-99120");
  });

  it("restricts requisition visibility to the requester, the department and procurement staff", async () => {
    await asSuperuser();
    const requisition = await queryRows<{ id: string }>(
      db,
      "select id from public.purchase_requisitions where requesting_employee_id = $1 limit 1",
      [buyer.employeeId],
    );
    const requisitionId = requisition[0]!.id;

    await asStorekeeper();
    const outsiderRows = await queryRows<{ id: string }>(
      db,
      "select id from public.purchase_requisitions where id = $1",
      [requisitionId],
    );
    expect(outsiderRows).toHaveLength(0);

    await asBuyer();
    const ownRows = await queryRows<{ id: string }>(
      db,
      "select id from public.purchase_requisitions where id = $1",
      [requisitionId],
    );
    expect(ownRows).toHaveLength(1);
  });

  it("keeps the status trail and the approval trail append-only", async () => {
    await asSuperuser();
    const message = await expectDbError(
      db,
      "update public.procurement_status_history set to_status = 'draft' where to_status = 'approved'",
    );
    expect(message).toContain("append-only");

    const approvalMessage = await expectDbError(
      db,
      "delete from public.procurement_approvals where decision = 'approved'",
    );
    expect(approvalMessage).toContain("append-only");
  });

  it("gives a locked-out user no procurement rows at all", async () => {
    const inactive = await seedUser(db, {
      email: "left@pluck.test",
      roleCodes: ["procurement_officer"],
      accountStatus: "deactivated",
    });
    await actAsAuthenticated(db, inactive.id);
    const rows = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.purchase_orders",
    );
    expect(rows[0]!.count).toBe("0");

    const requisitions = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.purchase_requisitions",
    );
    expect(requisitions[0]!.count).toBe("0");
  });
});

describe("atomic document creation", () => {
  it("creates a requisition with its lines in one call, snapshotting the product name", async () => {
    await asBuyer();
    const created = await queryRows<{ id: string; reference: string }>(
      db,
      `select id, reference from public.procurement_create_requisition(
         $1, $2, current_date, current_date + 10, 'Two-line request for the mill', 'normal', 'NGN', $3::jsonb)`,
      [
        departmentId,
        buyer.employeeId,
        JSON.stringify([
          { product_id: productId, quantity: "1500", unit_id: unitId, estimated_unit_price: "460" },
          { product_id: productId, quantity: "2500.5", unit_id: unitId, estimated_unit_price: "458.75" },
        ]),
      ],
    );

    expect(created[0]!.reference).toMatch(/^PA-REQ-\d{4}-\d{6}$/);

    const lines = await queryRows<{ line_number: number; product_description: string; quantity: string }>(
      db,
      "select line_number, product_description, quantity::text from public.purchase_requisition_items where requisition_id = $1 order by line_number",
      [created[0]!.id],
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]!.product_description).toBe("Maize white");
    expect(Number(lines[1]!.quantity)).toBe(2500.5);
  });

  it("refuses a requisition with no lines and leaves nothing behind", async () => {
    await asBuyer();
    const before = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.purchase_requisitions",
    );
    const message = await expectDbError(
      db,
      `select public.procurement_create_requisition(
         $1, $2, current_date, current_date + 5, 'Empty request', 'normal', 'NGN', '[]'::jsonb)`,
      [departmentId, buyer.employeeId],
    );
    expect(message).toContain("at least one line");

    const after = await queryRows<{ count: string }>(
      db,
      "select count(*)::text from public.purchase_requisitions",
    );
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  it("creates an order that snapshots the supplier, unit, price and requisition allocation", async () => {
    const requisitionId = await createRequisition("4000");
    const requirement = await queryRows<{ id: string }>(
      db,
      "select id from public.purchase_requisition_items where requisition_id = $1",
      [requisitionId],
    );
    const requisitionItemId = requirement[0]!.id;

    await asBuyer();
    const created = await queryRows<{ id: string; reference: string }>(
      db,
      `select id, reference from public.procurement_create_purchase_order(
         $1, current_date, 'NGN', $2::jsonb,
         null, null, current_date + 7, null, null, null, null, null, $3, null, null, $4, $5, $6::uuid[], null, null)`,
      [
        secondSupplierId,
        JSON.stringify([
          {
            product_id: productId,
            quantity: "4000",
            unit_id: unitId,
            unit_price: "465",
            requisition_item_id: requisitionItemId,
          },
        ]),
        warehouseId,
        buyer.employeeId,
        departmentId,
        `{${requisitionId}}`,
      ],
    );

    expect(created[0]!.reference).toMatch(/^PA-PO-\d{4}-\d{6}$/);

    const order = await queryRows<{
      supplier_name_snapshot: string;
      total_amount: string;
      status: string;
      version: number;
    }>(
      db,
      "select supplier_name_snapshot, total_amount, status, version from public.purchase_orders where id = $1",
      [created[0]!.id],
    );
    expect(order[0]!.supplier_name_snapshot).toBe("Northern Farms Ltd");
    expect(order[0]!.status).toBe("draft");
    expect(Number(order[0]!.total_amount)).toBe(1_860_000);

    const line = await queryRows<{ product_code_snapshot: string; unit_code_snapshot: string }>(
      db,
      "select product_code_snapshot, unit_code_snapshot from public.purchase_order_items where purchase_order_id = $1",
      [created[0]!.id],
    );
    expect(line[0]!.product_code_snapshot).toBe("MAIZE-W");
    expect(line[0]!.unit_code_snapshot).toBe("kg");

    const allocation = await queryRows<{ allocated_quantity: string; purchase_order_item_id: string | null }>(
      db,
      "select allocated_quantity, purchase_order_item_id from public.purchase_requisition_allocations where requisition_item_id = $1",
      [requisitionItemId],
    );
    expect(Number(allocation[0]!.allocated_quantity)).toBe(4000);
    expect(allocation[0]!.purchase_order_item_id).toBeTruthy();

    const link = await queryRows<{ requisition_id: string }>(
      db,
      "select requisition_id from public.purchase_order_requisition_links where purchase_order_id = $1",
      [created[0]!.id],
    );
    expect(link).toHaveLength(1);
  });

  it("refuses a receipt line that belongs to a different order", async () => {
    const { orderId } = await createIssuedOrder({ quantity: "100" });
    const other = await createIssuedOrder({ quantity: "50" });

    await asStorekeeper();
    const message = await expectDbError(
      db,
      `select public.procurement_create_goods_receipt($1, $2, current_date, $3::jsonb)`,
      [
        orderId,
        warehouseId,
        JSON.stringify([{ purchase_order_item_id: other.itemId, received_quantity: "10", accepted_quantity: "10" }]),
      ],
    );
    expect(message).toContain("does not belong to this purchase order");
  });

  it("records the ordered and previously received quantity on the receipt line", async () => {
    const { orderId, itemId } = await createIssuedOrder({ quantity: "1000" });

    await asStorekeeper();
    const first = await queryRows<{ id: string; reference: string }>(
      db,
      `select id, reference from public.procurement_create_goods_receipt($1, $2, current_date, $3::jsonb, $4)`,
      [
        orderId,
        warehouseId,
        JSON.stringify([
          { purchase_order_item_id: itemId, received_quantity: "400", accepted_quantity: "400" },
        ]),
        "DN-ATOMIC-1",
      ],
    );
    expect(first[0]!.reference).toMatch(/^PA-GRN-\d{4}-\d{6}$/);

    const second = await queryRows<{ id: string }>(
      db,
      `select id from public.procurement_create_goods_receipt($1, $2, current_date, $3::jsonb, $4)`,
      [
        orderId,
        warehouseId,
        JSON.stringify([
          { purchase_order_item_id: itemId, received_quantity: "100", accepted_quantity: "100" },
        ]),
        "DN-ATOMIC-2",
      ],
    );

    const line = await queryRows<{ ordered_quantity: string; previously_received_quantity: string }>(
      db,
      "select ordered_quantity, previously_received_quantity from public.goods_receipt_items where goods_receipt_id = $1",
      [second[0]!.id],
    );
    expect(Number(line[0]!.ordered_quantity)).toBe(1000);
    // The first receipt is still a draft at this point, and the function counts approved/posted
    // quantities only, so the previously-received figure is honest about what has been accepted.
    expect(Number(line[0]!.previously_received_quantity)).toBe(0);
  });

  it("refuses to amend an order that has not been issued", async () => {
    await asBuyer();
    const orders = await queryRows<{ id: string }>(
      db,
      `insert into public.purchase_orders (supplier_id, supplier_name_snapshot, order_date, currency_code, created_by)
       values ($1, 'Savannah Grains Ltd', current_date, 'NGN', $2) returning id`,
      [supplierId, buyer.id],
    );
    const message = await expectDbError(
      db,
      "select public.procurement_create_amendment($1, 'Change the agreed quantity please', '[]'::jsonb)",
      [orders[0]!.id],
    );
    expect(message).toContain("Only an issued order can be amended");
  });
});

describe("procurement reporting", () => {
  it("exposes nineteen database-backed reports, all security_invoker", async () => {
    const views = await queryRows<{ relname: string; reloptions: string[] | null }>(
      db,
      `select c.relname, c.reloptions
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'report\_%'`,
    );
    expect(views).toHaveLength(19);

    for (const view of views) {
      expect(view.reloptions, `${view.relname} must respect the caller's RLS`).toContain("security_invoker=true");
    }

    // Every report view is readable by a user holding the reports permission.
    await asBuyer();
    for (const view of views) {
      const rows = await queryRows<{ count: string }>(db, `select count(*)::text from public.${view.relname}`);
      expect(rows[0]!.count, view.relname).toBeDefined();
    }
  });

  it("keeps each amount next to the currency it is denominated in", async () => {
    const columns = await queryRows<{ table_name: string; column_name: string }>(
      db,
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name like 'report\_%'
          and column_name in ('ordered_value', 'received_value', 'total_amount', 'amount', 'estimated_total')`,
    );
    for (const column of columns) {
      const currencies = await queryRows<{ column_name: string }>(
        db,
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name like '%currency%'`,
        [column.table_name],
      );
      expect(currencies.length, `${column.table_name}.${column.column_name} needs a currency column`).toBeGreaterThan(0);
    }
  });
});

describe("procurement data quality", () => {
  it("reports real indicators from real rows and stays security_invoker", async () => {
    const reloptions = await queryRows<{ reloptions: string[] }>(
      db,
      `select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'procurement_data_quality'`,
    );
    expect(reloptions[0]!.reloptions).toContain("security_invoker=true");

    await asSuperuser();
    const before = await queryRows<{ indicator: string; record_count: number }>(
      db,
      "select indicator, record_count from public.procurement_data_quality",
    );
    const baseline = Number(before.find((row) => row.indicator === "posted_without_outbox_event")!.record_count);

    // Explicitly remove an outbox event to create a real gap.
    await db.query(
      "delete from public.procurement_integration_outbox where entity_id in (select id from public.goods_receipts where status = 'posted' limit 1)",
    );
    const after = await queryRows<{ indicator: string; record_count: number }>(
      db,
      "select indicator, record_count from public.procurement_data_quality where indicator = 'posted_without_outbox_event'",
    );
    expect(Number(after[0]!.record_count)).toBe(baseline + 1);
  });
});
