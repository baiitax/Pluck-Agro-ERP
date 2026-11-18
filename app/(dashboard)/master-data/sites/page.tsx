import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveSiteAction } from "@/app/(dashboard)/master-data/actions";
import { SITE_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getSites } from "@/services/master-data/locations";

export const metadata: Metadata = { title: "Sites" };
export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.sites.view");
  if (!allowed) return <PermissionGuard permission="master_data.sites.view" />;

  const sites = await getSites();
  const canManage = principal.permissions.has("master_data.sites.manage");

  const fields = [
    { name: "siteCode", label: "Site code", required: true },
    { name: "name", label: "Site name", required: true },
    { name: "siteType", label: "Site type", type: "select" as const, required: true, options: SITE_TYPES.map((type) => ({ value: type, label: labelFor(type) })) },
    { name: "country", label: "Country", required: true },
    { name: "stateRegion", label: "State / region" },
    { name: "city", label: "City" },
    { name: "contactPerson", label: "Contact person" },
    { name: "contactPhone", label: "Contact phone" },
    { name: "address", label: "Address", type: "textarea" as const, wide: true },
    { name: "description", label: "Description", type: "textarea" as const, wide: true },
    { name: "isActive", label: "Active", type: "checkbox" as const },
  ];

  return (
    <div>
      <PageHeader
        title="Sites"
        description="Physical and organisational locations: offices, factories, warehouses and collection centres. A site is the parent of warehouses; it is not itself a storage area."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Sites" }]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="New site"
              description="Records where the business operates. No stock is held at a site directly."
              triggerLabel="New site"
              action={saveSiteAction}
              fields={fields}
              values={{ siteType: "warehouse", isActive: true }}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        {sites.length === 0 ? (
          <EmptyState icon={Building2} title="No sites recorded" description="Add the legal or operational locations first; warehouses are then attached to a site." />
        ) : (
          <TableWrapper>
            <Table className="min-w-[48rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Site</TH>
                  <TH>Code</TH>
                  <TH>Type</TH>
                  <TH>Location</TH>
                  <TH>Warehouses</TH>
                  <TH>Status</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {sites.map((site) => (
                  <TR key={site.id}>
                    <TD className="text-xs font-semibold text-ink">
                      {site.name}
                      {site.description ? <span className="block text-[0.6875rem] font-normal text-ink-subtle">{site.description}</span> : null}
                    </TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{site.site_code}</TD>
                    <TD className="text-xs">{labelFor(site.site_type)}</TD>
                    <TD className="text-xs">
                      {[site.city, site.state_region, site.country].filter(Boolean).join(", ") || "—"}
                    </TD>
                    <TD className="text-xs">{site.warehouse_count}</TD>
                    <TD>
                      <Badge tone={site.is_active ? "success" : "neutral"} dot>
                        {site.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canManage ? (
                      <TD className="text-right">
                        <RecordFormDialog
                          title={`Edit ${site.name}`}
                          description="Deactivating a site does not delete its warehouses; they must be reassigned or deactivated separately."
                          triggerLabel="Edit"
                          trigger="edit"
                          action={saveSiteAction}
                          hidden={{ id: site.id }}
                          fields={fields}
                          values={{
                            siteCode: site.site_code,
                            name: site.name,
                            siteType: site.site_type,
                            country: site.country,
                            stateRegion: site.state_region ?? "",
                            city: site.city ?? "",
                            contactPerson: site.contact_person ?? "",
                            contactPhone: site.contact_phone ?? "",
                            address: site.address ?? "",
                            description: site.description ?? "",
                            isActive: site.is_active,
                          }}
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">{sites.length} site(s) · warehouse counts are per site and exclude storage locations, which belong to a warehouse.</p>
    </div>
  );
}
