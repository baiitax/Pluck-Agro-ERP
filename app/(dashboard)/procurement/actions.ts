"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { actionFailure, actionSuccess, AppError, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import {
  advanceApplicationSchema,
  advanceCreateSchema,
  advancePaymentSchema,
  amendmentCreateSchema,
  commentSchema,
  comparisonCreateSchema,
  documentSchema,
  goodsReceiptCreateSchema,
  inspectionSchema,
  postingSchema,
  purchaseOrderCreateSchema,
  quotationCreateSchema,
  reconciliationSchema,
  requisitionCreateSchema,
  selectionSchema,
  transactionReferenceSchema,
} from "@/lib/validation/procurement.schemas";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { addComment, registerDocument } from "@/services/procurement/dashboard";
import {
  createGoodsReceipt,
  decideGoodsReceipt,
  postGoodsReceipt,
  recordInspection,
  submitGoodsReceipt,
} from "@/services/procurement/goods-receipts";
import {
  applyAmendment,
  createPurchaseOrder,
  decideAmendment,
  decidePurchaseOrder,
  raiseAmendment,
  submitPurchaseOrder,
} from "@/services/procurement/purchase-orders";
import {
  createComparison,
  createQuotation,
  createQuotationRequest,
  recordSelection,
  updateQuotation,
} from "@/services/procurement/quotations";
import {
  createRequisition,
  submitRequisition,
  updateRequisition,
} from "@/services/procurement/requisitions";
import { decideProcurement } from "@/services/procurement/shared";
import {
  applyAdvance,
  confirmAdvanceApplication,
  confirmAdvancePayment,
  createAdvance,
  decideAdvance,
  markAdvancePaymentPending,
  prepareReconciliation,
  recordTransactionReference,
  submitAdvance,
} from "@/services/procurement/supplier-accounts";

/**
 * Server actions for the procurement workspace.
 *
 * Each action is a thin adapter: it reads the form, validates with the same schema the form used, and
 * calls one service. Authorization, status rules and the immutability of issued documents are all
 * enforced below this layer — an action is never the control.
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

/** Reads the `items` field a line editor submits as JSON. */
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

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = formValue(value).trim();
  return text === "" ? undefined : text;
}

function wrap<T>(handler: () => Promise<T>, revalidate: string[] = []): Promise<ActionResult<T>> {
  return handler()
    .then((data) => {
      for (const path of revalidate) revalidatePath(path);
      return actionSuccess(data);
    })
    .catch((error: unknown) => actionFailure(error));
}

// ---------------------------------------------------------------- requisitions

export async function createRequisitionAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const input = requisitionCreateSchema.parse({ ...values, items: readItems(values.items) });
    return createRequisition(input, await requestMeta());
  }, ["/procurement", "/procurement/requisitions"]);
}

export async function updateRequisitionAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const id = formValue(formData.get("id"));
    const input = requisitionCreateSchema.parse({ ...values, items: readItems(values.items) });
    return updateRequisition(id, input, await requestMeta());
  }, ["/procurement/requisitions"]);
}

export async function submitRequisitionAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const id = formValue(formData.get("id"));
    return submitRequisition(id, await requestMeta());
  }, ["/procurement", "/procurement/requisitions"]);
}

export async function decideRequisitionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const decision = formValue(formData.get("decision")) as "approve" | "reject" | "cancel";
    if (!["approve", "reject", "cancel"].includes(decision)) {
      throw new AppError("VALIDATION_ERROR", "Unknown decision.");
    }
    return decideProcurement({
      entityType: "purchase_requisition",
      entityId: formValue(formData.get("id")),
      decision,
      comment: optional(formData.get("comment")) ?? null,
      reference: formValue(formData.get("reference")),
      auditAction: "procurement.requisition.submitted",
      revalidate: ["/procurement", "/procurement/requisitions"],
      meta: await requestMeta(),
    });
  });
}

// ---------------------------------------------------------------- quotations

export async function createQuotationAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const input = quotationCreateSchema.parse({ ...values, items: readItems(values.items) });
    return createQuotation(input, await requestMeta());
  }, ["/procurement/quotations"]);
}

export async function updateQuotationAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const input = quotationCreateSchema.parse({ ...values, items: readItems(values.items) });
    return updateQuotation(formValue(formData.get("id")), input, await requestMeta());
  }, ["/procurement/quotations"]);
}

export async function createQuotationRequestAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const supplierIds = formData.getAll("supplierIds").map(String).filter(Boolean);
    if (supplierIds.length === 0) throw new AppError("VALIDATION_ERROR", "Select at least one supplier to invite.");
    return createQuotationRequest(
      {
        requisitionId: formValue(formData.get("requisitionId")),
        responseDueDate: formValue(formData.get("responseDueDate")),
        scopeDescription: formValue(formData.get("scopeDescription")),
        supplierIds,
        notes: optional(formData.get("notes")),
      },
      await requestMeta(),
    );
  }, ["/procurement/quotations"]);
}

export async function createComparisonAction(
  _previous: ActionResult<{ id: string; title: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; title: string }>> {
  return wrap(async () => {
    const quotationIds = formData.getAll("quotationIds").map(String).filter(Boolean);
    const values = readForm(formData);
    const input = comparisonCreateSchema.parse({ ...values, quotationIds });
    return createComparison(input, await requestMeta());
  }, ["/procurement/quotations/comparisons"]);
}

export async function selectQuotationAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = selectionSchema.parse({
      comparisonId: formValue(formData.get("comparisonId")),
      selectedQuotationId: formValue(formData.get("selectedQuotationId")),
      justification: formValue(formData.get("justification")),
    });
    return recordSelection(input, await requestMeta());
  }, ["/procurement/quotations", "/procurement/purchase-orders"]);
}

// ---------------------------------------------------------------- purchase orders

export async function createPurchaseOrderAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const requisitionIds = formData.getAll("requisitionIds").map(String).filter(Boolean);
    const input = purchaseOrderCreateSchema.parse({
      ...values,
      requisitionIds: requisitionIds.length > 0 ? requisitionIds : undefined,
      items: readItems(values.items),
    });
    return createPurchaseOrder(input, await requestMeta());
  }, ["/procurement", "/procurement/purchase-orders"]);
}

export async function submitPurchaseOrderAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => submitPurchaseOrder(formValue(formData.get("id")), await requestMeta()), [
    "/procurement",
    "/procurement/purchase-orders",
  ]);
}

export async function decidePurchaseOrderAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const decision = formValue(formData.get("decision")) as "approve" | "reject" | "issue" | "cancel" | "close";
    if (!["approve", "reject", "issue", "cancel", "close"].includes(decision)) {
      throw new AppError("VALIDATION_ERROR", "Unknown decision.");
    }
    return decidePurchaseOrder({
      id: formValue(formData.get("id")),
      decision,
      reference: formValue(formData.get("reference")),
      comment: optional(formData.get("comment")) ?? null,
      meta: await requestMeta(),
    });
  });
}

export async function raiseAmendmentAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);

    // The amendment panel submits one change line through flat fields; anything more elaborate comes
    // in as a JSON `items` array. Both end up in the same validated shape.
    const items =
      values.items !== undefined && values.items !== ""
        ? readItems<Record<string, unknown>>(values.items)
        : [
            {
              purchaseOrderItemId: optional(formData.get("amendmentLine")) ?? "",
              changeType: formValue(formData.get("amendmentChangeType")) || "other",
              newValue: formValue(formData.get("amendmentNewValue")),
            },
          ];

    const input = amendmentCreateSchema.parse({ reason: values.reason, items });
    return raiseAmendment(
      formValue(formData.get("purchaseOrderId")),
      formValue(formData.get("orderReference")),
      input,
      await requestMeta(),
    );
  }, ["/procurement/purchase-orders"]);
}

export async function decideAmendmentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const decision = formValue(formData.get("decision")) as "approve" | "reject" | "cancel";
    if (!["approve", "reject", "cancel"].includes(decision)) {
      throw new AppError("VALIDATION_ERROR", "Unknown decision.");
    }
    return decideAmendment({
      id: formValue(formData.get("id")),
      decision,
      reference: formValue(formData.get("reference")),
      comment: optional(formData.get("comment")) ?? null,
      meta: await requestMeta(),
    });
  });
}

export async function applyAmendmentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const result = await applyAmendment({
      amendmentId: formValue(formData.get("id")),
      reference: formValue(formData.get("reference")),
      confirmReceivedImpact: formData.get("confirmReceivedImpact") === "on",
      meta: await requestMeta(),
    });
    revalidatePath("/procurement/purchase-orders");
    return result;
  });
}

// ---------------------------------------------------------------- goods receipts

export async function createGoodsReceiptAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const values = readForm(formData);
    const input = goodsReceiptCreateSchema.parse({ ...values, items: readItems(values.items) });
    return createGoodsReceipt(input, await requestMeta());
  }, ["/procurement", "/procurement/goods-receipts"]);
}

export async function submitGoodsReceiptAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => submitGoodsReceipt(formValue(formData.get("id")), await requestMeta()), [
    "/procurement/goods-receipts",
  ]);
}

export async function decideGoodsReceiptAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const decision = formValue(formData.get("decision")) as "approve" | "reject" | "return" | "cancel";
    if (!["approve", "reject", "return", "cancel"].includes(decision)) {
      throw new AppError("VALIDATION_ERROR", "Unknown decision.");
    }
    return decideGoodsReceipt({
      id: formValue(formData.get("id")),
      decision,
      reference: formValue(formData.get("reference")),
      comment: optional(formData.get("comment")) ?? null,
      meta: await requestMeta(),
    });
  });
}

export async function postGoodsReceiptAction(
  _previous: ActionResult<{ posting_reference: string; already_posted: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ posting_reference: string; already_posted: boolean }>> {
  return wrap(async () => {
    const input = postingSchema.parse({
      receiptId: formValue(formData.get("receiptId")),
      idempotencyKey: formValue(formData.get("idempotencyKey")),
      allowExcess: formData.get("allowExcess") === "on" ? "on" : "",
    });
    return postGoodsReceipt({
      id: input.receiptId,
      reference: formValue(formData.get("reference")),
      idempotencyKey: input.idempotencyKey,
      allowExcess: input.allowExcess === "on",
      meta: await requestMeta(),
    });
  }, ["/procurement", "/procurement/goods-receipts"]);
}

export async function recordInspectionAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = inspectionSchema.parse({
      goodsReceiptId: formValue(formData.get("goodsReceiptId")),
      goodsReceiptItemId: formValue(formData.get("goodsReceiptItemId")),
      inspectionType: formValue(formData.get("inspectionType")),
      result: formValue(formData.get("result")),
      quantityInspected: optional(formData.get("quantityInspected")),
      findings: formValue(formData.get("findings")),
    });
    return recordInspection(
      {
        goodsReceiptId: input.goodsReceiptId,
        goodsReceiptItemId: input.goodsReceiptItemId || undefined,
        inspectionType: input.inspectionType,
        result: input.result,
        quantityInspected: input.quantityInspected,
        findings: input.findings,
      },
      formValue(formData.get("reference")),
      await requestMeta(),
    );
  }, ["/procurement/goods-receipts"]);
}

// ---------------------------------------------------------------- supplier advances

export async function createAdvanceAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = advanceCreateSchema.parse(readForm(formData));
    return createAdvance(input, await requestMeta());
  }, ["/procurement/supplier-advances"]);
}

export async function submitAdvanceAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () =>
    submitAdvance(formValue(formData.get("id")), formValue(formData.get("reference")), await requestMeta()),
  ["/procurement/supplier-advances"]);
}

export async function decideAdvanceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const decision = formValue(formData.get("decision")) as "approve" | "reject" | "cancel";
    if (!["approve", "reject", "cancel"].includes(decision)) {
      throw new AppError("VALIDATION_ERROR", "Unknown decision.");
    }
    return decideAdvance({
      id: formValue(formData.get("id")),
      decision,
      reference: formValue(formData.get("reference")),
      comment: optional(formData.get("comment")) ?? null,
      meta: await requestMeta(),
    });
  });
}

export async function markAdvancePaymentPendingAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () =>
    markAdvancePaymentPending(
      formValue(formData.get("id")),
      formValue(formData.get("reference")),
      await requestMeta(),
    ),
  ["/procurement/supplier-advances"]);
}

export async function confirmAdvancePaymentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const input = advancePaymentSchema.parse({
      advanceId: formValue(formData.get("advanceId")),
      payingBankAccountId: formValue(formData.get("payingBankAccountId")),
      payingAccountNote: optional(formData.get("payingAccountNote")),
      paymentReference: formValue(formData.get("paymentReference")),
      treasuryConfirmationReference: formValue(formData.get("treasuryConfirmationReference")),
      notes: optional(formData.get("notes")),
    });
    return confirmAdvancePayment(input, formValue(formData.get("reference")), await requestMeta());
  }, ["/procurement/supplier-advances"]);
}

export async function applyAdvanceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const input = advanceApplicationSchema.parse({
      advanceId: formValue(formData.get("advanceId")),
      targetType: formValue(formData.get("targetType")),
      targetReference: formValue(formData.get("targetReference")),
      appliedAmount: formValue(formData.get("appliedAmount")),
      notes: optional(formData.get("notes")),
    });
    return applyAdvance(input, formValue(formData.get("reference")), await requestMeta());
  }, ["/procurement/supplier-advances"]);
}

export async function confirmAdvanceApplicationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () =>
    confirmAdvanceApplication(
      formValue(formData.get("applicationId")),
      formValue(formData.get("reference")),
      await requestMeta(),
    ),
  ["/procurement/supplier-advances"]);
}

// ---------------------------------------------------------------- supplier reconciliation

export async function recordTransactionReferenceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const input = transactionReferenceSchema.parse(readForm(formData));
    return recordTransactionReference(input, await requestMeta());
  }, ["/procurement/suppliers"]);
}

export async function prepareReconciliationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return wrap(async () => {
    const input = reconciliationSchema.parse(readForm(formData));
    return prepareReconciliation(input, await requestMeta());
  }, ["/procurement/suppliers"]);
}

// ---------------------------------------------------------------- documents and comments

export async function registerDocumentAction(
  _previous: ActionResult<{ id: string; title: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; title: string }>> {
  return wrap(async () => {
    const input = documentSchema.parse(readForm(formData));
    return registerDocument(input, await requestMeta());
  }, ["/procurement/documents"]);
}

export async function addCommentAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const input = commentSchema.parse(readForm(formData));
    return addComment(input, await requestMeta());
  });
}
