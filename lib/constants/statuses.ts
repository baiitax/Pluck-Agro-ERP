/**
 * Employment status and ERP account status are deliberately separate concepts.
 *
 *  - `employees.employment_status` answers "does this person work here, and how".
 *  - `profiles.account_status` answers "can this person sign in to the ERP, and why not".
 *
 * A terminated employee can (and for audit purposes usually does) keep a deactivated account.
 * Conflating the two was the single most common defect in the Phase 0 foundation.
 */

export const EMPLOYMENT_STATUSES = [
  "active",
  "probation",
  "on_leave",
  "suspended",
  "resigned",
  "terminated",
  "retired",
] as const;

export type EmploymentStatusValue = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatusValue, string> = {
  active: "Active",
  probation: "Probation",
  on_leave: "On leave",
  suspended: "Suspended",
  resigned: "Resigned",
  terminated: "Terminated",
  retired: "Retired",
};

/** Statuses that mean the person no longer holds a live working relationship. */
export const EMPLOYMENT_STATUSES_ENDED: readonly EmploymentStatusValue[] = [
  "resigned",
  "terminated",
  "retired",
];

/** Statuses that still count as "on the payroll" for headcount metrics. */
export const EMPLOYMENT_STATUSES_CURRENT: readonly EmploymentStatusValue[] = [
  "active",
  "probation",
  "on_leave",
  "suspended",
];

export function isEmploymentStatus(value: string): value is EmploymentStatusValue {
  return (EMPLOYMENT_STATUSES as readonly string[]).includes(value);
}

export const ACCOUNT_STATUSES = [
  "invited",
  "pending_setup",
  "active",
  "suspended",
  "deactivated",
  "locked",
] as const;

export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatusValue, string> = {
  invited: "Invited",
  pending_setup: "Pending setup",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
  locked: "Locked",
};

/**
 * Mirrors `private.validate_account_status_transition()` in migration 0017.
 * The database is authoritative; this map exists so the UI only offers legal actions.
 */
export const ACCOUNT_STATUS_TRANSITIONS: Record<AccountStatusValue, readonly AccountStatusValue[]> = {
  invited: ["pending_setup", "active", "deactivated"],
  pending_setup: ["active", "deactivated"],
  active: ["suspended", "deactivated", "locked"],
  suspended: ["active", "deactivated"],
  locked: ["active", "deactivated"],
  deactivated: ["active"],
};

export function canTransitionAccountStatus(from: AccountStatusValue, to: AccountStatusValue): boolean {
  return ACCOUNT_STATUS_TRANSITIONS[from].includes(to);
}

export function allowedAccountTransitions(from: AccountStatusValue): readonly AccountStatusValue[] {
  return ACCOUNT_STATUS_TRANSITIONS[from] ?? [];
}

/** Account statuses that block sign-in. Kept next to the transition map so they cannot drift. */
export const ACCOUNT_STATUSES_BLOCKING_SIGN_IN: readonly AccountStatusValue[] = [
  "invited",
  "pending_setup",
  "suspended",
  "deactivated",
  "locked",
];

export const ACCOUNT_ACTIVITY_TYPES = [
  "invited",
  "invitation_resent",
  "activated",
  "suspended",
  "deactivated",
  "reactivated",
  "password_recovery_requested",
  "sessions_revoked",
  "login_succeeded",
  "login_failed",
  "role_assigned",
  "role_revoked",
] as const;

export type AccountActivityType = (typeof ACCOUNT_ACTIVITY_TYPES)[number];

export const ACCOUNT_ACTIVITY_LABELS: Record<AccountActivityType, string> = {
  invited: "Invitation sent",
  invitation_resent: "Invitation resent",
  activated: "Account activated",
  suspended: "Account suspended",
  deactivated: "Account deactivated",
  reactivated: "Account reactivated",
  password_recovery_requested: "Password recovery requested",
  sessions_revoked: "Sessions revoked",
  login_succeeded: "Signed in",
  login_failed: "Failed sign-in",
  role_assigned: "Role assigned",
  role_revoked: "Role revoked",
};
