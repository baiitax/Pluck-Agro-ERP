import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { Database } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";
import {
  callInventoryRpc,
  inventoryError,
  numeric,
  recordInventoryAudit,
  type RegisterPage,
} from "@/services/inventory/shared";

type PlanRow = Database["public"]["Tables"]["production_plans"]["Row"];
type PlanMaterialRow = Database["public"]["Tables"]["production_plan_materials"]["Row"];
type PlanProgressRow = Database["public"]["Views"]["production_plan_progress"]["Row"];

/**
 * Production planning.
 *
 * A plan is an intention: it states a product, a quantity, an output warehouse and the materials the factory
 * expects to consume. Approval is separate from creation because it is the moment the material requirement
 * becomes something the store has to take seriously, and it is the point at which the plan's requirement
 * lines freeze.
 *
 * Nothing in this file computes a material requirement. `production_plan_apply_declared_inputs` scales the
 * company's own declared routing, and if the company has declared nothing then the plan has no lines and the
 * service says so instead of inventing them.
 */

export async function listPlans(filters: { status?: string; page?: number } = {}): Promise<RegisterPage<PlanProgressRow>> {
  await requirePermission("production.plan.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("production_plan_progress")
    .select("*", { count: "exact" })
    .order("planned_date", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Production plans could not be loaded. ${error.message}`);

  const total = count ?? 0;
  return { rows: data ?? [], page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type PlanDetail = {
  plan: PlanProgressRow;
  /** The plan row itself, for the fields the progress view does not carry (dates, priority, notes). */
  record: PlanRow;
  materials: (PlanMaterialRow & {
    productCode: string | null;
    productName: string | null;
    unitCode: string | null;
    reservedQuantity: number;
  })[];
  batches: { id: string; reference: string; status: string; output_quantity: number; batch_date: string }[];
  declaredInputCount: number;
  nextStep: string;
};

export async function getPlanDetail(planId: string): Promise<PlanDetail> {
  await requirePermission("production.plan.view");
  const supabase = await createSupabaseServerClient();

  const { data: plan, error } = await supabase
    .from("production_plan_progress")
    .select("*")
    .eq("id", planId)
    .maybeSingle<PlanProgressRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That plan could not be loaded. ${error.message}`);
  if (!plan) throw new AppError("NOT_FOUND", "That production plan does not exist, or you cannot see it.");

  const [{ data: record }, { data: materials }, { data: batches }, { count: declaredInputCount }] = await Promise.all([
    supabase.from("production_plans").select("*").eq("id", planId).maybeSingle<PlanRow>(),
    supabase
      .from("production_plan_materials")
      .select("*, product:products(code, name), unit:units_of_measure(code)")
      .eq("plan_id", planId)
      .order("line_number")
      .returns<
        (PlanMaterialRow & { product: { code: string; name: string } | null; unit: { code: string } | null })[]
      >(),
    supabase
      .from("production_batch_summary")
      .select("id, reference, status, output_quantity, batch_date")
      .eq("plan_id", planId)
      .order("batch_date", { ascending: false })
      .returns<{ id: string; reference: string; status: string; output_quantity: number; batch_date: string }[]>(),
    supabase
      .from("production_product_inputs")
      .select("id", { count: "exact", head: true })
      .eq("product_id", plan.product_id),
  ]);

  // Reserved quantities are read from the reservation register rather than tallied here.
  const { data: reservations } = await supabase
    .from("inventory_reservation_register")
    .select("product_id, outstanding_quantity")
    .eq("reserved_for_module", "production")
    .eq("reserved_for_type", "production_plan")
    .eq("reserved_for_id", planId)
    .in("status", ["active", "partially_released"])
    .returns<{ product_id: string; outstanding_quantity: number }[]>();

  const reservedFor = (productId: string) =>
    (reservations ?? [])
      .filter((row) => row.product_id === productId)
      .reduce((total, row) => total + Number(row.outstanding_quantity), 0);

  const nextStep =
    plan.status === "draft"
      ? "Add the requirement lines, then submit for approval."
      : plan.status === "submitted"
        ? "Awaiting approval. Material cannot be reserved until it is approved."
        : plan.status === "approved"
          ? "Approved. Reserve material per lot, then start a batch."
          : plan.status === "in_progress"
            ? "Work is under way. Start another batch or close the running ones."
            : plan.status === "completed"
              ? "Completed. Produced quantity reached the planned quantity."
              : plan.status === "rejected"
                ? "Rejected. Amend and resubmit."
                : "Cancelled. Nothing was produced.";

  return {
    plan,
    record: record ?? ({} as PlanRow),
    materials: (materials ?? []).map((line) => ({
      ...line,
      productCode: line.product?.code ?? null,
      productName: line.product?.name ?? null,
      unitCode: line.unit?.code ?? null,
      reservedQuantity: reservedFor(line.product_id),
    })),
    batches: batches ?? [],
    declaredInputCount: declaredInputCount ?? 0,
    nextStep,
  };
}

export type CreatePlanInput = {
  productId: string;
  unitId: string;
  warehouseId: string;
  plannedQuantity: string;
  plannedDate: string;
  plannedEndDate?: string | null;
  priority?: string;
  source?: string;
  sourceReference?: string | null;
  notes?: string | null;
  /** When true the declared routing is copied onto the plan immediately after creation. */
  applyDeclaredInputs?: boolean;
};

export async function createPlan(
  input: CreatePlanInput,
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string; materialLines: number }> {
  await requirePermission("production.plan.create");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("production_plans")
    .insert({
      product_id: input.productId,
      unit_id: input.unitId,
      warehouse_id: input.warehouseId,
      planned_quantity: numeric(input.plannedQuantity),
      planned_date: input.plannedDate,
      planned_end_date: input.plannedEndDate ?? null,
      priority: input.priority ?? "normal",
      source: input.source ?? "manual",
      source_reference: input.sourceReference ?? null,
      notes: input.notes ?? null,
    } as never)
    .select("id, reference")
    .single<{ id: string; reference: string }>();

  if (error || !data) throw inventoryError(error ?? new Error("The plan was not created."));

  let materialLines = 0;
  if (input.applyDeclaredInputs) {
    materialLines = await callInventoryRpc<number>("production_plan_apply_declared_inputs", {
      p_plan_id: data.id,
    });
  }

  await recordInventoryAudit(
    {
      action: "production.plan.created",
      entityType: "production_plan",
      entityId: data.id,
      description: `Created production plan ${data.reference} with ${materialLines} declared material line(s)`,
      newValues: { reference: data.reference, material_lines: materialLines, planned_quantity: input.plannedQuantity },
    },
    meta,
  );

  return { id: data.id, reference: data.reference, materialLines };
}

/** Re-runs the declared-input copy. Refused once the plan has left draft, by the database. */
export async function applyDeclaredInputs(planId: string, meta: RequestMeta = {}): Promise<{ created: number }> {
  await requirePermission("production.plan.create");
  const created = await callInventoryRpc<number>("production_plan_apply_declared_inputs", { p_plan_id: planId });

  await recordInventoryAudit(
    {
      action: "production.plan.created",
      entityType: "production_plan",
      entityId: planId,
      description: `Copied ${created} declared material line(s) onto the plan`,
      newValues: { created },
    },
    meta,
  );

  return { created };
}

export async function submitPlan(planId: string, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("production.plan.create");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("production_plans")
    .update({ status: "submitted", submitted_at: new Date().toISOString() } as never)
    .eq("id", planId)
    .eq("status", "draft");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "production.plan.submitted",
      entityType: "production_plan",
      entityId: planId,
      description: "Submitted a production plan for approval",
    },
    meta,
  );
}

export async function decidePlan(
  input: { planId: string; decision: "approved" | "rejected"; reason?: string | null },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("production.plan.approve");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("production_plans")
    .update({
      status: input.decision,
      status_reason: input.reason ?? null,
      approved_at: input.decision === "approved" ? new Date().toISOString() : null,
    } as never)
    .eq("id", input.planId)
    .eq("status", "submitted");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "production.plan.approved",
      entityType: "production_plan",
      entityId: input.planId,
      description: `Production plan ${input.decision}${input.reason ? `: ${input.reason}` : ""}`,
      severity: input.decision === "rejected" ? "warning" : "notice",
    },
    meta,
  );
}

/**
 * Reserves available stock for one material line.
 *
 * The lot is chosen by the storekeeper, not by the system: which lot to draw from depends on age, grade and
 * where it physically sits, and a planner that picked silently would be making a warehousing decision it has
 * no business making. The claim goes through the shared reservation mechanism, so it reduces availability
 * everywhere else in the system too.
 */
export async function reserveMaterial(
  input: { planId: string; lotId: string; quantity: string; notes?: string | null },
  meta: RequestMeta = {},
): Promise<{ reference: string; status: string }> {
  await requirePermission("production.plan.execute");

  const rows = await callInventoryRpc<{ id: string; reference: string; status: string }[]>(
    "production_plan_reserve_material",
    {
      p_plan_id: input.planId,
      p_lot_id: input.lotId,
      p_quantity: numeric(input.quantity),
      p_notes: input.notes ?? null,
    },
  );

  const reservation = rows[0];
  if (!reservation) throw new AppError("VALIDATION_ERROR", "The database did not return a reservation.");

  await recordInventoryAudit(
    {
      action: "production.plan.material_reserved",
      entityType: "production_plan",
      entityId: input.planId,
      description: `Reserved ${input.quantity} of lot ${input.lotId} for the plan (${reservation.reference})`,
      newValues: { reservation_reference: reservation.reference, quantity: input.quantity },
    },
    meta,
  );

  return { reference: reservation.reference, status: reservation.status };
}

export type { PlanRow, PlanMaterialRow, PlanProgressRow };
