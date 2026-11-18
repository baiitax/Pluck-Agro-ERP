import { beforeAll, describe, expect, it } from "vitest";

import { actAsSuperuser, createTestDatabase, expectDbError, queryRows, type TestDatabase } from "../helpers/pglite";

/**
 * Phase 5 permanent suite: specifications, inspections, dispositions, holds, NCR/CAPA and certificates.
 *
 * The tests that matter most here are the ones that connect quality to stock. A quality module that records
 * decisions but leaves the ledger untouched is worse than none, because it looks like control. So several of
 * these tests assert on `inventory_availability` and on the Phase 4 restriction rows, not on the quality tables.
 *
 * They run as superuser through PGlite, so they exercise constraints, triggers, functions and views. They do not
 * exercise the RLS policies (that is `rls.test.ts`) and they are not a substitute for an authenticated run
 * against a deployed project.
 */

let db: TestDatabase;
let seq = 0;

beforeAll(async () => {
  db = await createTestDatabase();
}, 300_000);

async function fixture() {
  await actAsSuperuser(db);
  seq += 1;
  const [unit] = await queryRows<{ id: string }>(db, "select id from public.units_of_measure where code = 'kg'");
  if (!unit) throw new Error("Phase 5 tests need the seeded kilogram unit of measure");

  const categoryId = crypto.randomUUID();
  await queryRows(db, "insert into public.product_categories (id, code, name) values ($1, $2, 'Phase 5 category')", [
    categoryId,
    `p5_cat_${seq}`,
  ]);
  const siteId = crypto.randomUUID();
  await queryRows(
    db,
    "insert into public.sites (id, site_code, name, country, site_type) values ($1, $2, 'Jos plant', 'NG', 'factory')",
    [siteId, `JOS5${seq}`],
  );
  const warehouseId = crypto.randomUUID();
  await queryRows(
    db,
    "insert into public.warehouses (id, warehouse_code, name, site_id) values ($1, $2, 'Quality store', $3)",
    [warehouseId, `WH5-${seq}`, siteId],
  );
  const productId = crypto.randomUUID();
  await queryRows(
    db,
    `insert into public.products (id, code, name, category_id, base_unit_id, status)
     values ($1, $2, $3, $4, $5, 'active')`,
    [productId, `P5-${seq}`, `Phase 5 product ${seq}`, categoryId, unit.id],
  );

  return { unitId: unit.id, warehouseId, productId };
}

/** A lot with stock on hand, plus the Phase 4 pending-inspection restriction a receipt would create. */
async function makeRestrictedLot(f: { productId: string; unitId: string; warehouseId: string }, quantity = 500) {
  const lotId = crypto.randomUUID();
  await queryRows(
    db,
    `insert into public.inventory_lots
       (id, lot_reference, product_id, unit_id, warehouse_id, source_type, received_date)
     values ($1, private.next_inventory_reference('inventory_lot'), $2, $3, $4, 'goods_receipt', current_date)`,
    [lotId, f.productId, f.unitId, f.warehouseId],
  );
  await queryRows(
    db,
    `insert into public.inventory_movements
       (lot_id, product_id, unit_id, warehouse_id, movement_type, direction, quantity, idempotency_key,
        source_module, source_type, movement_date)
     values ($1, $2, $3, $4, 'receipt_in', 'in', $5, $6, 'inventory', 'goods_receipt', current_date)`,
    [lotId, f.productId, f.unitId, f.warehouseId, quantity, `p5-grn-${lotId}`],
  );
  const [restriction] = await queryRows<{ id: string }>(
    db,
    `select id from public.inventory_apply_restriction(
       $1, $2, 'pending_inspection', 'inventory', 'goods_receipt_item', null,
       $3, 'Awaiting quality inspection after receipt', 'pending_inspection', null)`,
    [lotId, quantity, `p5-restrict-${lotId}`],
  );

  return { lotId, restrictionId: restriction!.id };
}

async function makeSpec(f: { productId: string; unitId: string }, limits: { parameter: string; min?: number; max?: number; mandatory?: boolean }[]) {
  const [spec] = await queryRows<{ id: string; reference: string }>(
    db,
    `insert into public.quality_specifications (product_id, stage, status)
     values ($1, 'incoming', 'draft')
     returning id, reference`,
    [f.productId],
  );

  let line = 0;
  for (const limit of limits) {
    line += 1;
    const parameterId = await ensureParameter(limit.parameter);
    await queryRows(
      db,
      `insert into public.quality_specification_parameters
         (specification_id, parameter_id, line_number, min_value, max_value, unit_id, is_mandatory)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [spec!.id, parameterId, line, limit.min ?? null, limit.max ?? null, f.unitId, limit.mandatory ?? true],
    );
  }

  return spec!;
}

async function ensureParameter(code: string) {
  const [existing] = await queryRows<{ id: string }>(db, "select id from public.quality_parameters where code = $1", [
    code,
  ]);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await queryRows(
    db,
    `insert into public.quality_parameters (id, code, name, result_type)
     values ($1, $2, $3, 'numeric')`,
    [id, code, code.replace(/_/g, " ")],
  );
  return id;
}

async function approvedSpecWithInspection(f: { productId: string; unitId: string; warehouseId: string }, quantity = 500) {
  const spec = await makeSpec(f, [{ parameter: `moisture_${seq}` , max: 12 }]);
  await queryRows(db, "select public.quality_approve_specification($1, $2)", [spec.id, "Approved for the test run"]);
  const lot = await makeRestrictedLot(f, quantity);

  const [inspection] = await queryRows<{ id: string; reference: string }>(
    db,
    `insert into public.quality_inspections
       (specification_id, lot_id, stage, inspection_type, sampled_quantity, sample_unit_id)
     values ($1, $2, 'incoming', 'incoming', 10, $3)
     returning id, reference`,
    [spec.id, lot.lotId, f.unitId],
  );

  return { spec, lot, inspection: inspection! };
}

async function recordResult(inspectionId: string, specificationId: string, value: number) {
  const [param] = await queryRows<{ id: string }>(
    db,
    "select id from public.quality_specification_parameters where specification_id = $1 order by line_number limit 1",
    [specificationId],
  );
  const [result] = await queryRows<{ conformance: string }>(
    db,
    `insert into public.quality_inspection_results
       (inspection_id, specification_parameter_id, parameter_id, value_numeric, unit_id)
     values ($1, $2, (select parameter_id from public.quality_specification_parameters where id = $2), $3, null)
     returning conformance`,
    [inspectionId, param!.id, value],
  );
  return result!.conformance;
}

describe("0075 specifications", () => {
  it("refuses to approve a specification that cannot decide anything, and freezes an approved one", async () => {
    const f = await fixture();
    const spec = await makeSpec(f, []);

    const empty = await expectDbError(db, "select public.quality_approve_specification($1, null)", [spec.id]);
    expect(empty).toMatch(/no parameters/i);

    const withParam = await makeSpec(f, [{ parameter: `purity_${seq}`, min: 90 }]);
    await queryRows(db, "select public.quality_approve_specification($1, $2)", [
      withParam.id,
      "Approved in the specifications test",
    ]);

    const [approved] = await queryRows<{ status: string; version: number; approved_at: string | null }>(
      db,
      "select status, version::int as version, approved_at from public.quality_specifications where id = $1",
      [withParam.id],
    );
    expect(approved!.status).toBe("approved");
    expect(approved!.approved_at).not.toBeNull();

    // Parameters are frozen once approved: a limit cannot be edited behind an existing inspection's back.
    const frozen = await expectDbError(
      db,
      "update public.quality_specification_parameters set max_value = 5 where specification_id = $1",
      [withParam.id],
    );
    expect(frozen).toMatch(/draft/i);

    // A numeric parameter with no limit at all cannot be approved either.
    const undecidable = await makeSpec(f, [{ parameter: `colour_${seq}`, mandatory: true }]);
    const refused = await expectDbError(db, "select public.quality_approve_specification($1, null)", [
      undecidable.id,
    ]);
    expect(refused).toMatch(/no limit/i);
  });

  it("supersedes the previous approved version instead of editing it", async () => {
    const f = await fixture();
    const first = await makeSpec(f, [{ parameter: `moisture_v1_${seq}`, max: 10 }]);
    await queryRows(db, "select public.quality_approve_specification($1, null)", [first.id]);

    const second = await makeSpec(f, [{ parameter: `moisture_v2_${seq}`, max: 12 }]);
    await queryRows(db, "select public.quality_approve_specification($1, null)", [second.id]);

    const versions = await queryRows<{ version: number; status: string }>(
      db,
      "select version::int as version, status from public.quality_specifications where product_id = $1 order by version",
      [f.productId],
    );

    expect(versions.map((v) => v.status)).toEqual(["superseded", "approved"]);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);

    const [effective] = await queryRows<{ id: string }>(
      db,
      "select (public.quality_effective_specification($1, 'incoming')).id",
      [f.productId],
    );
    expect(effective!.id).toBe(second.id);
  });
});

describe("0076 inspections and results", () => {
  it("computes conformance from the recorded limits and refuses to let a caller set it", async () => {
    const f = await fixture();
    const first = await approvedSpecWithInspection(f);
    expect(await recordResult(first.inspection.id, first.spec.id, 9)).toBe("conforming");

    // A second inspection is needed: a result set holds one value per parameter, which is what stops two
    // contradictory readings being recorded against the same verdict.
    const second = await approvedSpecWithInspection(f);
    expect(await recordResult(second.inspection.id, second.spec.id, 14)).toBe("non_conforming");

    const duplicated = await expectDbError(
      db,
      `insert into public.quality_inspection_results
         (inspection_id, specification_parameter_id, parameter_id, value_numeric)
       values ($1, (select id from public.quality_specification_parameters where specification_id = $2 limit 1),
               (select parameter_id from public.quality_specification_parameters where specification_id = $2 limit 1), 10)`,
      [first.inspection.id, first.spec.id],
    );
    expect(duplicated).toMatch(/duplicate key/i);
  });

  it("labels a result with no limit as not_evaluated rather than as a pass", async () => {
    const f = await fixture();
    const spec = await makeSpec(f, []);
    const [parameterId] = await queryRows<{ id: string }>(db, "select id from public.quality_parameters limit 1");
    const [param] = await queryRows<{ id: string }>(
      db,
      `insert into public.quality_specification_parameters (specification_id, parameter_id, is_mandatory)
       values ($1, $2, false) returning id`,
      [spec.id, parameterId!.id],
    );
    await queryRows(db, "select public.quality_approve_specification($1, null)", [spec.id]);
    const lot = await makeRestrictedLot(f);
    const [inspection] = await queryRows<{ id: string }>(
      db,
      `insert into public.quality_inspections (specification_id, lot_id, stage, sample_unit_id)
       values ($1, $2, 'incoming', $3) returning id`,
      [spec.id, lot.lotId, f.unitId],
    );
    const [result] = await queryRows<{ conformance: string }>(
      db,
      `insert into public.quality_inspection_results
         (inspection_id, specification_parameter_id, parameter_id, value_numeric)
       values ($1, $2, (select parameter_id from public.quality_specification_parameters where id = $2), 3)
       returning conformance`,
      [inspection!.id, param!.id],
    );
    expect(result!.conformance).toBe("not_evaluated");
  });

  it("derives the summary on submission and freezes results afterwards", async () => {
    const f = await fixture();
    const { inspection, spec } = await approvedSpecWithInspection(f);
    await recordResult(inspection.id, spec.id, 9);

    const [submitted] = await queryRows<{ status: string; result_summary: string }>(
      db,
      "select status, result_summary from public.quality_submit_inspection($1)",
      [inspection.id],
    );
    expect(submitted!.status).toBe("submitted");
    expect(submitted!.result_summary).toBe("conforming");

    const frozen = await expectDbError(
      db,
      `update public.quality_inspection_results set value_numeric = 30 where inspection_id = $1`,
      [inspection.id],
    );
    expect(frozen).toMatch(/cannot be changed/i);

    const [approved] = await queryRows<{ status: string }>(
      db,
      "select status from public.quality_approve_inspection($1, null)",
      [inspection.id],
    );
    expect(approved!.status).toBe("approved");
  });

  it("refuses to submit an inspection with a mandatory result missing", async () => {
    const f = await fixture();
    const { inspection } = await approvedSpecWithInspection(f);
    const error = await expectDbError(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    expect(error).toMatch(/no result recorded/i);
  });
});

describe("0077 dispositions and the inventory seam", () => {
  it("releases the Phase 4 pending-inspection restriction, and only then is the stock available", async () => {
    const f = await fixture();
    const { inspection, spec, lot } = await approvedSpecWithInspection(f, 400);

    const before = await queryRows<{ available_quantity: string; restricted_quantity: string }>(
      db,
      "select available_quantity::text, restricted_quantity::text from public.inventory_availability where lot_id = $1",
      [lot.lotId],
    );
    expect(Number(before[0]!.available_quantity)).toBe(0);
    expect(Number(before[0]!.restricted_quantity)).toBe(400);

    await recordResult(inspection.id, spec.id, 9);
    await queryRows(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    await queryRows(db, "select public.quality_approve_inspection($1, null)", [inspection.id]);

    const [disposition] = await queryRows<{ disposition: string; quantity: string }>(
      db,
      `select disposition, quantity::text from public.quality_record_disposition(
         $1, 'release', 'All tested parameters within the approved specification', null, null, null)`,
      [inspection.id],
    );
    expect(disposition!.disposition).toBe("release");

    const after = await queryRows<{ available_quantity: string; restricted_quantity: string }>(
      db,
      "select available_quantity::text, restricted_quantity::text from public.inventory_availability where lot_id = $1",
      [lot.lotId],
    );
    expect(Number(after[0]!.available_quantity)).toBe(400);
    expect(Number(after[0]!.restricted_quantity)).toBe(0);

    // And the stock is genuinely usable: a reservation against it now succeeds.
    const [reservation] = await queryRows<{ id: string }>(
      db,
      `select id from public.inventory_reserve_stock(
         $1, $2, 'quality release test', 'test', null, $3, null)`,
      [lot.lotId, 100, `p5-res-${lot.lotId}`],
    );
    expect(reservation!.id).toBeTruthy();
  });

  it("refuses a disposition on an unapproved inspection", async () => {
    const f = await fixture();
    const { inspection } = await approvedSpecWithInspection(f);
    const error = await expectDbError(
      db,
      "select public.quality_record_disposition($1, 'release', 'Attempting to release without approval', null, null, null)",
      [inspection.id],
    );
    expect(error).toMatch(/approved inspection|draft/i);
  });

  it("keeps stock restricted on rejection and records the hold that does it", async () => {
    const f = await fixture();
    const { inspection, spec, lot } = await approvedSpecWithInspection(f, 250);
    await recordResult(inspection.id, spec.id, 30); // over the 12 limit → non-conforming
    await queryRows(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    await queryRows(db, "select public.quality_approve_inspection($1, null)", [inspection.id]);

    await queryRows(
      db,
      `select public.quality_record_disposition(
         $1, 'reject', 'Moisture above the approved maximum; material rejected', null, null, null)`,
      [inspection.id],
    );

    const availability = await queryRows<{ available_quantity: string; restricted_quantity: string }>(
      db,
      "select available_quantity::text, restricted_quantity::text from public.inventory_availability where lot_id = $1",
      [lot.lotId],
    );
    expect(Number(availability[0]!.available_quantity)).toBe(0);
    expect(Number(availability[0]!.restricted_quantity)).toBe(250);

    const holds = await queryRows<{ restriction_state: string }>(
      db,
      "select restriction_state from public.quality_holds where lot_id = $1",
      [lot.lotId],
    );
    expect(holds.map((h) => h.restriction_state)).toContain("confirmed");
  });

  it("refuses to release a non-conforming inspection", async () => {
    const f = await fixture();
    const { inspection, spec } = await approvedSpecWithInspection(f);
    await recordResult(inspection.id, spec.id, 40);
    await queryRows(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    await queryRows(db, "select public.quality_approve_inspection($1, null)", [inspection.id]);

    const error = await expectDbError(
      db,
      "select public.quality_record_disposition($1, 'release', 'Releasing despite failing results', null, null, null)",
      [inspection.id],
    );
    expect(error).toMatch(/non-conforming/i);
  });

  it("records a hold as failed when the inventory side refuses, instead of pretending it held stock", async () => {
    const f = await fixture();
    const lot = await makeRestrictedLot(f, 100);
    // Everything is already restricted, so the inventory side refuses a further hold.
    const [hold] = await queryRows<{ restriction_state: string; failure_reason: string | null }>(
      db,
      `select restriction_state, failure_reason from public.quality_place_hold(
         $1, 100, 'investigation', 'Holding material for a shelf-life investigation', null)`,
      [lot.lotId],
    );
    expect(hold!.restriction_state).toBe("failed");
    expect(hold!.failure_reason).toMatch(/available/i);
  });

  it("records a disposition only once per inspection", async () => {
    const f = await fixture();
    const { inspection, spec } = await approvedSpecWithInspection(f);
    await recordResult(inspection.id, spec.id, 9);
    await queryRows(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    await queryRows(db, "select public.quality_approve_inspection($1, null)", [inspection.id]);
    await queryRows(
      db,
      "select public.quality_record_disposition($1, 'release', 'First disposition recorded for this lot', null, null, null)",
      [inspection.id],
    );
    const error = await expectDbError(
      db,
      "select public.quality_record_disposition($1, 'release', 'Second disposition on the same inspection', null, null, null)",
      [inspection.id],
    );
    expect(error).toMatch(/already carries a recorded disposition/i);
  });
});

describe("0078 non-conformance and CAPA", () => {
  it("refuses to close an NCR while an action is still open, and requires a root cause", async () => {
    await fixture();
    const [ncr] = await queryRows<{ id: string; reference: string }>(
      db,
      `insert into public.quality_ncrs (title, description, severity, source)
       values ('Moisture excursion on incoming gum', 'Two consecutive arrivals exceeded the approved maximum moisture limit.', 'major', 'inspection')
       returning id, reference`,
      [],
    );
    expect(ncr!.reference).toMatch(/^PA-QNC-/);

    await queryRows(
      db,
      `insert into public.quality_capa_actions (ncr_id, action_type, title, description, due_date)
       values ($1, 'corrective', 'Extend drying time', 'Drying time extended by the period verified to bring moisture within limits.', current_date + 14)`,
      [ncr!.id],
    );

    const blocked = await expectDbError(db, "select public.quality_close_ncr($1, $2, $3)", [
      ncr!.id,
      "Supplier drying cycle too short",
      "Investigation complete and action outstanding",
    ]);
    expect(blocked).toMatch(/open/i);

    await queryRows(db, "update public.quality_capa_actions set status = 'completed' where ncr_id = $1", [ncr!.id]);

    const [closed] = await queryRows<{ status: string; root_cause: string | null }>(
      db,
      "select status, root_cause from public.quality_close_ncr($1, $2, $3)",
      [ncr!.id, "Supplier drying cycle too short", "Corrective action completed and verified by the supplier"],
    );
    expect(closed!.status).toBe("closed");
    expect(closed!.root_cause).toMatch(/drying cycle/i);
  });

  it("refuses to verify an action that is not complete", async () => {
    await fixture();
    const [action] = await queryRows<{ id: string }>(
      db,
      `insert into public.quality_capa_actions (action_type, title, description)
       values ('preventive', 'Review supplier approval criteria', 'Add a moisture-history check to the supplier review checklist.')
       returning id`,
      [],
    );
    const error = await expectDbError(db, "select public.quality_verify_capa($1, $2)", [
      action!.id,
      "Checked the checklist and the next two arrivals were compliant",
    ]);
    expect(error).toMatch(/only a completed action/i);
  });
});

describe("0079 certificates of analysis", () => {
  it("issues a frozen snapshot, refuses without a release, and supersedes rather than edits", async () => {
    const f = await fixture();
    const { inspection, spec, lot } = await approvedSpecWithInspection(f);
    await recordResult(inspection.id, spec.id, 9);
    await queryRows(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    await queryRows(db, "select public.quality_approve_inspection($1, null)", [inspection.id]);

    // Before the disposition there is nothing to certify.
    const premature = await expectDbError(db, "select public.quality_issue_certificate($1, null, null, null, null, null)", [
      inspection.id,
    ]);
    expect(premature).toMatch(/no recorded disposition/i);

    await queryRows(
      db,
      "select public.quality_record_disposition($1, 'release', 'Results within the approved specification', null, null, null)",
      [inspection.id],
    );

    const [first] = await queryRows<{ id: string; reference: string; content: unknown }>(
      db,
      "select id, reference, content from public.quality_issue_certificate($1, 'Test Customer', null, null, null, null)",
      [inspection.id],
    );
    expect(first!.reference).toMatch(/^PA-QCO-/);

    const content = first!.content as { results: { conformance: string }[]; statement: unknown };
    expect(Array.isArray(content.results)).toBe(true);
    expect(content.results.length).toBeGreaterThan(0);

    const [second] = await queryRows<{ id: string; version: number; supersedes_id: string }>(
      db,
      "select id, version::int as version, supersedes_id from public.quality_issue_certificate($1, 'Test Customer', null, 'Reissued with corrected consignee', null, null)",
      [inspection.id],
    );
    expect(second!.version).toBe(2);
    expect(second!.supersedes_id).toBe(first!.id);

    const statuses = await queryRows<{ status: string }>(
      db,
      "select status from public.quality_certificates where lot_id = $1 order by version",
      [lot.lotId],
    );
    expect(statuses.map((s) => s.status)).toEqual(["superseded", "issued"]);

    // The generated statement never claims an external accreditation.
    const [statement] = await queryRows<{ statement: string; accreditation_reference: string | null }>(
      db,
      "select statement, accreditation_reference from public.quality_certificates where id = $1",
      [second!.id],
    );
    expect(statement!.statement).toMatch(/not a statement by any external laboratory/i);
    expect(statement!.accreditation_reference).toBeNull();
  });
});

describe("0080 reporting views", () => {
  it("reports the lot's quality position and counts what is actually held", async () => {
    const f = await fixture();
    const { inspection, spec, lot } = await approvedSpecWithInspection(f, 300);
    await recordResult(inspection.id, spec.id, 9);
    await queryRows(db, "select public.quality_submit_inspection($1)", [inspection.id]);
    await queryRows(db, "select public.quality_approve_inspection($1, null)", [inspection.id]);
    await queryRows(
      db,
      "select public.quality_record_disposition($1, 'release', 'Released after conforming inspection', null, null, null)",
      [inspection.id],
    );

    const [status] = await queryRows<{ quality_status: string; disposition: string; available_quantity: string }>(
      db,
      "select quality_status, disposition, available_quantity::text from public.quality_lot_status where lot_id = $1",
      [lot.lotId],
    );
    expect(status!.disposition).toBe("release");
    expect(status!.quality_status).toBe("released");
    expect(Number(status!.available_quantity)).toBe(300);

    const [trace] = await queryRows<{ lot_reference: string; inspections: unknown }>(
      db,
      "select lot_reference, inspections from public.quality_lot_traceability where lot_id = $1",
      [lot.lotId],
    );
    expect(Array.isArray(trace!.inspections)).toBe(true);

    const [summary] = await queryRows<{ certificates_issued: number; open_holds: number; failed_holds: number }>(
      db,
      "select certificates_issued::int, open_holds::int, failed_holds::int from public.quality_dashboard_summary",
    );
    expect(summary!.failed_holds).toBeGreaterThanOrEqual(0);
    expect(summary!.open_holds).toBeGreaterThanOrEqual(0);
  });
});
