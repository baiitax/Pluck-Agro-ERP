import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/shared/action-form";
import { LotLinesEditor } from "@/components/inventory/lot-lines-editor";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createAdjustmentAction } from "@/app/(dashboard)/inventory/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getInventorySettings } from "@/services/inventory/shared";
import { listLots, listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "New stock adjustment" };
export const dynamic = "force-dynamic";

/** Raises a draft adjustment. Nothing reaches the ledger until it is approved and posted. */
export default async function NewAdjustmentPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.adjustment.create")) {
    return <PermissionGuard permission="inventory.adjustment.create" />;
  }

  const [warehouses, lots, settings] = await Promise.all([
    listWarehouses(),
    listLots({ pageSize: 100 }).then((page) =>
      page.rows
        .filter((row) => Number(row.on_hand_quantity) !== 0)
        .map((row) => ({
          id: row.lot_id,
          label: `${row.lot_reference} · ${row.product_code} ${row.product_name} · on hand ${row.on_hand_quantity} ${row.unit_code}`,
          available: Number(row.on_hand_quantity),
        })),
    ),
    getInventorySettings(),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New stock adjustment"
        description="State what is wrong and why. A negative quantity reduces stock, a positive one increases it, and every line becomes a movement when the adjustment is posted."
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Adjustments", href: "/inventory/adjustments" },
          { label: "New" },
        ]}
        actions={
          <Link
            href="/inventory/adjustments"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      <Alert tone="warning" title="If you counted stock, use a stock count instead">
        <p>
          A count compares a frozen system quantity with what was found and records the difference as a
          discovery. An adjustment states a known cause. Recording a discovery as an adjustment hides the
          moment it was discovered.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Adjustment details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createAdjustmentAction}
            submitLabel="Create draft adjustment"
            successMessage="Draft adjustment created."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="warehouseId">Warehouse</Label>
                <Select id="warehouseId" name="warehouseId" required defaultValue="">
                  <option value="">Select…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="adjustmentDate">Adjustment date</Label>
                <Input id="adjustmentDate" name="adjustmentDate" type="date" defaultValue={today} required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reasonCode">Reason code</Label>
                <Input id="reasonCode" name="reasonCode" required placeholder="e.g. spillage, reclassification" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label htmlFor="reason">What happened?</Label>
              <Textarea id="reason" name="reason" rows={2} required minLength={10} />
              <p className="text-xs text-ink-subtle">At least ten characters. This is what an auditor reads first.</p>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-ink">Lines</p>
              <p className="text-xs text-ink-muted">
                Use a negative quantity to reduce stock (spillage, loss) and a positive one to increase it (found
                stock, reclassification).
              </p>
              <LotLinesEditor
                lots={lots}
                quantityFieldName="quantityChange"
                quantityLabel="Change (±)"
                allowNegative
                emptyHint="No lot has a balance to adjust."
              />
            </div>

            <p className="mt-3 text-xs text-ink-muted">
              {settings.adjustmentRequiresApproval
                ? "Approval is required before this can post. The adjustment will sit as a draft until then."
                : "Configuration does not require approval for adjustments. They post when submitted."}
            </p>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
