import type { SodEnforcement } from "@/types/database.types";

/**
 * Segregation-of-duties evaluation.
 *
 * Rules are configuration, not company policy: nothing is seeded with real Pluck Agro rules.
 * The evaluator is pure so the same decision can be previewed in the UI and re-checked on the
 * server before a write.
 */

export type SodRuleLike = {
  id: string;
  code: string;
  name: string;
  module: string;
  first_action: string;
  conflicting_action: string;
  enforcement_level: SodEnforcement;
  is_active: boolean;
};

export type SodOverrideLike = {
  rule_id: string;
  employee_id: string;
  expires_at: string | null;
};

export type SodConflict = {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  enforcement: SodEnforcement;
  actionHeld: string;
  conflictingAction: string;
  overrideApplies: boolean;
  justification?: string;
};

export type SodDecision = "allow" | "warn" | "require_override" | "block";

export type SodEvaluation = {
  decision: SodDecision;
  conflicts: SodConflict[];
};

const DECISION_RANK: Record<SodDecision, number> = {
  block: 4,
  require_override: 3,
  warn: 2,
  allow: 1,
};

const ENFORCEMENT_TO_DECISION: Record<SodEnforcement, SodDecision> = {
  BLOCK: "block",
  REQUIRE_OVERRIDE: "require_override",
  WARN: "warn",
};

function overrideIsValid(override: SodOverrideLike, employeeId: string, now: Date): boolean {
  if (override.employee_id !== employeeId) return false;
  if (!override.expires_at) return true;
  return new Date(override.expires_at).getTime() > now.getTime();
}

/**
 * @param actionsHeld the actions a person would hold AFTER the change being evaluated
 */
export function evaluateSod(
  rules: SodRuleLike[],
  actionsHeld: Iterable<string>,
  employeeId: string,
  overrides: SodOverrideLike[] = [],
  now: Date = new Date(),
): SodEvaluation {
  const held = new Set(actionsHeld);
  const conflicts: SodConflict[] = [];

  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (rule.first_action === rule.conflicting_action) continue;
    if (!held.has(rule.first_action) || !held.has(rule.conflicting_action)) continue;

    const override = overrides.find(
      (candidate) => candidate.rule_id === rule.id && overrideIsValid(candidate, employeeId, now),
    );

    conflicts.push({
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      enforcement: rule.enforcement_level,
      actionHeld: rule.first_action,
      conflictingAction: rule.conflicting_action,
      overrideApplies: Boolean(override),
    });
  }

  let decision: SodDecision = "allow";
  for (const conflict of conflicts) {
    const candidate = ENFORCEMENT_TO_DECISION[conflict.enforcement];
    // A valid override downgrades BLOCK / REQUIRE_OVERRIDE to WARN, never to silence.
    const effective =
      conflict.overrideApplies && candidate !== "warn" ? "warn" : candidate;
    if (DECISION_RANK[effective] > DECISION_RANK[decision]) decision = effective;
  }

  return { decision, conflicts };
}

export function describeSodDecision(decision: SodDecision): string {
  switch (decision) {
    case "block":
      return "Blocked: this combination separates duties that must stay with different people.";
    case "require_override":
      return "An approved override with a justification is required before this can be saved.";
    case "warn":
      return "Allowed with a warning: this combination is flagged for review.";
    default:
      return "No separation-of-duties conflict detected.";
  }
}
