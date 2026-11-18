import type { DelegationStatus } from "@/types/database.types";

/**
 * Pure delegation rules. These are the same rules the database enforces in
 * `private.prevent_delegation_cycle()` and `private.validate_delegation_limit()`; keeping a
 * pure copy lets the UI block impossible requests early and lets unit tests cover the logic
 * without a database.
 */

export const DELEGATION_STATUSES: readonly DelegationStatus[] = [
  "pending_approval",
  "approved",
  "rejected",
  "revoked",
  "expired",
];

export const DELEGATION_TERMINAL_STATUSES: readonly DelegationStatus[] = ["rejected", "revoked", "expired"];

export type DelegationWindow = { effectiveFrom: string; effectiveUntil: string };

export type DelegationRequest = DelegationWindow & {
  delegatorEmployeeId: string;
  delegateEmployeeId: string;
  /** Highest limit the delegator holds for the same module / transaction type / currency. */
  delegatorMaxLimit: number | null;
  delegatedLimit: number;
};

export type ValidationIssue = { field: string; message: string };

export function isDelegationLive(
  delegation: { status: DelegationStatus; effective_from: string; effective_until: string },
  now: Date = new Date(),
): boolean {
  if (delegation.status !== "approved") return false;
  const from = new Date(delegation.effective_from).getTime();
  const until = new Date(delegation.effective_until).getTime();
  const at = now.getTime();
  return at >= from && at <= until;
}

/**
 * Validates a delegation before it is written.
 *
 * Deliberately does NOT invent limits: a delegator with no configured authority cannot
 * delegate, and a delegate can never receive more authority than the delegator holds.
 */
export function validateDelegation(request: DelegationRequest, now: Date = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!request.delegatorEmployeeId) {
    issues.push({ field: "delegatorEmployeeId", message: "Select the person delegating their authority." });
  }
  if (!request.delegateEmployeeId) {
    issues.push({ field: "delegateEmployeeId", message: "Select the person receiving the authority." });
  }
  if (
    request.delegatorEmployeeId &&
    request.delegatorEmployeeId === request.delegateEmployeeId
  ) {
    issues.push({ field: "delegateEmployeeId", message: "A person cannot delegate authority to themselves." });
  }

  const from = new Date(request.effectiveFrom).getTime();
  const until = new Date(request.effectiveUntil).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(until)) {
    issues.push({ field: "effectiveFrom", message: "Provide a valid start and end date." });
    return issues;
  }
  if (until <= from) {
    issues.push({ field: "effectiveUntil", message: "The end date must be after the start date." });
  }

  if (request.delegatorMaxLimit === null) {
    issues.push({
      field: "delegatorEmployeeId",
      message: "This person has no recorded approval authority for this module and transaction type, so there is nothing to delegate.",
    });
  } else if (request.delegatedLimit > request.delegatorMaxLimit) {
    issues.push({
      field: "delegatedLimit",
      message: "The delegated limit cannot exceed the delegator's own authority.",
    });
  }

  if (request.delegatedLimit <= 0) {
    issues.push({ field: "delegatedLimit", message: "Enter a limit greater than zero." });
  }

  void now;
  return issues;
}

/** Returns true when granting `next` would close a delegation cycle. */
export function wouldCreateDelegationCycle(
  next: { delegatorEmployeeId: string; delegateEmployeeId: string },
  existing: { delegator_employee_id: string; delegate_employee_id: string; status: DelegationStatus }[],
): boolean {
  if (next.delegatorEmployeeId === next.delegateEmployeeId) return true;

  const live = existing.filter((row) => row.status === "approved");
  const byDelegator = new Map(live.map((row) => [row.delegator_employee_id, row.delegate_employee_id]));

  // Walk the chain from the proposed delegate upwards; if it reaches the delegator, it cycles.
  let current: string | undefined = next.delegateEmployeeId;
  const seen = new Set<string>();
  while (current) {
    if (current === next.delegatorEmployeeId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = byDelegator.get(current);
  }
  return false;
}

export function effectiveDelegationStatus(
  delegation: { status: DelegationStatus; effective_until: string },
  now: Date = new Date(),
): DelegationStatus {
  if (delegation.status === "approved" && new Date(delegation.effective_until).getTime() < now.getTime()) {
    return "expired";
  }
  return delegation.status;
}
