import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers } from "lucide-react";

import { DetailList } from "@/components/master-data/detail-list";
import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { saveWarehouseLocationAction } from "@/app/(dashboard)/master-data/actions";
import { LOCATION_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getWarehouse, orderedLocations } from "@/services/master-data/locations";

export const metadata: Metadata = { title: "Warehouse" };
export const dynamic = "force-dynamic";

export default async function WarehouseProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { allowed, principal } = await guardMasterDataPage("master_data.warehouses.view");
  if (!allowed) return <PermissionGuard permission="master_data.warehouses.view" />;

  const result = await getWarehouse(id);
  if (!result) notFound();
  const { warehouse, locations } = result;
  const canManage = principal.permissions.has("master_data.warehouse_locations.manage");

  const ordered = orderedLocations(locations);
  const locationOptions = locations
    .filter((location) => location.is_active)
    .map((location) => ({ value: location.id, label: `${location.location_code} — ${location.name}` }));

  return (
    <div>
      <PageHeader
        title={warehouse.name}
        description={`Warehouse ${warehouse.warehouse_code} · ${labelFor(warehouse.warehouse_type)} · ${warehouse.site?.name ?? "no site"}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Warehouses", href: "/master-data/warehouses" },
          { label: warehouse.warehouse_code },
        ]}
        badge={
          <Badge tone={warehouse.is_active ? "success" : "neutral"} dot>
            {warehouse.is_active ? "Active" : "Inactive"}
          </Badge>
        }
        actions={
          <Link href="/master-data/warehouses" className="text-xs font-medium text-brand-700 hover:underline">
            All warehouses
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Details</h2>
          <DetailList
            items={[
              { label: "Code", value: <span className="font-mono">{warehouse.warehouse_code}</span> },
              { label: "Type", value: labelFor(warehouse.warehouse_type) },
              { label: "Site", value: warehouse.site?.name ?? "—" },
              { label: "Manager", value: warehouse.manager ? `${warehouse.manager.first_name} ${warehouse.manager.last_name}` : "—" },
              { label: "City", value: warehouse.city ?? "—" },
              { label: "State / region", value: warehouse.state_region ?? "—" },
              { label: "Country", value: warehouse.country ?? "—" },
              { label: "Contact phone", value: warehouse.contact_phone ?? "—" },
            ]}
          />
          <p className="mt-3 text-[0.6875rem] text-ink-subtle">
            Structure only. Balances, valuations and movements arrive with the inventory phase and will reference these locations by ID.
          </p>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Layers className="size-4 text-ink-subtle" aria-hidden /> Storage locations
              </h2>
              <p className="text-[0.6875rem] text-ink-subtle">Hierarchical: zones contain aisles, aisles contain racks, racks contain bins.</p>
            </div>
            {canManage ? (
              <RecordFormDialog
                title="New storage location"
                description="Locations nest. A location cannot be its own ancestor; the database rejects cycles."
                triggerLabel="New location"
                action={saveWarehouseLocationAction}
                hidden={{ warehouseId: warehouse.id }}
                fields={[
                  { name: "locationCode", label: "Code", required: true },
                  { name: "name", label: "Name", required: true },
                  {
                    name: "locationType",
                    label: "Type",
                    type: "select",
                    required: true,
                    options: LOCATION_TYPES.map((type) => ({ value: type, label: labelFor(type) })),
                  },
                  { name: "parentLocationId", label: "Parent location", type: "select", options: locationOptions },
                  { name: "description", label: "Description", type: "textarea", wide: true },
                  { name: "isActive", label: "Active", type: "checkbox" },
                ]}
                values={{ locationType: "zone", isActive: true }}
              />
            ) : null}
          </div>

          {ordered.length === 0 ? (
            <EmptyState
              title="No storage locations"
              description="A warehouse can exist without a detailed layout. Add zones and bins only when the physical arrangement is known."
            />
          ) : (
            <ul className="divide-y divide-border">
              {ordered.map(({ node, depth }) => (
                <li key={node.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0" style={{ paddingLeft: `${depth * 14}px` }}>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      {depth > 0 ? <span aria-hidden className="text-ink-subtle">└</span> : null}
                      <span className="font-mono text-[0.6875rem] text-ink-muted">{node.location_code}</span>
                      {node.name}
                    </p>
                    <p className="text-[0.6875rem] text-ink-subtle">{labelFor(node.location_type)}</p>
                  </div>
                  <Badge tone={node.is_active ? "success" : "neutral"} dot>
                    {node.is_active ? "Active" : "Inactive"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {locations.length} storage location(s) recorded · hierarchy order is computed from parent links, not from the order rows were entered.
      </p>
    </div>
  );
}
