import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getAuditEvent } from "@/services/audit/get-audit-events";

export const metadata: Metadata = { title: "Audit event" };
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-[0.6875rem] text-ink-subtle">{label}</span>
      <span className="max-w-[65%] break-words text-right text-xs font-medium text-ink">{value}</span>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-subtle">—</span>;
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface-sunken p-2 text-[0.6875rem] leading-relaxed text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function AuditEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("governance.audit.view");
  const { id } = await params;
  const event = await getAuditEvent(id);
  if (!event) notFound();

  return (
    <div>
      <PageHeader
        title={event.action}
        description={event.description ?? "No description recorded for this event."}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Governance" },
          { label: "Audit trail", href: "/audit-logs" },
          { label: "Event" },
        ]}
        actions={
          <Link href="/audit-logs" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back to trail
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Event</CardTitle>
              <CardDescription>Identity and classification</CardDescription>
            </div>
            <Badge
              tone={
                event.severity === "critical"
                  ? "danger"
                  : event.severity === "warning"
                    ? "warning"
                    : event.severity === "notice"
                      ? "info"
                      : "neutral"
              }
              dot
            >
              {event.severity}
            </Badge>
          </CardHeader>
          <CardContent>
            <Row label="Event id" value={<span className="font-mono text-[0.625rem]">{event.event_id}</span>} />
            <Row label="Category" value={event.event_category?.replace(/_/g, " ") ?? "general"} />
            <Row label="Module" value={event.module} />
            <Row label="Action" value={<span className="font-mono">{event.action}</span>} />
            <Row label="Occurred" value={formatDateTime(event.created_at)} />
            <Row label="Request id" value={event.request_id ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Attribution</CardTitle>
              <CardDescription>Who performed the action</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Row
              label="Account"
              value={
                event.actor ? (
                  <Link href={`/administration/users/${event.actor.id}`} className="hover:underline">
                    {event.actor.display_name ?? event.actor.id.slice(0, 8)}
                  </Link>
                ) : (
                  "System / unauthenticated"
                )
              }
            />
            <Row
              label="Employee"
              value={
                event.actor_employee ? (
                  <Link href={`/administration/employees/${event.actor_employee.id}`} className="hover:underline">
                    {event.actor_employee.first_name} {event.actor_employee.last_name} (
                    {event.actor_employee.employee_number})
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Row label="IP address" value={event.ip_address ?? "—"} />
            <Row label="User agent" value={<span className="text-[0.625rem]">{event.user_agent ?? "—"}</span>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Target</CardTitle>
              <CardDescription>What was affected</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Row label="Entity type" value={event.entity_type ?? "—"} />
            <Row label="Entity id" value={<span className="font-mono text-[0.625rem]">{event.entity_id ?? "—"}</span>} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Previous values</CardTitle>
              <CardDescription>State before the change, with secrets redacted.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <JsonBlock value={event.old_values} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>New values</CardTitle>
              <CardDescription>State after the change, with secrets redacted.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <JsonBlock value={event.new_values} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Contextual detail recorded by the service that performed the action.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <JsonBlock value={event.metadata} />
        </CardContent>
      </Card>
    </div>
  );
}
