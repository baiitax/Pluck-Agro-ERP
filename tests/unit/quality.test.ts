import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAPA_STATUSES,
  CERTIFICATE_STATUSES,
  CONFORMANCE_RESULTS,
  DISPOSITIONS,
  INSPECTION_STATUSES,
  NCR_SEVERITIES,
  NCR_STATUSES,
  QUALITY_STAGES,
  RESTRICTION_STATES,
  SPECIFICATION_STATUSES,
  labelForQualityStatus,
  qualityTone,
} from "@/lib/quality/statuses";
import {
  capaVerifySchema,
  certificateIssueSchema,
  dispositionSchema,
  holdPlaceSchema,
  inspectionCreateSchema,
  ncrCreateSchema,
  parameterCreateSchema,
  resultRecordSchema,
  specificationCreateSchema,
} from "@/lib/validation/quality.schemas";

/**
 * Phase 5 unit coverage for the parts that are pure: the status vocabularies the UI renders, the Zod schemas the forms
 * and server actions share, and the parity between those vocabularies and the migrations.
 *
 * These are not a substitute for the database suite, which proves the triggers, guards and RPCs. They cover the layer
 * that decides what a form will accept before a request ever reaches Postgres — where a wrong guard means either a
 * confusing round trip or, worse, an acceptance the database then has to refuse.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function migrationText(): string {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .join("\n");
}

const UUID = crypto.randomUUID();

describe("Phase 5 status vocabularies", () => {
  it("keeps every lifecycle aligned with the database check constraints", () => {
    const sql = migrationText();

    for (const status of INSPECTION_STATUSES) {
      expect(sql, status).toContain(`'${status}'`);
    }
    expect(sql).toContain(
      "check (status in ('draft', 'in_progress', 'submitted', 'approved', 'rejected', 'cancelled'))",
    );
    expect(sql).toContain(
      "check (status in ('draft', 'approved', 'superseded', 'cancelled'))",
    );
    expect(sql).toContain("check (disposition in ('release', 'reject', 'hold', 'rework', 'downgrade', 'quarantine'))");
    expect(sql).toContain("check (status in ('open', 'investigating', 'closed', 'cancelled'))");
    expect(sql).toContain("check (status in ('open', 'in_progress', 'completed', 'verified', 'cancelled'))");
    expect(sql).toContain("check (status in ('issued', 'superseded', 'void'))");
    expect(sql).toContain("check (restriction_state in ('pending', 'confirmed', 'failed'))");
  });

  it("has a readable label and a tone for every declared status", () => {
    const groups = [
      SPECIFICATION_STATUSES,
      INSPECTION_STATUSES,
      DISPOSITIONS,
      CONFORMANCE_RESULTS,
      RESTRICTION_STATES,
      NCR_STATUSES,
      NCR_SEVERITIES,
      CAPA_STATUSES,
      CERTIFICATE_STATUSES,
      QUALITY_STAGES,
    ];

    for (const group of groups) {
      for (const status of group) {
        const label = labelForQualityStatus(status);
        expect(label, status).not.toBe("—");
        expect(label[0], status).toBe(label[0]?.toUpperCase());
        expect(qualityTone(status), status).toBeTruthy();
      }
    }
  });

  it("labels a failed hold as failed, rather than softening it", () => {
    // A hold that did not restrict anything must not read as "Hold" or "Pending". The label is the one place a reader
    // learns that the stock was never actually held.
    expect(labelForQualityStatus("failed")).toBe("Restriction FAILED");
    expect(qualityTone("failed")).toBe("danger");
  });
});

describe("Phase 5 validation schemas", () => {
  it("accepts a plausible specification header and refuses a missing product", () => {
    expect(
      specificationCreateSchema.parse({ productId: UUID, stage: "incoming", title: "", methodReference: "", notes: "" })
        .stage,
    ).toBe("incoming");

    expect(specificationCreateSchema.safeParse({ productId: "", stage: "incoming" }).success).toBe(false);
    expect(specificationCreateSchema.safeParse({ productId: UUID, stage: "elsewhere" }).success).toBe(false);
  });

  it("keeps measurements as text so PostgreSQL casts them exactly", () => {
    const parsed = resultRecordSchema.parse({
      inspectionId: UUID,
      specificationParameterId: UUID,
      valueNumeric: "12.345678",
      valueText: "",
      notes: "",
    });
    expect(parsed.valueNumeric).toBe("12.345678");
    // Seven decimal places cannot be stored in numeric(20,6); refusing here is better than a silent rounding.
    expect(
      resultRecordSchema.safeParse({
        inspectionId: UUID,
        specificationParameterId: UUID,
        valueNumeric: "12.3456789",
      }).success,
    ).toBe(false);
  });

  it("requires a substantive statement on a disposition", () => {
    expect(
      dispositionSchema.safeParse({ inspectionId: UUID, disposition: "release", reason: "fine", quantity: "" })
        .success,
    ).toBe(false);

    expect(
      dispositionSchema.safeParse({
        inspectionId: UUID,
        disposition: "release",
        reason: "All tested parameters within the approved specification",
      }).success,
    ).toBe(true);
  });

  it("refuses a hold with no reason and a certificate with an invalid customer id", () => {
    expect(holdPlaceSchema.safeParse({ lotId: UUID, quantity: "10", reasonCode: "retest", reason: "short" }).success).toBe(
      false,
    );
    expect(
      certificateIssueSchema.safeParse({ inspectionId: UUID, customerId: "not-a-uuid", issuedTo: "" }).success,
    ).toBe(false);
  });

  it("refuses a non-conformance whose description says nothing", () => {
    expect(
      ncrCreateSchema.safeParse({
        title: "Moisture excursion",
        description: "Too wet",
        severity: "major",
        source: "inspection",
      }).success,
    ).toBe(false);
  });

  it("requires evidence when verifying a corrective action", () => {
    expect(capaVerifySchema.safeParse({ actionId: UUID, notes: "done" }).success).toBe(false);
    expect(
      capaVerifySchema.safeParse({
        actionId: UUID,
        notes: "Checked the next two arrivals and both were within the moisture limit",
      }).success,
    ).toBe(true);
  });

  it("accepts parameter codes in the documented shape only", () => {
    expect(parameterCreateSchema.safeParse({ code: "moisture", name: "Moisture", resultType: "numeric" }).success).toBe(
      true,
    );
    expect(parameterCreateSchema.safeParse({ code: "Moisture %", name: "Moisture", resultType: "numeric" }).success).toBe(
      false,
    );
  });

  it("requires an inspection to name a lot and an approved-specification id", () => {
    expect(
      inspectionCreateSchema.safeParse({ specificationId: UUID, lotId: UUID, inspectionType: "incoming" }).success,
    ).toBe(true);
    expect(inspectionCreateSchema.safeParse({ specificationId: UUID, lotId: "", inspectionType: "incoming" }).success).toBe(
      false,
    );
  });
});
