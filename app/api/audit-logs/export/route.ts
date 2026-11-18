import { NextResponse, type NextRequest } from "next/server";

import { AppError, toAppError } from "@/lib/errors";
import { getAuditEventsForExport } from "@/services/audit/get-audit-events";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "event_id",
  "created_at",
  "severity",
  "event_category",
  "module",
  "action",
  "actor_user_id",
  "actor_employee_id",
  "entity_type",
  "entity_id",
  "description",
  "request_id",
  "ip_address",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Neutralise spreadsheet formula injection and quote the value.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * CSV export of the audit trail.
 *
 * CSV rather than binary Excel so the export is transparent, diffable and free of any library
 * that could embed macros. Exporting is itself an audited action.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requirePermission("governance.audit.export");

    const params = request.nextUrl.searchParams;
    const query = {
      search: params.get("search") ?? undefined,
      category: params.get("category") ?? undefined,
      severity: params.get("severity") ?? undefined,
      module: params.get("module") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    };

    const rows = await getAuditEventsForExport(query);

    const header = COLUMNS.join(",");
    const body = rows
      .map((row) => COLUMNS.map((column) => csvCell((row as Record<string, unknown>)[column])).join(","))
      .join("\r\n");
    const csv = `${header}\r\n${body}\r\n`;

    await recordAuditEvent({
      actorUserId: principal.user.id,
      actorEmployeeId: principal.employee?.id ?? null,
      action: "audit.exported",
      eventCategory: "governance",
      severity: "notice",
      module: "governance",
      entityType: "audit_log",
      description: `Exported ${rows.length} audit event(s) as CSV.`,
      metadata: { filters: query, row_count: rows.length },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      requestId: request.headers.get("x-request-id"),
    });

    const filename = `pluck-agro-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const appError = toAppError(error);
    const status = appError instanceof AppError ? appError.status : 500;
    return NextResponse.json({ error: appError.message }, { status });
  }
}
