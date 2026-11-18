import type { ApprovalAuthority } from "@/types/database.types";
import type { ValidationIssue } from "@/lib/governance/delegation";

/**
 * Approval authority helpers.
 *
 * Phase 1 configures who MAY approve what. It deliberately contains no approval workflow
 * execution and no invented Pluck Agro limits — every authority row is configuration entered
 * by an administrator, with a justification and a validity window.
 */

export type AuthorityWindow = { effectiveFrom: string; effectiveUntil?: string | null };

export function validateAuthorityWindow(window: AuthorityWindow, now: Date = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const from = new Date(window.effectiveFrom).getTime();

  if (!Number.isFinite(from)) {
    issues.push({ field: "effectiveFrom", message: "Provide a valid start date." });
    return issues;
  }
  if (window.effectiveUntil) {
    const until = new Date(window.effectiveUntil).getTime();
    if (!Number.isFinite(until)) {
      issues.push({ field: "effectiveUntil", message: "Provide a valid end date." });
    } else if (until <= from) {
      issues.push({ field: "effectiveUntil", message: "The end date must be after the start date." });
    }
  }
  void now;
  return issues;
}

export function validateAuthorityAmounts(minimum: number, maximum: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (minimum < 0) issues.push({ field: "minimumAmount", message: "Minimum cannot be negative." });
  if (maximum <= 0) issues.push({ field: "maximumAmount", message: "Maximum must be greater than zero." });
  if (minimum >= maximum) {
    issues.push({ field: "maximumAmount", message: "Maximum must be greater than the minimum." });
  }
  return issues;
}

export function isAuthorityActive(
  authority: Pick<ApprovalAuthority, "is_active" | "effective_from" | "effective_until">,
  now: Date = new Date(),
): boolean {
  if (!authority.is_active) return false;
  const at = now.getTime();
  if (new Date(authority.effective_from).getTime() > at) return false;
  if (authority.effective_until && new Date(authority.effective_until).getTime() < at) return false;
  return true;
}

export function highestLimit(
  authorities: Pick<ApprovalAuthority, "maximum_amount" | "is_active" | "effective_from" | "effective_until">[],
  now: Date = new Date(),
): number | null {
  const active = authorities.filter((authority) => isAuthorityActive(authority, now));
  if (active.length === 0) return null;
  return active.reduce((max, authority) => Math.max(max, Number(authority.maximum_amount)), 0);
}

export function authorityCoversAmount(
  authority: Pick<ApprovalAuthority, "minimum_amount" | "maximum_amount">,
  amount: number,
): boolean {
  return amount >= Number(authority.minimum_amount) && amount <= Number(authority.maximum_amount);
}
