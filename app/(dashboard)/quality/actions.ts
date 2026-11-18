"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { actionFailure, actionSuccess, AppError, type ActionResult } from "@/lib/errors";
import { formValue } from "@/lib/validation/common";
import {
  capaCreateSchema,
  capaUpdateSchema,
  capaVerifySchema,
  certificateIssueSchema,
  certificateVoidSchema,
  dispositionRevokeSchema,
  dispositionSchema,
  holdPlaceSchema,
  holdReleaseSchema,
  inspectionCreateSchema,
  inspectionDecisionSchema,
  ncrCloseSchema,
  ncrCreateSchema,
  ncrUpdateSchema,
  parameterCreateSchema,
  resultRecordSchema,
  sampleCreateSchema,
  samplingPlanCreateSchema,
  specificationApproveSchema,
  specificationCreateSchema,
  specificationLineSchema,
} from "@/lib/validation/quality.schemas";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { approveInspection, createInspection, recordResult, submitInspection, collectSample } from "@/services/quality/inspections";
import {
  createNcr,
  closeNcr,
  createCapa,
  updateCapaStatus,
  updateNcr,
  verifyCapa,
} from "@/services/quality/ncr";
import {
  issueCertificate,
  placeHold,
  recordDisposition,
  releaseHold,
  revokeDisposition,
  voidCertificate,
} from "@/services/quality/dispositions";
import {
  addSpecificationLine,
  approveSpecification,
  createParameter,
  createSamplingPlan,
  createSpecification,
  removeSpecificationLine,
} from "@/services/quality/specifications";

/**
 * Server actions for the quality workspace.
 *
 * Each action reads the form, validates it with the schema the form itself used, and calls one service. Nothing
 * about permission, conformance or lifecycle is decided here: those live in the services and, below them, in the
 * database. An action cannot be the control, and nothing here reports success on behalf of a database call that
 * refused — the refusal is returned as a failure, in the database's own words.
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

function wrap<T>(handler: () => Promise<T>, revalidate: string[] = []): Promise<ActionResult<T>> {
  return handler()
    .then((data) => {
      for (const path of revalidate) revalidatePath(path);
      return actionSuccess(data);
    })
    .catch((error: unknown) => actionFailure(error));
}

// ------------------------------------------------------------------ configuration

export async function createParameterAction(
  _previous: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  return wrap(async () => {
    const input = parameterCreateSchema.parse(readForm(formData));
    const parameter = await createParameter(
      {
        code: input.code,
        name: input.name,
        resultType: input.resultType,
        unitId: input.unitId || undefined,
        methodReference: input.methodReference,
        description: input.description,
      },
      await requestMeta(),
    );
    return { id: parameter.id, name: parameter.name };
  }, ["/quality/specifications"]);
}

export async function createSamplingPlanAction(
  _previous: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  return wrap(async () => {
    const input = samplingPlanCreateSchema.parse(readForm(formData));
    const plan = await createSamplingPlan(
      {
        name: input.name,
        productId: input.productId || undefined,
        stage: input.stage,
        basis: input.basis,
        percentage: input.percentage,
        fixedQuantity: input.fixedQuantity,
        unitId: input.unitId || undefined,
        notes: input.notes,
      },
      await requestMeta(),
    );
    return { id: plan.id, name: plan.name };
  }, ["/quality/specifications"]);
}

// ------------------------------------------------------------------ specifications

export async function createSpecificationAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = specificationCreateSchema.parse(readForm(formData));
    const specification = await createSpecification(
      {
        productId: input.productId,
        stage: input.stage,
        title: input.title,
        methodReference: input.methodReference,
        notes: input.notes,
      },
      [],
      await requestMeta(),
    );
    return { id: specification.id, reference: specification.reference };
  }, ["/quality/specifications"]);
}

export async function approveSpecificationAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = specificationApproveSchema.parse(readForm(formData));
    const specification = await approveSpecification(input.specificationId, input.reason, await requestMeta());
    return { id: specification.id, status: specification.status };
  }, ["/quality/specifications", "/quality"]);
}

// ------------------------------------------------------------------ inspections

export async function createInspectionAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = inspectionCreateSchema.parse(readForm(formData));
    const inspection = await createInspection(
      {
        specificationId: input.specificationId,
        lotId: input.lotId,
        inspectionType: input.inspectionType,
        samplingPlanId: input.samplingPlanId || undefined,
        sampledQuantity: input.sampledQuantity,
        sampleUnitId: input.sampleUnitId || undefined,
        notes: input.notes,
      },
      await requestMeta(),
    );
    return { id: inspection.id, reference: inspection.reference };
  }, ["/quality/inspections", "/quality"]);
}

export async function collectSampleAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = sampleCreateSchema.parse(readForm(formData));
    const sample = await collectSample(
      {
        inspectionId: input.inspectionId,
        quantity: input.quantity,
        unitId: input.unitId,
        locationNote: input.locationNote,
        notes: input.notes,
      },
      await requestMeta(),
    );
    return { id: sample.id, reference: sample.reference };
  });
}

export async function recordResultAction(
  _previous: ActionResult<{ id: string; conformance: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; conformance: string }>> {
  return wrap(async () => {
    const input = resultRecordSchema.parse(readForm(formData));
    const result = await recordResult(
      {
        inspectionId: input.inspectionId,
        specificationParameterId: input.specificationParameterId,
        valueNumeric: input.valueNumeric,
        valueText: input.valueText,
        notes: input.notes,
      },
      await requestMeta(),
    );
    return { id: result.id, conformance: result.conformance };
  }, []);
}

export async function submitInspectionAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = inspectionDecisionSchema.parse(readForm(formData));
    const inspection = await submitInspection(input.inspectionId, await requestMeta());
    return { id: inspection.id, status: inspection.status };
  }, ["/quality/inspections", "/quality"]);
}

export async function approveInspectionAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = inspectionDecisionSchema.parse(readForm(formData));
    const inspection = await approveInspection(input.inspectionId, input.reason, await requestMeta());
    return { id: inspection.id, status: inspection.status };
  }, ["/quality/inspections", "/quality"]);
}

// ------------------------------------------------------------------ dispositions and holds

export async function recordDispositionAction(
  _previous: ActionResult<{ id: string; reference: string; disposition: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string; disposition: string }>> {
  return wrap(async () => {
    const input = dispositionSchema.parse(readForm(formData));
    const decision = await recordDisposition(
      {
        inspectionId: input.inspectionId,
        disposition: input.disposition,
        reason: input.reason,
        quantity: input.quantity,
        instruction: input.instruction,
        nextReviewDate: input.nextReviewDate,
      },
      await requestMeta(),
    );
    return { id: decision.id, reference: decision.reference, disposition: decision.disposition };
  }, ["/quality/dispositions", "/quality", "/quality/holds", "/inventory/stock"]);
}

export async function revokeDispositionAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = dispositionRevokeSchema.parse(readForm(formData));
    const decision = await revokeDisposition(input.dispositionId, input.reason, await requestMeta());
    return { id: decision.id, status: decision.status };
  }, ["/quality/dispositions", "/quality"]);
}

export async function placeHoldAction(
  _previous: ActionResult<{ id: string; reference: string; state: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string; state: string }>> {
  return wrap(async () => {
    const input = holdPlaceSchema.parse(readForm(formData));
    const hold = await placeHold(
      {
        lotId: input.lotId,
        quantity: input.quantity,
        reasonCode: input.reasonCode,
        reason: input.reason,
        inspectionId: input.inspectionId || undefined,
      },
      await requestMeta(),
    );
    return { id: hold.id, reference: hold.reference, state: hold.restriction_state };
  }, ["/quality/holds", "/quality"]);
}

export async function releaseHoldAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = holdReleaseSchema.parse(readForm(formData));
    const hold = await releaseHold(
      { holdId: input.holdId, quantity: input.quantity, reason: input.reason },
      await requestMeta(),
    );
    return { id: hold.id, reference: hold.reference };
  }, ["/quality/holds", "/quality"]);
}

// ------------------------------------------------------------------ non-conformance and CAPA

export async function createNcrAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = ncrCreateSchema.parse(readForm(formData));
    const ncr = await createNcr(
      {
        title: input.title,
        description: input.description,
        severity: input.severity,
        source: input.source,
        inspectionId: input.inspectionId || undefined,
        lotId: input.lotId || undefined,
        supplierId: input.supplierId || undefined,
        containmentAction: input.containmentAction,
      },
      await requestMeta(),
    );
    return { id: ncr.id, reference: ncr.reference };
  }, ["/quality/ncr", "/quality"]);
}

export async function updateNcrAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = ncrUpdateSchema.parse(readForm(formData));
    const ncr = await updateNcr(
      {
        ncrId: input.ncrId,
        severity: input.severity,
        rootCause: input.rootCause,
        containmentAction: input.containmentAction,
        status: input.status,
        statusReason: input.statusReason,
      },
      await requestMeta(),
    );
    return { id: ncr.id, status: ncr.status };
  }, ["/quality/ncr"]);
}

export async function closeNcrAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = ncrCloseSchema.parse(readForm(formData));
    const ncr = await closeNcr(
      { ncrId: input.ncrId, rootCause: input.rootCause, reason: input.reason },
      await requestMeta(),
    );
    return { id: ncr.id, status: ncr.status };
  }, ["/quality/ncr", "/quality"]);
}

export async function createCapaAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = capaCreateSchema.parse(readForm(formData));
    const action = await createCapa(
      {
        ncrId: input.ncrId || undefined,
        actionType: input.actionType,
        title: input.title,
        description: input.description,
        ownerEmployeeId: input.ownerEmployeeId || undefined,
        dueDate: input.dueDate,
      },
      await requestMeta(),
    );
    return { id: action.id, reference: action.reference };
  }, ["/quality/ncr"]);
}

export async function updateCapaAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = capaUpdateSchema.parse(readForm(formData));
    const action = await updateCapaStatus(
      { actionId: input.actionId, status: input.status, statusReason: input.statusReason },
      await requestMeta(),
    );
    return { id: action.id, status: action.status };
  }, ["/quality/ncr"]);
}

export async function verifyCapaAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = capaVerifySchema.parse(readForm(formData));
    const action = await verifyCapa({ actionId: input.actionId, notes: input.notes }, await requestMeta());
    return { id: action.id, status: action.status };
  }, ["/quality/ncr"]);
}

// ------------------------------------------------------------------ certificates

export async function issueCertificateAction(
  _previous: ActionResult<{ id: string; reference: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return wrap(async () => {
    const input = certificateIssueSchema.parse(readForm(formData));
    const certificate = await issueCertificate(
      {
        inspectionId: input.inspectionId,
        issuedTo: input.issuedTo,
        customerId: input.customerId || undefined,
        remarks: input.remarks,
        laboratoryName: input.laboratoryName,
        accreditationReference: input.accreditationReference,
      },
      await requestMeta(),
    );
    return { id: certificate.id, reference: certificate.reference };
  }, ["/quality/certificates", "/quality"]);
}

export async function voidCertificateAction(
  _previous: ActionResult<{ id: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; status: string }>> {
  return wrap(async () => {
    const input = certificateVoidSchema.parse(readForm(formData));
    const certificate = await voidCertificate(input.certificateId, input.reason, await requestMeta());
    return { id: certificate.id, status: certificate.status };
  }, ["/quality/certificates"]);
}

// ------------------------------------------------------------------ specification lines

export async function addSpecificationLineAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const specificationId = formValue(formData.get("specificationId"));
    if (!specificationId) throw new AppError("VALIDATION_ERROR", "Choose a specification first.");
    const line = specificationLineSchema.parse({
      parameterId: formValue(formData.get("parameterId")),
      minValue: formValue(formData.get("minValue")),
      maxValue: formValue(formData.get("maxValue")),
      targetValue: formValue(formData.get("targetValue")),
      expectedText: formValue(formData.get("expectedText")),
      unitId: formValue(formData.get("unitId")),
      isMandatory: formValue(formData.get("isMandatory")),
      criticality: formValue(formData.get("criticality")) || "major",
      methodReference: formValue(formData.get("methodReference")),
      notes: formValue(formData.get("notes")),
    });
    const created = await addSpecificationLine(
      specificationId,
      {
        parameterId: line.parameterId,
        minValue: line.minValue,
        maxValue: line.maxValue,
        targetValue: line.targetValue,
        expectedText: line.expectedText,
        unitId: line.unitId || undefined,
        isMandatory: line.isMandatory !== "off",
        criticality: line.criticality,
        methodReference: line.methodReference,
        notes: line.notes,
      },
      await requestMeta(),
    );
    return { id: created.id };
  }, []);
}

export async function removeSpecificationLineAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const lineId = formValue(formData.get("lineId"));
    if (!lineId) throw new AppError("VALIDATION_ERROR", "That line could not be identified.");
    await removeSpecificationLine(lineId, await requestMeta());
    return { id: lineId };
  }, []);
}
