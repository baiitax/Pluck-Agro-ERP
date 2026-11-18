import { beforeAll, describe, expect, it } from "vitest";

import { actAsSuperuser, createTestDatabase, expectDbError, queryRows, type TestDatabase } from "../helpers/pglite";

/**
 * Phase 4 permanent suite: the inventory ledger, transfers, restrictions and the production run.
 *
 * These tests exist because the behaviours they cover had only ever been proven by throwaway probe files
 * during construction. A probe proves a migration applies once; a test proves it keeps behaving that way.
 *
 * They run as superuser through PGlite, so they exercise constraints, triggers, functions and views — not the
 * RLS policies, which are covered by `rls.test.ts`. Nothing here stands in for an authenticated run against a
 * deployed Supabase project, and the suite says so rather than implying otherwise.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 300_000);

let seq = 0;

/**
 * Builds the master data this suite needs.
 *
 * Units of measure are seeded by the migrations; sites, warehouses, categories and products are not, because
 * they describe one company's operation. So each test that needs a warehouse creates one, in the same way the
 * procurement suite does, rather than depending on seed rows that are deliberately absent.
 */
async function fixture() {
  await actAsSuperuser(db);
  seq += 1;
  const [unit] = await queryRows<{ id: string }>(db, "select id from public.units_of_measure where code = 'kg'");
  if (!unit) throw new Error("Phase 4 tests need the seeded kilogram unit of measure");

  const categoryId = crypto.randomUUID();
  await queryRows(
    db,
    "insert into public.product_categories (id, code, name) values ($1, $2, 'Phase 4 category')",
    [categoryId, `p4_cat_${seq}`],
  );
  const siteId = crypto.randomUUID();
  await queryRows(
    db,
    "insert into public.sites (id, site_code, name, country, site_type) values ($1, $2, 'Jos plant', 'NG', 'factory')",
    [siteId, `JOS${seq}`],
  );
  const warehouses = [crypto.randomUUID(), crypto.randomUUID()];
  await queryRows(
    db,
    `insert into public.warehouses (id, warehouse_code, name, site_id) values ($1, $2, 'Main store', $5), ($3, $4, 'Overflow store', $5)`,
    [warehouses[0], `WH-A${seq}`, warehouses[1], `WH-B${seq}`, siteId],
  );

  const productId = crypto.randomUUID();
  await queryRows(
    db,
    `insert into public.products (id, code, name, category_id, base_unit_id, status)
     values ($1, $2, $3, $4, $5, 'active')`,
    [productId, `P4-${seq}`, `Phase 4 product ${seq}`, categoryId, unit.id],
  );
  const inputProductId = crypto.randomUUID();
  await queryRows(
    db,
    `insert into public.products (id, code, name, category_id, base_unit_id, status)
     values ($1, $2, $3, $4, $5, 'active')`,
    [inputProductId, `P4I-${seq}`, `Phase 4 input ${seq}`, categoryId, unit.id],
  );

  return {
    categoryId,
    unitId: unit.id,
    warehouseId: warehouses[0]!,
    otherWarehouseId: warehouses[1]!,
    productId,
    inputProductId,
  };
}

async function makeLot(args: {
  productId: string;
  unitId: string;
  warehouseId: string;
  quantity: number;
  key: string;
  expiryDate?: string | null;
  manufactureDate?: string | null;
  grade?: string | null;
}) {
  const [lot] = await queryRows<{ id: string; lot_reference: string }>(
    db,
    `insert into public.inventory_lots
       (lot_reference, product_id, unit_id, warehouse_id, source_type, received_date, manufacture_date, expiry_date, grade)
     values (private.next_inventory_reference('inventory_lot'), $1, $2, $3, 'opening_balance', current_date, $4, $5, $6)
     returning id, lot_reference`,
    [args.productId, args.unitId, args.warehouseId, args.manufactureDate ?? null, args.expiryDate ?? null, args.grade ?? null],
  );
  await queryRows(
    db,
    `insert into public.inventory_movements
       (lot_id, product_id, unit_id, warehouse_id, movement_type, direction, quantity, idempotency_key,
        source_module, source_type, movement_date)
     values ($1, $2, $3, $4, 'opening_balance', 'in', $5, $6, 'inventory', 'opening_balance', current_date)`,
    [lot!.id, args.productId, args.unitId, args.warehouseId, args.quantity, args.key],
  );
  return lot!;
}

describe("0061 stock transfers, end to end", () => {
  it("moves stock out of the source lot and into a new destination lot, once", async () => {
    const f = await fixture();
    const lot = await makeLot({
      productId: f.productId,
      unitId: f.unitId,
      warehouseId: f.warehouseId,
      quantity: 100,
      key: `tr-${seq}`,
      expiryDate: "2027-06-30",
      grade: "GR-I",
    });

    const [transfer] = await queryRows<{ id: string; reference: string }>(
      db,
      `insert into public.inventory_transfers
         (reference, from_warehouse_id, to_warehouse_id, transfer_reason, status)
       values (private.next_inventory_reference('inventory_transfer'), $1, $2, 'Rebalancing regional stock', 'draft')
       returning id, reference`,
      [f.warehouseId, f.otherWarehouseId],
    );
    await queryRows(
      db,
      `insert into public.inventory_transfer_items (transfer_id, line_number, lot_id, product_id, unit_id, quantity)
       values ($1, 1, $2, $3, $4, 40)`,
      [transfer!.id, lot.id, f.productId, f.unitId],
    );

    // Dispatching an unapproved transfer is refused: approval is what authorises stock to leave.
    await queryRows(db, "update public.inventory_transfers set status = 'submitted' where id = $1", [transfer!.id]);
    const early = await expectDbError(db, "select public.inventory_dispatch_transfer($1)", [transfer!.id]);
    expect(early).toMatch(/submitted|approved/);

    await queryRows(db, "update public.inventory_transfers set status = 'approved' where id = $1", [transfer!.id]);
    const dispatched = await queryRows<{ status: string }>(
      db,
      "select status from public.inventory_dispatch_transfer($1)",
      [transfer!.id],
    );
    expect(dispatched[0]!.status).toBe("dispatched");

    // The source lot lost the quantity; nothing is duplicated in transit.
    const source = await queryRows<{ on_hand_quantity: string }>(
      db,
      "select on_hand_quantity from public.inventory_lot_balances where lot_id = $1",
      [lot.id],
    );
    expect(Number(source[0]!.on_hand_quantity)).toBe(60);
    const inTransit = await queryRows<{ in_transit_quantity: string; to_warehouse_id: string }>(
      db,
      "select in_transit_quantity::text, to_warehouse_id from public.inventory_in_transit where transfer_id = $1",
      [transfer!.id],
    );
    expect(Number(inTransit[0]!.in_transit_quantity)).toBe(40);

    // Idempotent: dispatching twice does not move another 40.
    await queryRows(db, "select public.inventory_dispatch_transfer($1)", [transfer!.id]);
    const after = await queryRows<{ on_hand_quantity: string }>(
      db,
      "select on_hand_quantity from public.inventory_lot_balances where lot_id = $1",
      [lot.id],
    );
    expect(Number(after[0]!.on_hand_quantity)).toBe(60);

    const received = await queryRows<{ status: string }>(
      db,
      "select status from public.inventory_receive_transfer($1)",
      [transfer!.id],
    );
    expect(received[0]!.status).toBe("received");

    // The destination is a NEW lot that inherits provenance from the source lot.
    const [item] = await queryRows<{ destination_lot_id: string }>(
      db,
      "select destination_lot_id from public.inventory_transfer_items where transfer_id = $1",
      [transfer!.id],
    );
    expect(item!.destination_lot_id).not.toBe(lot.id);
    const [destLot] = await queryRows<{
      warehouse_id: string;
      expiry_date: string | null;
      grade: string | null;
      source_type: string;
    }>(
      db,
      "select warehouse_id, expiry_date::text, grade, source_type from public.inventory_lots where id = $1",
      [item!.destination_lot_id],
    );
    expect(destLot!.warehouse_id).toBe(f.otherWarehouseId);
    expect(destLot!.grade).toBe("GR-I");
    expect(destLot!.source_type).toBe("transfer_in");

    const destBalance = await queryRows<{ on_hand_quantity: string }>(
      db,
      "select on_hand_quantity from public.inventory_lot_balances where lot_id = $1",
      [item!.destination_lot_id],
    );
    expect(Number(destBalance[0]!.on_hand_quantity)).toBe(40);

    // Receiving twice is idempotent: it returns the received transfer and creates no second destination lot.
    const twice = await queryRows<{ status: string }>(db, "select status from public.inventory_receive_transfer($1)", [
      transfer!.id,
    ]);
    expect(twice[0]!.status).toBe("received");
    const [lotCount] = await queryRows<{ count: string }>(
      db,
      "select count(*)::text as count from public.inventory_lots where source_type = 'transfer_in' and source_id = $1",
      [transfer!.id],
    );
    expect(Number(lotCount!.count)).toBe(1);
  }, 300_000);

  it("refuses to dispatch a line the lot cannot cover", async () => {
    const f = await fixture();
    const lot = await makeLot({
      productId: f.productId,
      unitId: f.unitId,
      warehouseId: f.warehouseId,
      quantity: 10,
      key: `tr-short-${seq}`,
    });
    const [transfer] = await queryRows<{ id: string }>(
      db,
      `insert into public.inventory_transfers
         (reference, from_warehouse_id, to_warehouse_id, transfer_reason, status)
       values (private.next_inventory_reference('inventory_transfer'), $1, $2, 'Moving more than exists on purpose', 'draft')
       returning id`,
      [f.warehouseId, f.otherWarehouseId],
    );
    await queryRows(
      db,
      `insert into public.inventory_transfer_items (transfer_id, line_number, lot_id, product_id, unit_id, quantity)
       values ($1, 1, $2, $3, $4, 25)`,
      [transfer!.id, lot.id, f.productId, f.unitId],
    );
    await queryRows(db, "update public.inventory_transfers set status = 'submitted' where id = $1", [transfer!.id]);
    await queryRows(db, "update public.inventory_transfers set status = 'approved' where id = $1", [transfer!.id]);
    const message = await expectDbError(db, "select public.inventory_dispatch_transfer($1)", [transfer!.id]);
    expect(message).toMatch(/available/i);
  }, 300_000);
});

describe("0071/0072 reporting views", () => {
  it("derives availability, expiry exposure, holds and the movement register from posted rows", async () => {
    const f = await fixture();
    const lot = await makeLot({
      productId: f.productId,
      unitId: f.unitId,
      warehouseId: f.warehouseId,
      quantity: 100,
      key: `view-${seq}`,
      expiryDate: new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10),
      manufactureDate: "2026-10-01",
      grade: "GR-II",
    });

    await queryRows(
      db,
      `select public.inventory_apply_restriction($1, 30, 'quality_hold', 'quality', 'quality_hold', null, $2, 'Held pending laboratory result')`,
      [lot.id, `view-hold-${seq}`],
    );
    await queryRows(
      db,
      `select public.inventory_reserve_stock($1, 20, 'sales', 'sales_order', null, 'SO-P4-TEST', $2, 'Reserved for a customer order')`,
      [lot.id, `view-res-${seq}`],
    );

    // 0072: availability carries the provenance columns the lot page needs.
    const [availability] = await queryRows<{
      on_hand_quantity: string;
      restricted_quantity: string;
      reserved_quantity: string;
      available_quantity: string;
      received_date: string;
      manufacture_date: string;
      grade: string;
    }>(
      db,
      `select on_hand_quantity::text, restricted_quantity::text, reserved_quantity::text,
              available_quantity::text, received_date::text, manufacture_date::text, grade
         from public.inventory_availability where lot_id = $1`,
      [lot.id],
    );
    expect(Number(availability!.on_hand_quantity)).toBe(100);
    expect(Number(availability!.restricted_quantity)).toBe(30);
    expect(Number(availability!.reserved_quantity)).toBe(20);
    expect(Number(availability!.available_quantity)).toBe(50);
    expect(availability!.manufacture_date).toBe("2026-10-01");
    expect(availability!.grade).toBe("GR-II");

    // Stock summary sums the same definition rather than a second one.
    const [summary] = await queryRows<{ on_hand_quantity: string; available_quantity: string; lot_count: number }>(
      db,
      `select on_hand_quantity::text, available_quantity::text, lot_count
         from public.inventory_stock_summary
        where product_id = $1 and warehouse_id = $2`,
      [f.productId, f.warehouseId],
    );
    expect(Number(summary!.on_hand_quantity)).toBe(100);
    expect(Number(summary!.available_quantity)).toBe(50);
    expect(Number(summary!.lot_count)).toBeGreaterThanOrEqual(1);

    const expiry = await queryRows<{ lot_id: string; days_to_expiry: number }>(
      db,
      "select lot_id, days_to_expiry from public.inventory_expiring_lots where lot_id = $1",
      [lot.id],
    );
    expect(expiry).toHaveLength(1);
    expect(Number(expiry[0]!.days_to_expiry)).toBeGreaterThan(0);

    const holds = await queryRows<{ lot_id: string; restriction_type: string; reason_code: string | null }>(
      db,
      "select lot_id, restriction_type, reason_code from public.inventory_restriction_register where lot_id = $1",
      [lot.id],
    );
    expect(holds.length).toBeGreaterThanOrEqual(1);
    expect(holds[0]!.restriction_type).toBe("hold");
    expect(holds[0]!.reason_code).toBe("quality_hold");

    const reservations = await queryRows<{ lot_id: string; reserved_for_reference: string }>(
      db,
      "select lot_id, reserved_for_reference from public.inventory_reservation_register where lot_id = $1",
      [lot.id],
    );
    expect(reservations[0]!.reserved_for_reference).toBe("SO-P4-TEST");

    const movements = await queryRows<{ movement_type: string; direction: string; quantity: string }>(
      db,
      "select movement_type, direction, quantity::text from public.inventory_movement_register where lot_id = $1",
      [lot.id],
    );
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movement_type).toBe("opening_balance");
    expect(Number(movements[0]!.quantity)).toBe(100);

    // The ledger still balances after the restrictions and reservations, neither of which move stock.
    const [integrity] = await queryRows<Record<string, number>>(db, "select * from public.inventory_ledger_integrity");
    for (const value of Object.values(integrity!)) expect(Number(value)).toBe(0);
  }, 300_000);

  it("presents no valuation view, by design", async () => {
    const rows = await queryRows<{ count: string }>(
      db,
      `select count(*)::text as count from information_schema.views
        where table_schema = 'public' and table_name ilike '%valuation%'`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  }, 120_000);
});

describe("0067–0070 production, end to end", () => {
  it("scales declared inputs, runs a batch and reports the yield it recorded", async () => {
    const f = await fixture();

    // Configuration the company states: 2 units of input per 1 unit of output.
    await queryRows(
      db,
      `insert into public.production_product_inputs (product_id, input_product_id, unit_id, quantity, basis_quantity)
       values ($1, $2, $3, 2, 1)`,
      [f.productId, f.inputProductId, f.unitId],
    );
    const [stage] = await queryRows<{ id: string }>(
      db,
      `insert into public.production_stages (code, name, sequence) values ($1, 'Milling', 10) returning id`,
      [`MILL${seq}`],
    );
    await queryRows(
      db,
      `insert into public.production_product_processes (product_id, stage_id, sequence) values ($1, $2, 10)`,
      [f.productId, stage!.id],
    );

    const [plan] = await queryRows<{ id: string; reference: string }>(
      db,
      `insert into public.production_plans (reference, product_id, unit_id, warehouse_id, planned_quantity, planned_date)
       values (private.next_inventory_reference('production_plan'), $1, $2, $3, 50, current_date)
       returning id, reference`,
      [f.productId, f.unitId, f.warehouseId],
    );

    const applied = await queryRows<{ production_plan_apply_declared_inputs: number }>(
      db,
      "select public.production_plan_apply_declared_inputs($1)",
      [plan!.id],
    );
    expect(Number(applied[0]!.production_plan_apply_declared_inputs)).toBe(1);

    // 50 units planned × 2 per 1 = 100 units required. Arithmetic on a declared statement, not a forecast.
    const [material] = await queryRows<{ required_quantity: string; declared_quantity: string }>(
      db,
      "select required_quantity::text, declared_quantity::text from public.production_plan_materials where plan_id = $1",
      [plan!.id],
    );
    expect(Number(material!.required_quantity)).toBe(100);
    expect(Number(material!.declared_quantity)).toBe(2);

    await queryRows(db, "update public.production_plans set status = 'submitted' where id = $1", [plan!.id]);
    await queryRows(db, "update public.production_plans set status = 'approved' where id = $1", [plan!.id]);

    // A batch cannot start before approval.
    const [draftPlan] = await queryRows<{ id: string }>(
      db,
      `insert into public.production_plans (reference, product_id, unit_id, warehouse_id, planned_quantity, planned_date)
       values (private.next_inventory_reference('production_plan'), $1, $2, $3, 10, current_date) returning id`,
      [f.productId, f.unitId, f.warehouseId],
    );
    const blocked = await expectDbError(db, "select public.production_start_batch($1)", [draftPlan!.id]);
    expect(blocked).toMatch(/approved/i);

    const [batch] = await queryRows<{ id: string; reference: string }>(
      db,
      "select id, reference from public.production_start_batch($1)",
      [plan!.id],
    );
    expect(batch!.reference).toMatch(/^PA-BAT-/);

    const inputLot = await makeLot({
      productId: f.inputProductId,
      unitId: f.unitId,
      warehouseId: f.warehouseId,
      quantity: 500,
      key: `prod-in-${seq}`,
    });

    // Over-issue is refused and names the lot.
    const over = await expectDbError(db, "select public.production_issue_material($1, $2, 600)", [batch!.id, inputLot.id]);
    expect(over).toMatch(/available|Insufficient/i);

    await queryRows(db, "select public.production_issue_material($1, $2, 100)", [batch!.id, inputLot.id]);

    const [output] = await queryRows<{ lot_id: string; restriction_id: string | null }>(
      db,
      "select lot_id, restriction_id from public.production_record_output($1, 40, 'main')",
      [batch!.id],
    );
    expect(output!.restriction_id).not.toBeNull();

    // Output is on hand but not available: it is held pending inspection.
    const [outputAvailability] = await queryRows<{ on_hand_quantity: string; available_quantity: string }>(
      db,
      "select on_hand_quantity::text, available_quantity::text from public.inventory_availability where lot_id = $1",
      [output!.lot_id],
    );
    expect(Number(outputAvailability!.on_hand_quantity)).toBe(40);
    expect(Number(outputAvailability!.available_quantity)).toBe(0);

    // No yield rule is declared, so closing without a reason is refused.
    const noReason = await expectDbError(db, "select public.production_close_batch($1)", [batch!.id]);
    expect(noReason).toMatch(/reason/i);

    const [closed] = await queryRows<{
      status: string;
      recorded_yield_percent: string | null;
      recorded_yield_basis: string | null;
      within_declared_band: boolean | null;
    }>(
      db,
      `select status, recorded_yield_percent::text, recorded_yield_basis, within_declared_band
         from public.production_close_batch($1, 'No yield band has been declared for this product yet')`,
      [batch!.id],
    );
    expect(closed!.status).toBe("closed");
    expect(Number(closed!.recorded_yield_percent)).toBe(40);
    expect(closed!.recorded_yield_basis).toBe("same_unit");
    expect(closed!.within_declared_band).toBeNull();

    // The reporting views derive the same figures from the posted rows.
    const [progress] = await queryRows<{ produced_quantity: string; status: string }>(
      db,
      "select produced_quantity::text, status from public.production_plan_progress where id = $1",
      [plan!.id],
    );
    expect(Number(progress!.produced_quantity)).toBe(40);

    const consumption = await queryRows<{ consumed_quantity: string }>(
      db,
      "select consumed_quantity::text from public.production_material_consumption where batch_id = $1",
      [batch!.id],
    );
    expect(Number(consumption[0]!.consumed_quantity)).toBe(100);

    const yieldRows = await queryRows<{
      total_issued_quantity: string;
      total_output_quantity: string;
      average_recorded_yield_percent: string | null;
    }>(
      db,
      `select total_issued_quantity::text, total_output_quantity::text, average_recorded_yield_percent::text
         from public.production_yield_summary where product_id = $1`,
      [f.productId],
    );
    expect(yieldRows).toHaveLength(1);
    expect(Number(yieldRows[0]!.total_issued_quantity)).toBe(100);
    expect(Number(yieldRows[0]!.total_output_quantity)).toBe(40);
    expect(Number(yieldRows[0]!.average_recorded_yield_percent)).toBe(40);

    const [batchSummary] = await queryRows<{ status: string; issued_quantity: string }>(
      db,
      "select status, issued_quantity::text from public.production_batch_summary where id = $1",
      [batch!.id],
    );
    expect(batchSummary!.status).toBe("closed");
    expect(Number(batchSummary!.issued_quantity)).toBe(100);

    const [integrity] = await queryRows<Record<string, number>>(db, "select * from public.inventory_ledger_integrity");
    for (const value of Object.values(integrity!)) expect(Number(value)).toBe(0);
  }, 300_000);

  it("keeps configuration versioned: an approved plan's requirements do not follow a later routing change", async () => {
    const f = await fixture();
    await queryRows(
      db,
      `insert into public.production_product_inputs (product_id, input_product_id, unit_id, quantity, basis_quantity)
       values ($1, $2, $3, 3, 2)`,
      [f.productId, f.inputProductId, f.unitId],
    );
    const [plan] = await queryRows<{ id: string }>(
      db,
      `insert into public.production_plans (reference, product_id, unit_id, warehouse_id, planned_quantity, planned_date)
       values (private.next_inventory_reference('production_plan'), $1, $2, $3, 20, current_date) returning id`,
      [f.productId, f.unitId, f.warehouseId],
    );
    await queryRows(db, "select public.production_plan_apply_declared_inputs($1)", [plan!.id]);
    await queryRows(db, "update public.production_plans set status = 'submitted' where id = $1", [plan!.id]);
    await queryRows(db, "update public.production_plans set status = 'approved' where id = $1", [plan!.id]);

    // 20 planned × (3 per 2) = 30 required.
    const [before] = await queryRows<{ required_quantity: string }>(
      db,
      "select required_quantity::text from public.production_plan_materials where plan_id = $1",
      [plan!.id],
    );
    expect(Number(before!.required_quantity)).toBe(30);

    // The routing is revised afterwards. The approved plan keeps what was approved.
    await queryRows(db, "update public.production_product_inputs set quantity = 9 where product_id = $1", [f.productId]);
    const [after] = await queryRows<{ required_quantity: string }>(
      db,
      "select required_quantity::text from public.production_plan_materials where plan_id = $1",
      [plan!.id],
    );
    expect(Number(after!.required_quantity)).toBe(30);

    // Requirement lines are frozen once approved.
    const edit = await expectDbError(
      db,
      "update public.production_plan_materials set required_quantity = 1 where plan_id = $1",
      [plan!.id],
    );
    expect(edit).toMatch(/approved|fixed|frozen/i);
  }, 300_000);
});
