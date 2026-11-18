import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/shared/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { LotLinesEditor } from "@/components/inventory/lot-lines-editor";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createTransferAction } from "@/app/(dashboard)/inventory/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listSelectableLots, listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "New transfer" };
export const dynamic = "force-dynamic";

/**
 * Raise a stock transfer.
 *
 * The source warehouse narrows the lot list, because a transfer can only move stock that is physically in the
 * source warehouse and the database refuses a line that says otherwise. The destination is a separate choice:
 * the destination lot does not exist yet and is created on receipt.
 */
export default async function NewTransferPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.transfer.create")) {
    return <PermissionGuard permission="inventory.transfer.create" />;
  }

  const [warehouses, lots] = await Promise.all([listWarehouses(), listSelectableLots()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New stock transfer"
        description="Pick the source warehouse and the lots to move. Approval comes next, then dispatch posts the stock out of the source lot."
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Transfers", href: "/inventory/transfers" },
          { label: "New" },
        ]}
        actions={
          <Link
            href="/inventory/transfers"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Transfer details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createTransferAction}
            submitLabel="Create draft transfer"
            successMessage="Draft transfer created."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="fromWarehouseId">From warehouse</Label>
                <Select id="fromWarehouseId" name="fromWarehouseId" required defaultValue="">
                  <option value="">Select…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="toWarehouseId">To warehouse</Label>
                <Select id="toWarehouseId" name="toWarehouseId" required defaultValue="">
                  <option value="">Select…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="transferReason">Why is the stock moving?</Label>
                <Input id="transferReason" name="transferReason" placeholder="e.g. consolidation for dispatch" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vehicleReference">Vehicle / waybill</Label>
                <Input id="vehicleReference" name="vehicleReference" />
              </div>
            </div>

            <div className="mt-4 space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-ink">Lots to transfer</p>
              <p className="text-xs text-ink-muted">
                Only lots with availability appear here. Availability already excludes restricted and reserved
                stock, which is why a line cannot promise stock twice.
              </p>
              <LotLinesEditor
                lots={lots}
                emptyHint="No lot has available stock. Receive goods or release a restriction first."
              />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
