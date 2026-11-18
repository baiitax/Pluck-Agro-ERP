import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { REQUISITION_STATUSES, labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getRequisitions } from "@/services/procurement/requisitions";

export const metadata: Metadata = { title: "Requisitions" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);
const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function RequisitionsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.requisition.view")) {
    return <PermissionGuard permission="procurement.requisition.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const filters = { search: single(params.q), status: single(params.status), priority: single(params.priority), page };
  const { rows, total, pageSize } = await getRequisitions(filters);
  const canCreate = principal.permissions.has("procurement.requisition.create");

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Reference, department or requester…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...REQUISITION_STATUSES.map((status) => ({ value: status, label: labelForStatus(status) })),
      ],
    },
    {
      type: "select",
      name: "priority",
      label: "Priority",
      defaultValue: filters.priority ?? "",
      options: [
        { value: "", label: "Any priority" },
        { value: "urgent", label: "Urgent" },
        { value: "high", label: "High" },
        { value: "normal", label: "Normal" },
        { value: "low", label: "Low" },
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Purchase requisitions"
        description="A requisition asks for goods; it does not commit money. Approval authorises procurement to source the items, and approved quantity is carried forward onto one or more purchase orders."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Requisitions" }]}
        actions={
          canCreate ? (
            <Link href="/procurement/requisitions/new" className={cn(buttonVariants({ size: "sm" }))}>
              New requisition
            </Link>
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/procurement/requisitions" fields={filterFields} />

        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={filters.search || filters.status ? "No requisitions match these filters" : "No requisitions yet"}
            description={
              filters.search || filters.status
                ? "Filters run on the server, so an empty list is a real result. Widen or clear them to see more."
                : canCreate
                  ? "Raise the first requisition to start the sourcing cycle."
                  : "Departments raise requisitions; holders of procurement.requisition.create can add one."
            }
            action={
              canCreate && !filters.search && !filters.status ? (
                <Link href="/procurement/requisitions/new" className={cn(buttonVariants({ size: "sm" }))}>
                  New requisition
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[60rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Department</TH>
                    <TH>Requested by</TH>
                    <TH>Raised</TH>
                    <TH>Required by</TH>
                    <TH className="text-right">Requested</TH>
                    <TH className="text-right">Allocated</TH>
                    <TH className="text-right">Estimated</TH>
                    <TH>Priority</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/procurement/requisitions/${row.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                        <p className="text-[0.6875rem] text-ink-subtle">{row.line_count} line(s)</p>
                      </TD>
                      <TD>{row.department_name ?? "—"}</TD>
                      <TD>{row.requesting_employee ?? "—"}</TD>
                      <TD>{formatDate(row.requisition_date)}</TD>
                      <TD>{formatDate(row.required_delivery_date)}</TD>
                      <TD className="text-right tabular-nums">{qty(row.requested_quantity)}</TD>
                      <TD className="text-right tabular-nums">{qty(row.allocated_quantity)}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, row.estimated_total)}</TD>
                      <TD>
                        <Badge tone={procurementStatusTone(row.priority)}>{labelForStatus(row.priority)}</Badge>
                      </TD>
                      <TD>
                        <Badge tone={procurementStatusTone(row.status)}>{labelForStatus(row.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              baseHref="/procurement/requisitions"
              params={{ q: filters.search, status: filters.status, priority: filters.priority }}
            />
          </>
        )}
      </div>
    </div>
  );
}
