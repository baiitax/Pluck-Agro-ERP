import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/shared/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { startCountAction } from "@/app/(dashboard)/inventory/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getInventorySettings } from "@/services/inventory/shared";
import { listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Start a stock count" };
export const dynamic = "force-dynamic";

/** Starts a count and freezes the system quantity for each open lot in the chosen warehouse. */
export default async function NewCountPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.count.execute")) {
    return <PermissionGuard permission="inventory.count.execute" />;
  }

  const [warehouses, settings] = await Promise.all([listWarehouses(), getInventorySettings()]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Start a stock count"
        description="The system quantity is frozen now, per lot. Counting against a frozen figure is what makes the variance mean something."
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Counts", href: "/inventory/counts" },
          { label: "Start" },
        ]}
        actions={
          <Link href="/inventory/counts" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Count details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={startCountAction} submitLabel="Start counting" successMessage="Stock count started.">
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
                <Label htmlFor="countDate">Count date</Label>
                <Input id="countDate" name="countDate" type="date" defaultValue={today} required className="h-9" />
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              {settings.stockCountRequiresApproval
                ? "Approval is required before variances post. Nobody can post their own count and also approve it without the approval permission."
                : "Configuration does not require approval for counts. Variances will post as soon as the count is submitted."}
            </p>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
