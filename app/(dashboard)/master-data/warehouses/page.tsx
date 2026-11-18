import type { Metadata } from "next";
import Link from "next/link";
import { Warehouse } from "lucide-react";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveWarehouseAction } from "@/app/(dashboard)/master-data/actions";
import { WAREHOUSE_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getEmployeeOptionsForMasterData, getSiteOptions } from "@/services/master-data/reference-data";
import { getWarehouses } from "@/services/master-data/locations";

export const metadata: Metadata = { title: "Warehouses" };
export const dynamic = "force-dynamic";

export default async function WarehousesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.warehouses.view");
  if (!allowed) return <PermissionGuard permission="master_data.warehouses.view" />;

  const [warehouses, sites, employees] = await Promise.all([getWarehouses(), getSiteOptions(), getEmployeeOptionsForMasterData()]);
  const canManage = principal.permissions.has("master_data.warehouses.manage");

  const fields = [
    { name: "warehouseCode", label: "Warehouse code", required: true },
    { name: "name", label: "Warehouse name", required: true },
    { name: "warehouseType", label: "Type", type: "select" as const, required: true, options: WAREHOUSE_TYPES.map((type) => ({ value: type, label: labelFor(type) })) },
    { name: "siteId", label: "Site", type: "select" as const, required: true, options: sites.map((site) => ({ value: site.id, label: site.label })) },
    {
      name: "managerEmployeeId",
      label: "Manager",
      type: "select" as const,
      options: employees.map((employee) => ({ value: employee.id, label: employee.label })),
    },
    { name: "country", label: "Country" },
    { name: "stateRegion", label: "State / region" },
    { name: "city", label: "City" },
    { name: "contactPhone", label: "Contact phone" },
    { name: "address", label: "Address", type: "textarea" as const, wide: true },
    { name: "description", label: "Description", type: "textarea" as const, wide: true },
    { name: "isActive", label: "Active", type: "checkbox" as const },
  ];

  return (
    <div>
      <PageHeader
        title="Warehouses"
        description="Storage facilities, each attached to a site and subdivided into storage locations. This phase records the physical structure only: no stock quantity, valuation or movement is stored here."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Warehouses" }]}
        actions={
          canManage && sites.length > 0 ? (
            <RecordFormDialog
              title="New warehouse"
              description="A warehouse belongs to exactly one site. Storage locations are added from the warehouse profile."
              triggerLabel="New warehouse"
              action={saveWarehouseAction}
              fields={fields}
              values={{ warehouseType: "general_storage", isActive: true }}
            />
          ) : null
        }
      />

      {sites.length === 0 ? (
        <div className="erp-card">
          <EmptyState
            icon={Warehouse}
            title="Create a site first"
            description="Every warehouse belongs to a site. Without a site there is nowhere to attach it, so the create action is hidden rather than allowed to fail."
          />
        </div>
      ) : (
        <div className="erp-card overflow-hidden">
          {warehouses.length === 0 ? (
            <EmptyState icon={Warehouse} title="No warehouses recorded" description="Add the first warehouse under one of the existing sites." />
          ) : (
            <TableWrapper>
              <Table className="min-w-[48rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Warehouse</TH>
                    <TH>Code</TH>
                    <TH>Type</TH>
                    <TH>Site</TH>
                    <TH>Manager</TH>
                    <TH>Locations</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {warehouses.map((warehouse) => (
                    <TR key={warehouse.id}>
                      <TD>
                        <Link href={`/master-data/warehouses/${warehouse.id}`} className="text-xs font-semibold text-ink hover:text-brand-700">
                          {warehouse.name}
                        </Link>
                        {warehouse.city ? <span className="block text-[0.6875rem] text-ink-subtle">{warehouse.city}</span> : null}
                      </TD>
                      <TD className="font-mono text-[0.6875rem] text-ink-muted">{warehouse.warehouse_code}</TD>
                      <TD className="text-xs">{labelFor(warehouse.warehouse_type)}</TD>
                      <TD className="text-xs">{warehouse.site?.name ?? "—"}</TD>
                      <TD className="text-xs">{warehouse.manager ? `${warehouse.manager.first_name} ${warehouse.manager.last_name}` : "—"}</TD>
                      <TD className="text-xs">{warehouse.location_count}</TD>
                      <TD>
                        <Badge tone={warehouse.is_active ? "success" : "neutral"} dot>
                          {warehouse.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </div>
      )}

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {warehouses.length} warehouse(s) · a warehouse with storage locations cannot be deactivated until those locations are closed.
      </p>
    </div>
  );
}
