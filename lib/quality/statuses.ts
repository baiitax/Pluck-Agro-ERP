/**
 * Quality vocabulary for the interface.
 *
 * The rules — which status may move to which, who may move it, whether a reason is required — live in the
 * database (`quality_status_transitions`, seeded by 0074). This module holds only what a page needs in order
 * to render a status honestly: a label and a tone.
 *
 * The lists here are asserted against the migrations by a unit test, so a status added to SQL without being
 * added here fails the build rather than appearing as raw snake_case in front of a quality officer.
 */
import type { BadgeTone } from "@/components/ui/badge";

export const SPECIFICATION_STATUSES = ["draft", "approved", "superseded", "cancelled"] as const;
export const INSPECTION_STATUSES = ["draft", "in_progress", "submitted", "approved", "rejected", "cancelled"] as const;
export const DISPOSITIONS = ["release", "reject", "hold", "rework", "downgrade", "quarantine"] as const;
export const CONFORMANCE_RESULTS = ["conforming", "non_conforming", "not_evaluated"] as const;
export const RESTRICTION_STATES = ["pending", "confirmed", "failed"] as const;
export const NCR_STATUSES = ["open", "investigating", "closed", "cancelled"] as const;
export const NCR_SEVERITIES = ["critical", "major", "minor", "observation"] as const;
export const NCR_SOURCES = ["inspection", "supplier", "internal", "customer_complaint", "audit", "deviation"] as const;
export const CAPA_STATUSES = ["open", "in_progress", "completed", "verified", "cancelled"] as const;
export const CAPA_TYPES = ["corrective", "preventive"] as const;
export const CERTIFICATE_STATUSES = ["issued", "superseded", "void"] as const;
export const QUALITY_STAGES = ["incoming", "in_process", "finished", "pre_dispatch", "storage"] as const;
export const INSPECTION_TYPES = [
  "routine",
  "incoming",
  "in_process",
  "final",
  "pre_dispatch",
  "retest",
  "investigation",
] as const;
export const PARAMETER_RESULT_TYPES = ["numeric", "text", "pass_fail", "observation"] as const;

const LABELS: Record<string, string> = {
  // lifecycle
  draft: "Draft",
  in_progress: "In progress",
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  superseded: "Superseded",
  // dispositions
  release: "Release",
  reject: "Reject",
  hold: "Hold",
  rework: "Rework",
  downgrade: "Downgrade",
  quarantine: "Quarantine",
  // conformance
  conforming: "Conforming",
  non_conforming: "Non-conforming",
  not_evaluated: "Not evaluated",
  indeterminate: "Indeterminate",
  // hold state — says plainly whether the stock was actually held
  pending: "Restriction pending",
  confirmed: "Restriction confirmed",
  failed: "Restriction FAILED",
  // NCR
  open: "Open",
  investigating: "Investigating",
  closed: "Closed",
  // severity
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  observation: "Observation",
  // sources
  inspection: "Inspection",
  supplier: "Supplier",
  internal: "Internal",
  customer_complaint: "Customer complaint",
  audit: "Audit",
  deviation: "Deviation",
  // CAPA
  completed: "Completed",
  verified: "Verified",
  corrective: "Corrective",
  preventive: "Preventive",
  // certificates
  issued: "Issued",
  void: "Void",
  // stages
  incoming: "Incoming",
  in_process: "In process",
  finished: "Finished",
  pre_dispatch: "Pre-dispatch",
  storage: "Storage",
  // inspection types
  routine: "Routine",
  final: "Final",
  retest: "Retest",
  investigation: "Investigation",
  // lot quality status
  released: "Released",
  restricted: "Restricted",
  pending_inspection: "Pending inspection",
  not_inspected: "Not inspected",
  // parameter types
  numeric: "Numeric",
  text: "Text",
  pass_fail: "Pass / fail",
};

const TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  in_progress: "info",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  superseded: "neutral",
  release: "success",
  released: "success",
  reject: "danger",
  hold: "warning",
  rework: "warning",
  downgrade: "warning",
  quarantine: "warning",
  conforming: "success",
  non_conforming: "danger",
  not_evaluated: "warning",
  indeterminate: "warning",
  confirmed: "info",
  failed: "danger",
  pending: "warning",
  open: "info",
  investigating: "warning",
  closed: "neutral",
  critical: "danger",
  major: "warning",
  minor: "info",
  observation: "neutral",
  completed: "info",
  verified: "success",
  issued: "success",
  void: "danger",
  restricted: "warning",
  pending_inspection: "warning",
  not_inspected: "neutral",
};

export function labelForQualityStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return LABELS[status] ?? status.replace(/_/g, " ");
}

export function qualityTone(status: string | null | undefined): BadgeTone {
  if (!status) return "neutral";
  return TONES[status] ?? "neutral";
}
