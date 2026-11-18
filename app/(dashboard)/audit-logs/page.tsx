import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Download } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { AUDIT_CATEGORIES, AUDIT_SEVERITIES, getAuditEvents } from "@/services/audit/get-audit-events";
import type { PageSearchParams } from "@/types/common.types";

export const metadata: Metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, BadgeTone> = {
  info: "neutral",
  notice: "info",
  warning: "warning",
  critical: "danger",
};

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function AuditLogsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const principal = await requirePermission("governance.audit.view");

  const params = await searchParams;
  const search = single(params.search) ?? "";
  const category = single(params.category) ?? "";
  const severity = single(params.severity) ?? "";
  const moduleFilter = single(params.module) ?? "";
  const from = single(params.from) ?? "";
  const to = single(params.to) ?? "";
  const page = Number(single(params.page) ?? "1") || 1;

  const events = await getAuditEvents({ search, category, severity, module: moduleFilter, from, to, page, pageSize: 25 });
  const canExport = principal.permissions.has("governance.audit.export");

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries({ search, category, severity, module: moduleFilter, from, to })) {
    if (value) exportQuery.set(key, value);
  }

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Append-only record of every privileged action. Each event carries a stable event id, a category, the acting employee, before/after values, the request id and a severity. Secrets are redacted before they are written."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Governance" }, { label: "Audit trail" }]}
        actions={
          canExport ? (
            <Link
              href={`/api/audit-logs/export${exportQuery.toString() ? `?${exportQuery.toString()}` : ""}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              prefetch={false}
            >
              <Download aria-hidden /> Export CSV
            </Link>
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar
          action="/audit-logs"
          fields={[
            { type: "search", name: "search", label: "Search", placeholder: "Action or description", defaultValue: search },
            {
              type: "select",
              name: "category",
              label: "Category",
              defaultValue: category,
              options: [
                { value: "", label: "All categories" },
                ...AUDIT_CATEGORIES.map((value) => ({ value, label: value.replace(/_/g, " ") })),
              ],
            },
            {
              type: "select",
              name: "severity",
              label: "Severity",
              defaultValue: severity,
              options: [
                { value: "", label: "All severities" },
                ...AUDIT_SEVERITIES.map((value) => ({ value, label: value })),
              ],
            },
          ]}
        />

        {events.rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No audit events match"
            description="Adjust the filters, or widen the date range."
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[56rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>When</TH>
                    <TH>Severity</TH>
                    <TH>Event</TH>
                    <TH>Actor</TH>
                    <TH>Entity</TH>
                    <TH>Description</TH>
                    <TH className="text-right">Detail</TH>
                  </TR>
                </THead>
                <TBody>
                  {events.rows.map((event) => (
                    <TR key={event.id}>
                      <TD className="whitespace-nowrap text-[0.6875rem] text-ink-muted">
                        {formatDateTime(event.created_at)}
                      </TD>
                      <TD>
                        <Badge tone={SEVERITY_TONE[event.severity] ?? "neutral"} dot>
                          {event.severity}
                        </Badge>
                      </TD>
                      <TD className="text-xs">
                        <span className="font-medium text-ink">{event.action}</span>
                        <span className="block text-[0.625rem] text-ink-subtle">
                          {event.event_category?.replace(/_/g, " ") ?? "general"} · {event.module}
                        </span>
                      </TD>
                      <TD className="text-xs">
                        {event.actor_employee
                          ? `${event.actor_employee.first_name} ${event.actor_employee.last_name}`
                          : (event.actor?.display_name ?? "System")}
                      </TD>
                      <TD className="text-[0.6875rem] text-ink-muted">
                        {event.entity_type ?? "—"}
                        {event.entity_id ? (
                          <span className="block font-mono text-[0.625rem]">{event.entity_id.slice(0, 8)}…</span>
                        ) : null}
                      </TD>
                      <TD className="max-w-md text-[0.6875rem] text-ink-muted">{event.description ?? "—"}</TD>
                      <TD className="text-right">
                        <Link
                          href={`/audit-logs/${event.id}`}
                          className="text-[0.6875rem] font-medium text-brand-700 hover:underline"
                        >
                          Open
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>

            <Pagination
              page={events.page}
              pageSize={events.pageSize}
              total={events.total}
              baseHref="/audit-logs"
              params={{ search, category, severity, module: moduleFilter, from, to }}
            />
          </>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {events.total} event(s) recorded. The audit trail is append-only: there is no delete or edit path in the
        application, and RLS grants read-only access.
      </p>
    </div>
  );
}
