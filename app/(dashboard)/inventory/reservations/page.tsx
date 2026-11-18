import type { Metadata } from "next";
import Link from "next/link";
import { PackageOpen } from "lucide-react";

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
import { listReservations } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Reservations" };
export const dynamic = "force-dynamic";

const number = (value: number | string) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Claims on available stock.
 *
 * A reservation promises stock without moving it. It reduces availability everywhere in the system, which is
 * what stops the same lot being promised twice — to a sales order and to a production plan at the same time.
 */
export default async function ReservationsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.reservation.view")) {
    return <PermissionGuard permission="inventory.reservation.view" />;
  }

  const reservations = await listReservations(true);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reservations"
        description="Stock promised to another document. Nothing has moved: the goods are still on the shelf, they are simply not free to promise again."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Reservations" }]}
      />

      <Alert tone="info" title="Expiry is enforced on read, not by a job">
        <p>
          A reservation whose expiry has passed stops reducing availability immediately, even before anything
          marks it expired. The reporting sweep tidies the register; it is not what makes the arithmetic correct.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Active claims</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {reservations.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="Nothing is reserved"
              description="No document has claimed stock. Availability equals on hand less restrictions."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH>Warehouse</TH>
                    <TH className="text-right">Claimed</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Held for</TH>
                    <TH>Status</TH>
                    <TH>Expires</TH>
                  </TR>
                </THead>
                <TBody>
                  {reservations.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-mono text-xs">{row.reference}</TD>
                      <TD>
                        <Link
                          href={`/inventory/lots/${row.lot_id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.lot_reference}
                        </Link>
                      </TD>
                      <TD>{row.product_name}</TD>
                      <TD>{row.warehouse_name}</TD>
                      <TD className="text-right tabular-nums">{number(row.quantity)}</TD>
                      <TD className="text-right font-medium tabular-nums">{number(row.outstanding_quantity)}</TD>
                      <TD className="text-xs">
                        {row.reserved_for_module}/{row.reserved_for_type}
                        {row.reserved_for_reference ? ` · ${row.reserved_for_reference}` : ""}
                      </TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.status)} dot>
                          {labelForInventoryStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs">{row.expires_at ? formatDateTime(row.expires_at) : "No expiry"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
