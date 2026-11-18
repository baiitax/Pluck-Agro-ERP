import type { Metadata } from "next";
import { History } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { entityLabel, getMasterDataHistory } from "@/services/master-data/history";

export const metadata: Metadata = { title: "Master data history" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : (value ?? undefined));

const ENTITY_OPTIONS = ["supplier", "customer", "product", "product_variant", "site", "warehouse", "warehouse_location"];

export default async function MasterDataHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await guardMasterDataPage("master_data.history.view");
  if (!allowed) return <PermissionGuard permission="master_data.history.view" />;

  const params = await searchParams;
  const filters = {
    entityType: single(params.entity),
    changeType: single(params.change),
    from: single(params.from),
    to: single(params.to),
    page: Number(single(params.page) ?? "1") || 1,
    pageSize: 25,
  };

  const { rows, total, pageSize } = await getMasterDataHistory(filters);

  const filterFields: FilterField[] = [
    {
      type: "select",
      name: "entity",
      label: "Entity",
      defaultValue: filters.entityType ?? "",
      options: [{ value: "", label: "All entities" }, ...ENTITY_OPTIONS.map((entity) => ({ value: entity, label: entityLabel(entity) }))],
    },
    {
      type: "select",
      name: "change",
      label: "Change",
      defaultValue: filters.changeType ?? "",
      options: [
        { value: "", label: "All changes" },
        { value: "created", label: "Created" },
        { value: "updated", label: "Updated" },
        { value: "activated", label: "Activated" },
        { value: "deactivated", label: "Deactivated" },
        { value: "blocked", label: "Blocked" },
        { value: "archived", label: "Archived" },
        { value: "verified", label: "Verified" },
        { value: "merged", label: "Merged" },
      ],
    },
    { type: "search", name: "from", label: "From (YYYY-MM-DD)", defaultValue: filters.from },
    { type: "search", name: "to", label: "To (YYYY-MM-DD)", defaultValue: filters.to },
  ];

  return (
    <div>
      <PageHeader
        title="Master data change history"
        description="A record-level trail written by database triggers on every master table. It records what exactly changed, by whom, in addition to the governance audit log."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Change history" }]}
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/master-data/history" fields={filterFields} />
        {rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="No changes recorded"
            description="Either nothing has been modified yet, or the filters exclude everything. History is only written when a record actually changes."
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>When</TH>
                  <TH>Entity</TH>
                  <TH>Record</TH>
                  <TH>Change</TH>
                  <TH>Fields</TH>
                  <TH>Actor</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="text-[0.6875rem] text-ink-subtle">{new Date(row.created_at).toLocaleString("en-GB")}</TD>
                    <TD className="text-xs">{entityLabel(row.entity_type)}</TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{row.entity_reference ?? row.entity_id}</TD>
                    <TD>
                      <Badge tone={row.change_type === "created" ? "info" : row.change_type === "archived" ? "neutral" : "neutral"} dot>
                        {labelFor(row.change_type)}
                      </Badge>
                    </TD>
                    <TD className="text-[0.6875rem] text-ink-muted">{row.changed_fields.join(", ") || "—"}</TD>
                    <TD className="text-xs">
                      {row.actor_employee
                        ? `${row.actor_employee.first_name} ${row.actor_employee.last_name}`
                        : row.actor?.display_name ?? "System"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
        {total > pageSize ? (
          <Pagination
            page={filters.page}
            pageSize={pageSize}
            total={total}
            baseHref="/master-data/history"
            params={{ entity: filters.entityType, change: filters.changeType, from: filters.from, to: filters.to }}
          />
        ) : null}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {total} change record(s). The trail is append-only: history rows are never edited or deleted by the application.
      </p>
    </div>
  );
}
