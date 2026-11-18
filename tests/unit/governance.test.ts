import { describe, expect, it } from "vitest";

import {
  allowedAccountTransitions,
  canTransitionAccountStatus,
  ACCOUNT_STATUSES,
  EMPLOYMENT_STATUSES,
  isEmploymentStatus,
  type AccountStatusValue,
} from "@/lib/constants/statuses";
import {
  describeSodDecision,
  evaluateSod,
  type SodRuleLike,
} from "@/lib/governance/sod";
import {
  effectiveDelegationStatus,
  isDelegationLive,
  validateDelegation,
  wouldCreateDelegationCycle,
} from "@/lib/governance/delegation";
import {
  authorityCoversAmount,
  highestLimit,
  isAuthorityActive,
  validateAuthorityAmounts,
  validateAuthorityWindow,
} from "@/lib/governance/authority";
import {
  currentReviewPeriod,
  isValidReviewPeriod,
  recentReviewPeriods,
  reviewPeriodLabel,
} from "@/lib/governance/review-period";
import { buildTree, descendantIds, findNode, flattenTree } from "@/lib/organization/tree";

describe("employment and account status are separate concepts", () => {
  it("models seven employment statuses", () => {
    expect(EMPLOYMENT_STATUSES).toHaveLength(7);
    expect(isEmploymentStatus("probation")).toBe(true);
    expect(isEmploymentStatus("active")).toBe(true);
    expect(isEmploymentStatus("invited")).toBe(false);
  });

  it("models six account statuses", () => {
    expect(ACCOUNT_STATUSES).toHaveLength(6);
  });

  it("only allows the lifecycle transitions the database allows", () => {
    expect(canTransitionAccountStatus("invited", "active")).toBe(true);
    expect(canTransitionAccountStatus("invited", "suspended")).toBe(false);
    expect(canTransitionAccountStatus("active", "locked")).toBe(true);
    expect(canTransitionAccountStatus("deactivated", "active")).toBe(true);
    expect(canTransitionAccountStatus("deactivated", "suspended")).toBe(false);
    expect(canTransitionAccountStatus("locked", "invited")).toBe(false);
  });

  it("never offers a transition back to the same status", () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(allowedAccountTransitions(status as AccountStatusValue)).not.toContain(status);
    }
  });
});

const rules: SodRuleLike[] = [
  {
    id: "rule-1",
    code: "SOD-CREATE-APPROVE",
    name: "Creator cannot approve",
    module: "procurement",
    first_action: "create",
    conflicting_action: "approve",
    enforcement_level: "BLOCK",
    is_active: true,
  },
  {
    id: "rule-2",
    code: "SOD-POST-APPROVE",
    name: "Poster cannot approve",
    module: "finance",
    first_action: "post",
    conflicting_action: "approve",
    enforcement_level: "WARN",
    is_active: true,
  },
];

describe("segregation of duties evaluation", () => {
  it("allows a combination with no conflict", () => {
    const result = evaluateSod(rules, ["create"], "employee-1");
    expect(result.decision).toBe("allow");
    expect(result.conflicts).toHaveLength(0);
  });

  it("blocks a BLOCK-level conflict", () => {
    const result = evaluateSod(rules, ["create", "approve"], "employee-1");
    expect(result.decision).toBe("block");
    expect(result.conflicts[0]?.ruleCode).toBe("SOD-CREATE-APPROVE");
  });

  it("warns for a WARN-level conflict", () => {
    const result = evaluateSod(rules, ["post", "approve"], "employee-1");
    expect(result.decision).toBe("warn");
  });

  it("ignores inactive rules", () => {
    const result = evaluateSod(
      rules.map((rule) => ({ ...rule, is_active: false })),
      ["create", "approve"],
      "employee-1",
    );
    expect(result.decision).toBe("allow");
  });

  it("downgrades a block to a warning when a live override exists", () => {
    const result = evaluateSod(
      rules,
      ["create", "approve"],
      "employee-1",
      [{ rule_id: "rule-1", employee_id: "employee-1", expires_at: null }],
    );
    expect(result.decision).toBe("warn");
    expect(result.conflicts[0]?.overrideApplies).toBe(true);
  });

  it("ignores an expired override", () => {
    const result = evaluateSod(
      rules,
      ["create", "approve"],
      "employee-1",
      [{ rule_id: "rule-1", employee_id: "employee-1", expires_at: "2020-01-01T00:00:00Z" }],
    );
    expect(result.decision).toBe("block");
    expect(result.conflicts[0]?.overrideApplies).toBe(false);
  });

  it("ignores an override granted to a different employee", () => {
    const result = evaluateSod(
      rules,
      ["create", "approve"],
      "employee-1",
      [{ rule_id: "rule-1", employee_id: "employee-2", expires_at: null }],
    );
    expect(result.decision).toBe("block");
  });

  it("reports the strongest decision when several rules conflict", () => {
    const result = evaluateSod(rules, ["create", "post", "approve"], "employee-1");
    expect(result.decision).toBe("block");
    expect(result.conflicts).toHaveLength(2);
  });

  it("describes every decision in plain language", () => {
    for (const decision of ["allow", "warn", "require_override", "block"] as const) {
      expect(describeSodDecision(decision).length).toBeGreaterThan(10);
    }
  });
});

describe("delegation rules", () => {
  const base = {
    delegatorEmployeeId: "employee-a",
    delegateEmployeeId: "employee-b",
    effectiveFrom: "2026-11-01",
    effectiveUntil: "2026-11-30",
    delegatorMaxLimit: 500_000,
    delegatedLimit: 250_000,
  };

  it("accepts a valid delegation", () => {
    expect(validateDelegation(base)).toHaveLength(0);
  });

  it("refuses to delegate to yourself", () => {
    const issues = validateDelegation({ ...base, delegateEmployeeId: "employee-a" });
    expect(issues.map((issue) => issue.field)).toContain("delegateEmployeeId");
  });

  it("refuses a limit above the delegator's own authority", () => {
    const issues = validateDelegation({ ...base, delegatedLimit: 900_000 });
    expect(issues[0]?.message).toMatch(/cannot exceed/i);
  });

  it("refuses to delegate when the delegator holds no authority", () => {
    const issues = validateDelegation({ ...base, delegatorMaxLimit: null });
    expect(issues[0]?.message).toMatch(/no recorded approval authority/i);
  });

  it("requires an end date after the start date", () => {
    const issues = validateDelegation({ ...base, effectiveUntil: "2026-10-01" });
    expect(issues.map((issue) => issue.field)).toContain("effectiveUntil");
  });

  it("rejects a zero or negative limit", () => {
    expect(validateDelegation({ ...base, delegatedLimit: 0 }).length).toBeGreaterThan(0);
  });

  it("detects a delegation cycle", () => {
    expect(
      wouldCreateDelegationCycle(
        { delegatorEmployeeId: "b", delegateEmployeeId: "a" },
        [{ delegator_employee_id: "a", delegate_employee_id: "b", status: "approved" }],
      ),
    ).toBe(true);
  });

  it("allows a non-cyclic chain", () => {
    expect(
      wouldCreateDelegationCycle(
        { delegatorEmployeeId: "b", delegateEmployeeId: "c" },
        [{ delegator_employee_id: "a", delegate_employee_id: "b", status: "approved" }],
      ),
    ).toBe(false);
  });

  it("treats a closed loop through three people as a cycle", () => {
    expect(
      wouldCreateDelegationCycle(
        { delegatorEmployeeId: "c", delegateEmployeeId: "a" },
        [
          { delegator_employee_id: "a", delegate_employee_id: "b", status: "approved" },
          { delegator_employee_id: "b", delegate_employee_id: "c", status: "approved" },
        ],
      ),
    ).toBe(true);
  });

  it("only counts approved delegations as live", () => {
    const pending = {
      status: "pending_approval" as const,
      effective_from: "2026-11-01T00:00:00Z",
      effective_until: "2026-11-30T00:00:00Z",
    };
    expect(isDelegationLive(pending, new Date("2026-11-15"))).toBe(false);
    expect(isDelegationLive({ ...pending, status: "approved" }, new Date("2026-11-15"))).toBe(true);
    expect(isDelegationLive({ ...pending, status: "approved" }, new Date("2026-12-15"))).toBe(false);
  });

  it("derives an expired status without mutating the record", () => {
    expect(
      effectiveDelegationStatus(
        { status: "approved", effective_until: "2026-01-01T00:00:00Z" },
        new Date("2026-06-01"),
      ),
    ).toBe("expired");
    expect(
      effectiveDelegationStatus(
        { status: "approved", effective_until: "2026-12-01T00:00:00Z" },
        new Date("2026-06-01"),
      ),
    ).toBe("approved");
  });
});

describe("authority helpers", () => {
  it("validates amount ranges", () => {
    expect(validateAuthorityAmounts(0, 1000)).toHaveLength(0);
    expect(validateAuthorityAmounts(5000, 1000).length).toBeGreaterThan(0);
    expect(validateAuthorityAmounts(0, 0).length).toBeGreaterThan(0);
  });

  it("validates the validity window", () => {
    expect(validateAuthorityWindow({ effectiveFrom: "2026-01-01" })).toHaveLength(0);
    expect(
      validateAuthorityWindow({ effectiveFrom: "2026-02-01", effectiveUntil: "2026-01-01" }).length,
    ).toBeGreaterThan(0);
  });

  it("knows when an authority is active", () => {
    expect(
      isAuthorityActive(
        { is_active: true, effective_from: "2026-01-01", effective_until: null },
        new Date("2026-06-01"),
      ),
    ).toBe(true);
    expect(
      isAuthorityActive(
        { is_active: false, effective_from: "2026-01-01", effective_until: null },
        new Date("2026-06-01"),
      ),
    ).toBe(false);
    expect(
      isAuthorityActive(
        { is_active: true, effective_from: "2026-01-01", effective_until: "2026-05-01" },
        new Date("2026-06-01"),
      ),
    ).toBe(false);
  });

  it("returns the highest active limit, or null when nothing is configured", () => {
    expect(highestLimit([], new Date("2026-06-01"))).toBeNull();
    expect(
      highestLimit(
        [
          { maximum_amount: 1000, is_active: true, effective_from: "2026-01-01", effective_until: null },
          { maximum_amount: 9000, is_active: false, effective_from: "2026-01-01", effective_until: null },
          { maximum_amount: 5000, is_active: true, effective_from: "2026-01-01", effective_until: null },
        ],
        new Date("2026-06-01"),
      ),
    ).toBe(5000);
  });

  it("checks that a limit covers an amount", () => {
    expect(authorityCoversAmount({ minimum_amount: 0, maximum_amount: 1000 }, 999)).toBe(true);
    expect(authorityCoversAmount({ minimum_amount: 0, maximum_amount: 1000 }, 1000.01)).toBe(false);
  });
});

describe("access review periods", () => {
  it("validates quarter and month periods", () => {
    expect(isValidReviewPeriod("2026-Q4")).toBe(true);
    expect(isValidReviewPeriod("2026-11")).toBe(true);
    expect(isValidReviewPeriod("2026-Q5")).toBe(false);
    expect(isValidReviewPeriod("2026-13")).toBe(false);
    expect(isValidReviewPeriod("Q4-2026")).toBe(false);
  });

  it("derives the current period from a date", () => {
    expect(currentReviewPeriod(new Date("2026-11-17T00:00:00Z"))).toBe("2026-Q4");
    expect(currentReviewPeriod(new Date("2026-01-05T00:00:00Z"))).toBe("2026-Q1");
  });

  it("labels periods for humans", () => {
    expect(reviewPeriodLabel("2026-Q4")).toBe("Q4 2026");
    expect(reviewPeriodLabel("2026-03")).toBe("March 2026");
  });

  it("lists recent periods newest first", () => {
    expect(recentReviewPeriods(3, new Date("2026-11-17T00:00:00Z"))).toEqual([
      "2026-Q4",
      "2026-Q3",
      "2026-Q2",
    ]);
  });
});

describe("organisation trees", () => {
  const rows = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];

  it("builds a hierarchy with depths", () => {
    const tree = buildTree(rows);
    expect(tree).toHaveLength(2);
    expect(findNode(tree, "c")?.depth).toBe(2);
  });

  it("flattens back to a display order", () => {
    expect(flattenTree(buildTree(rows)).map((node) => node.node.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("lists descendants, which is what forbids a parent cycle", () => {
    expect(descendantIds(buildTree(rows), "a")).toEqual(["b", "c"]);
    expect(descendantIds(buildTree(rows), "c")).toEqual([]);
  });

  it("survives orphaned and cyclic input without hanging", () => {
    const cyclic = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
      { id: "z", parentId: "does-not-exist" },
    ];
    const tree = buildTree(cyclic);
    const flattened = flattenTree(tree).map((node) => node.node.id);
    expect(new Set(flattened).size).toBe(3);
    expect(flattened).toHaveLength(3);
  });
});
