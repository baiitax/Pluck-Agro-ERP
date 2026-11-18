import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listRestrictions } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Restrictions" };
export const dynamic = "force-dynamic";

const number = (value: number | string) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Everything currently held back.
 *
 * A restriction is the reason `available_quantity` is smaller than on hand, so this page is the answer to
 * "why can I not issue this stock?". Each row states the real quantity still outstanding, the source module
 * that asked for it, and whether it can be released by anyone other than the module that owns it.
 */
export default async function RestrictionsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.restriction.view")) {
    return <PermissionGuard permission="inventory.restriction.view" />;
  }

  const restrictions = await listRestrictions(true);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Restrictions and holds"
        description="Stock that exists but may not be issued. Restrictions are never deleted: they are released, partly or fully, with a reason, and the released quantity stays on the row."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Restrictions" }]}
      />

      <Alert tone="info" title="Who releases what">
        <p>
          A restriction belongs to the module that raised it. Quality releases inspection holds; the
          storekeeper releases count freezes; a quarantine from a goods receipt stays until Quality releases it
          on the lot. Releasing requires its own permission, which is deliberately not the same one that lets
          you create a hold.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>In force</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {restrictions.length === 0 ? (
            <EmptyState
              icon={Lock}
              title="Nothing is restricted"
              description="Every lot's full balance is available, subject to reservations."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Type</TH>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Held</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Source</TH>
                    <TH>Status</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {restrictions.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-mono text-xs">{row.restriction_reference}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.restriction_type)}>
                          {labelForInventoryStatus(row.restriction_type)}
                        </Badge>
                      </TD>
                      <TD>
                        <Link
                          href={`/inventory/lots/${row.lot_id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.lot_reference}
                        </Link>
                      </TD>
                      <TD>{row.product_name}</TD>
                      <TD className="text-right tabular-nums">{number(row.quantity)}</TD>
                      <TD className="text-right font-medium tabular-nums">{number(row.outstanding_quantity)}</TD>
                      <TD className="text-xs">
                        {row.source_module}/{row.source_type}
                      </TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.status)} dot>
                          {labelForInventoryStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs">{formatDateTime(row.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-ink-subtle">
        To release part of a restriction, open its lot from the link above: the release form there names the
        restriction and takes a reason.
      </p>
    </div>
  );
}
