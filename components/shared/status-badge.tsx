import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  ACCOUNT_STATUS_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  type AccountStatusValue,
  type EmploymentStatusValue,
} from "@/lib/constants/statuses";

const EMPLOYMENT_TONES: Record<EmploymentStatusValue, BadgeTone> = {
  active: "success",
  probation: "pending",
  on_leave: "pending",
  suspended: "warning",
  resigned: "neutral",
  terminated: "danger",
  retired: "neutral",
};

export function AccountStatusBadge({ status }: { status: AccountStatusValue }) {
  const tone: BadgeTone =
    status === "active"
      ? "success"
      : status === "invited" || status === "pending_setup"
        ? "pending"
        : status === "suspended" || status === "locked"
          ? "warning"
          : "danger";
  return (
    <Badge tone={tone} dot>
      {ACCOUNT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function EmploymentStatusBadge({ status }: { status: EmploymentStatusValue }) {
  return (
    <Badge tone={EMPLOYMENT_TONES[status] ?? "neutral"} dot>
      {EMPLOYMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function ModuleStatusBadge({ status }: { status: "ready" | "planned" }) {
  return (
    <Badge tone={status === "ready" ? "brand" : "neutral"} dot>
      {status === "ready" ? "Available" : "Planned"}
    </Badge>
  );
}
