"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { actionFailure, actionSuccess, AppError, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import {
  adjustmentCreateSchema,
  adjustmentDecisionSchema,
  batchLogSchema,
  batchStartSchema,
  closeBatchSchema,
  countDecisionSchema,
  countLineSchema,
  countStartSchema,
  declaredInputSchema,
  issueMaterialSchema,
  lotCreateSchema,
  planCreateSchema,
  planDecisionSchema,
  processSchema,
  planReserveSchema,
  recordOutputSchema,
  reservationReleaseSchema,
  reservationSchema,
  restrictionReleaseSchema,
  restrictionSchema,
  stageCreateSchema,
  transferCreateSchema,
  transferDecisionSchema,
  yieldRuleSchema,
} from "@/lib/validation/inventory.schemas";
import type { RequestMeta } from "@/services/employees/manage-employee";
import {
  createAdjustment,
  decideAdjustment,
  decideCount,
  getAdjustmentDetail,
  postAdjustment,
  postCount,
  recordCountLine,
  startStockCount,
  submitAdjustment,
  submitCount,
} from "@/services/inventory/counts";
import {
  applyRestriction,
  createLot,
  releaseReservation,
  releaseRestriction,
  reserveStock,
} from "@/services/inventory/stock";
import {
  createTransfer,
  decideTransfer,
  dispatchTransfer,
  receiveTransfer,
  submitTransfer,
} from "@/services/inventory/transfers";
import {
  applyDeclaredInputs,
  createPlan,
  decidePlan,
  reserveMaterial,
  submitPlan,
} from "@/services/production/plans";
import {
  closeBatch,
  issueMaterial,
  logEntry,
  recordOutput,
  startBatch,
} from "@/services/production/batches";
import { createDeclaredInput, createProcess, createStage, createYieldRule } from "@/services/inventory/dashboard";

/**
 * Server actions for the inventory and production workspaces.
 *
 * Each action reads the form, validates it with the schema the form itself used, and calls one service.
 * Nothing about permission, availability or lifecycle is decided here: those live in the services and, below
 * them, in the database. An action cannot be the control, and nothing in this file reports success on behalf
 * of a database call that refused — the failure is returned as a failure.
 */

async function requestMeta(): Promise<RequestMeta> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
    requestId: headerStore.get("x-request-id"),
  };
}

function readForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/** Reads the `items` JSON a line editor submits. */
function readItems<T>(raw: string | undefined): T[] {
  if (!raw) throw new AppError("VALIDATION_ERROR", "Add at least one line before saving.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "The lines could not be read. Remove the last line and add it again.");
  }
  if (!Array.isArray(parsed)) throw new AppError("VALIDATION_ERROR", "The lines could not be read.");
  return parsed as T[];
}

function wrap<T>(handler: () => Promise<T>, revalidate: string[] = []): Promise<ActionResult<T>> {
  return handler()
    .then((data) => {
      for (const path of revalidate) revalidatePath(path);
      return actionSuccess(data);
    })
    .catch((error: unknown) => actionFailure(error));
}

// ------------------------------------------------------------------ stock / lots

export async function createLotAction(
  _previous: ActionResult<{ id: string; lotReference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; lotReference: string }>> {
  return wrap(async () => {
    const input = lotCreateSchema.parse(readForm(formData));
    return createLot(
      {
        productId: input.productId,
        unitId: input.unitId,
        warehouseId: input.warehouseId,
        locationId: input.locationId || null,
        receivedDate: input.receivedDate,
        manufactureDate: input.manufactureDate || null,
        expiryDate: input.expiryDate || null,
        grade: input.grade || null,
        notes: input.notes || null,
        openingQuantity: input.openingQuantity || null,
      },
      await requestMeta(),
    );
  }, ["/inventory", "/inventory/lots"]);
}

export async function applyRestrictionAction(
  _previous: ActionResult<{ id: string; reference: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string; status: string }>> {
  return wrap(async () => {
    const input = restrictionSchema.parse(readForm(formData));
    return applyRestriction(
      {
        lotId: input.lotId,
        quantity: input.quantity,
        restrictionType: input.restrictionType,
        reasonCode: input.reasonCode,
        reason: input.reason,
        expiresAt: input.expiresAt || null,
      },
      await requestMeta(),
    );
  }, ["/inventory", "/inventory/restrictions", `/inventory/lots/${formValue(formData.get("lotId"))}`]);
}

export async function releaseRestrictionAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = restrictionReleaseSchema.parse(readForm(formData));
    return releaseRestriction(
      { restrictionId: input.restrictionId, quantity: input.quantity, reason: input.reason },
      await requestMeta(),
    );
  }, ["/inventory/restrictions", "/inventory"]);
}

export async function reserveStockAction(
  _previous: ActionResult<{ id: string; reference: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string; status: string }>> {
  return wrap(async () => {
    const input = reservationSchema.parse(readForm(formData));
    return reserveStock(
      {
        lotId: input.lotId,
        quantity: input.quantity,
        reservedForModule: input.reservedForModule,
        reservedForType: input.reservedForType,
        reservedForReference: input.reservedForReference || null,
        notes: input.notes || null,
      },
      await requestMeta(),
    );
  }, ["/inventory/reservations", "/inventory"]);
}

export async function releaseReservationAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = reservationReleaseSchema.parse(readForm(formData));
    return releaseReservation(
      { reservationId: input.reservationId, quantity: input.quantity, reason: input.reason },
      await requestMeta(),
    );
  }, ["/inventory/reservations", "/inventory"]);
}

// ------------------------------------------------------------------- transfers

export async function createTransferAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const input = transferCreateSchema.parse({ ...values, items: readItems(values.items) });
    return createTransfer(
      {
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        transferReason: input.transferReason || null,
        vehicleReference: input.vehicleReference || null,
        notes: input.notes || null,
        items: input.items,
      },
      await requestMeta(),
    );
  }, ["/inventory/transfers", "/inventory"]);
}

export async function submitTransferAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    await submitTransfer(formValue(formData.get("transferId")), await requestMeta());
    return null;
  }, ["/inventory/transfers"]);
}

export async function decideTransferAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    const input = transferDecisionSchema.parse(readForm(formData));
    await decideTransfer(
      { transferId: input.transferId, decision: input.decision, reason: input.reason || null },
      await requestMeta(),
    );
    return null;
  }, ["/inventory/transfers", `/inventory/transfers/${formValue(formData.get("transferId"))}`]);
}

export async function dispatchTransferAction(
  _previous: ActionResult<{ dispatchedLines: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ dispatchedLines: number }>> {
  return wrap(async () => {
    const transferId = formValue(formData.get("transferId"));
    const result = await dispatchTransfer(transferId, await requestMeta());
    return result;
  }, ["/inventory/transfers", `/inventory/transfers/${formValue(formData.get("transferId"))}`, "/inventory"]);
}

export async function receiveTransferAction(
  _previous: ActionResult<{ receivedLines: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ receivedLines: number }>> {
  return wrap(async () => {
    const transferId = formValue(formData.get("transferId"));
    return receiveTransfer(transferId, await requestMeta());
  }, ["/inventory/transfers", `/inventory/transfers/${formValue(formData.get("transferId"))}`, "/inventory"]);
}

// ---------------------------------------------------------------------- counts

export async function startCountAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = countStartSchema.parse(readForm(formData));
    return startStockCount(
      {
        warehouseId: input.warehouseId,
        locationId: input.locationId || null,
        countDate: input.countDate,
        notes: input.notes || null,
      },
      await requestMeta(),
    );
  }, ["/inventory/counts", "/inventory"]);
}

export async function recordCountLineAction(
  _previous: ActionResult<{ variance: number | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ variance: number | null }>> {
  return wrap(async () => {
    const input = countLineSchema.parse(readForm(formData));
    return recordCountLine(
      { lineId: input.lineId, countedQuantity: input.countedQuantity, notes: input.notes || null },
      await requestMeta(),
    );
  }, ["/inventory/counts", `/inventory/counts/${formValue(formData.get("countId"))}`]);
}

export async function submitCountAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    await submitCount(formValue(formData.get("countId")), await requestMeta());
    return null;
  }, ["/inventory/counts"]);
}

export async function decideCountAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    const input = countDecisionSchema.parse(readForm(formData));
    await decideCount(
      { countId: input.countId, decision: input.decision, reason: input.reason || null },
      await requestMeta(),
    );
    return null;
  }, ["/inventory/counts", `/inventory/counts/${formValue(formData.get("countId"))}`]);
}

export async function postCountAction(
  _previous: ActionResult<{ gain: number; loss: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ gain: number; loss: number }>> {
  return wrap(async () => {
    return postCount(formValue(formData.get("countId")), await requestMeta());
  }, ["/inventory/counts", "/inventory", "/inventory/movements"]);
}

// ----------------------------------------------------------------- adjustments

export async function createAdjustmentAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const input = adjustmentCreateSchema.parse({ ...values, items: readItems(values.items) });
    return createAdjustment(
      {
        warehouseId: input.warehouseId,
        adjustmentDate: input.adjustmentDate,
        reasonCode: input.reasonCode,
        reason: input.reason,
        notes: input.notes || null,
        items: input.items,
      },
      await requestMeta(),
    );
  }, ["/inventory/adjustments", "/inventory"]);
}

export async function submitAdjustmentAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    await submitAdjustment(formValue(formData.get("adjustmentId")), await requestMeta());
    return null;
  }, ["/inventory/adjustments"]);
}

export async function decideAdjustmentAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    const input = adjustmentDecisionSchema.parse(readForm(formData));
    await decideAdjustment(
      { adjustmentId: input.adjustmentId, decision: input.decision, reason: input.reason || null },
      await requestMeta(),
    );
    return null;
  }, ["/inventory/adjustments", `/inventory/adjustments/${formValue(formData.get("adjustmentId"))}`]);
}

export async function postAdjustmentAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    await postAdjustment(formValue(formData.get("adjustmentId")), await requestMeta());
    return null;
  }, ["/inventory/adjustments", "/inventory", "/inventory/movements"]);
}

/** Loads an adjustment for its page without a second round-trip through a client component. */
export async function loadAdjustmentAction(adjustmentId: string) {
  return getAdjustmentDetail(adjustmentId);
}

// ----------------------------------------------------------------- production

export async function createPlanAction(
  _previous: ActionResult<{ id: string; reference: string; materialLines: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string; materialLines: number }>> {
  return wrap(async () => {
    const input = planCreateSchema.parse(readForm(formData));
    return createPlan(
      {
        productId: input.productId,
        unitId: input.unitId,
        warehouseId: input.warehouseId,
        plannedQuantity: input.plannedQuantity,
        plannedDate: input.plannedDate,
        plannedEndDate: input.plannedEndDate || null,
        priority: input.priority ?? "normal",
        source: input.source ?? "manual",
        sourceReference: input.sourceReference || null,
        notes: input.notes || null,
        applyDeclaredInputs: input.applyDeclaredInputs === "on",
      },
      await requestMeta(),
    );
  }, ["/production", "/production/plans"]);
}

export async function applyDeclaredInputsAction(
  _previous: ActionResult<{ created: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ created: number }>> {
  return wrap(async () => {
    return applyDeclaredInputs(formValue(formData.get("planId")), await requestMeta());
  }, ["/production/plans", `/production/plans/${formValue(formData.get("planId"))}`]);
}

export async function submitPlanAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    await submitPlan(formValue(formData.get("planId")), await requestMeta());
    return null;
  }, ["/production/plans"]);
}

export async function decidePlanAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return wrap(async () => {
    const input = planDecisionSchema.parse(readForm(formData));
    await decidePlan(
      { planId: input.planId, decision: input.decision, reason: input.reason || null },
      await requestMeta(),
    );
    return null;
  }, ["/production/plans", `/production/plans/${formValue(formData.get("planId"))}`]);
}

export async function reserveMaterialAction(
  _previous: ActionResult<{ reference: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ reference: string; status: string }>> {
  return wrap(async () => {
    const input = planReserveSchema.parse(readForm(formData));
    return reserveMaterial(
      { planId: input.planId, lotId: input.lotId, quantity: input.quantity, notes: input.notes || null },
      await requestMeta(),
    );
  }, ["/production/plans", `/production/plans/${formValue(formData.get("planId"))}`, "/inventory/reservations"]);
}

export async function startBatchAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = batchStartSchema.parse(readForm(formData));
    return startBatch(
      {
        planId: input.planId || null,
        productId: input.productId || null,
        plannedQuantity: input.plannedQuantity || null,
        unitId: input.unitId || null,
        warehouseId: input.warehouseId || null,
        batchDate: input.batchDate || null,
        notes: input.notes || null,
      },
      await requestMeta(),
    );
  }, ["/production", "/production/batches", "/production/plans"]);
}

export async function issueMaterialAction(
  _previous: ActionResult<{ lineNumber: number; movementId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ lineNumber: number; movementId: string }>> {
  return wrap(async () => {
    const input = issueMaterialSchema.parse(readForm(formData));
    return issueMaterial(
      { batchId: input.batchId, lotId: input.lotId, quantity: input.quantity, notes: input.notes || null },
      await requestMeta(),
    );
  }, ["/production/batches", `/production/batches/${formValue(formData.get("batchId"))}`, "/inventory"]);
}

export async function recordOutputAction(
  _previous: ActionResult<{ lotId: string; restrictionId: string | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ lotId: string; restrictionId: string | null }>> {
  return wrap(async () => {
    const input = recordOutputSchema.parse(readForm(formData));
    return recordOutput(
      {
        batchId: input.batchId,
        quantity: input.quantity,
        outputType: input.outputType,
        productId: input.productId || null,
        unitId: input.unitId || null,
        locationId: input.locationId || null,
        manufactureDate: input.manufactureDate || null,
        expiryDate: input.expiryDate || null,
        grade: input.grade || null,
        notes: input.notes || null,
      },
      await requestMeta(),
    );
  }, ["/production/batches", `/production/batches/${formValue(formData.get("batchId"))}`, "/inventory"]);
}

export async function closeBatchAction(
  _previous: ActionResult<{ recordedYieldPercent: number | null; withinDeclaredBand: boolean | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ recordedYieldPercent: number | null; withinDeclaredBand: boolean | null }>> {
  return wrap(async () => {
    const input = closeBatchSchema.parse(readForm(formData));
    return closeBatch({ batchId: input.batchId, reason: input.reason || null }, await requestMeta());
  }, ["/production/batches", `/production/batches/${formValue(formData.get("batchId"))}`, "/production"]);
}

export async function logEntryAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = batchLogSchema.parse(readForm(formData));
    return logEntry(
      {
        batchId: input.batchId,
        body: input.body,
        logType: input.logType ?? "note",
        shift: input.shift || null,
      },
      await requestMeta(),
    );
  }, [`/production/batches/${formValue(formData.get("batchId"))}`]);
}

// ------------------------------------------------------------ configuration

export async function createStageAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = stageCreateSchema.parse(readForm(formData));
    return createStage({
      code: input.code,
      name: input.name,
      sequence: input.sequence,
      description: input.description || null,
    });
  }, ["/production/configuration"]);
}

export async function createProcessAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = processSchema.parse(readForm(formData));
    return createProcess({
      productId: input.productId,
      stageId: input.stageId,
      sequence: input.sequence,
      expectedDurationHours: input.expectedDurationHours || null,
      instructions: input.instructions || null,
    });
  }, ["/production/configuration"]);
}

export async function createDeclaredInputAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = declaredInputSchema.parse(readForm(formData));
    return createDeclaredInput({
      productId: input.productId,
      inputProductId: input.inputProductId,
      unitId: input.unitId,
      quantity: input.quantity,
      basisQuantity: input.basisQuantity,
      isOptional: input.isOptional === "on",
      notes: input.notes || null,
    });
  }, ["/production/configuration"]);
}

export async function createYieldRuleAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = yieldRuleSchema.parse(readForm(formData));
    return createYieldRule({
      productId: input.productId,
      basis: input.basis,
      minPercent: input.minPercent || null,
      maxPercent: input.maxPercent || null,
      effectiveFrom: input.effectiveFrom,
      notes: input.notes || null,
    });
  }, ["/production/configuration", "/production/reports"]);
}
