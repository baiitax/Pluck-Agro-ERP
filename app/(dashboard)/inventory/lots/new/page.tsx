import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/shared/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createLotAction } from "@/app/(dashboard)/inventory/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listProducts, listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Register a lot" };
export const dynamic = "force-dynamic";

/**
 * Register a lot by hand.
 *
 * This exists for opening balances — stock the company already holds when the system starts, or stock that
 * arrives outside procurement. Everything else (receipts, transfers, production output) creates its own lot
 * with its own provenance, which is better evidence than a lot somebody typed.
 */
export default async function NewLotPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.lot.create")) {
    return <PermissionGuard permission="inventory.lot.create" />;
  }

  const [warehouses, products] = await Promise.all([listWarehouses(), listProducts()]);
  const today = new Date().toISOString().slice(0, 10);
  const canPost = principal.permissions.has("inventory.stock.post");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Register a lot"
        description="A lot is the identity of a quantity. Registering one by hand is for opening balances; everything else should arrive through the document that brought the goods."
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Lots", href: "/inventory/lots" },
          { label: "New" },
        ]}
        actions={
          <Link href="/inventory/lots" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      <Alert tone="info" title="An opening quantity is a movement">
        <p>
          If you enter a quantity, it is posted as an <span className="font-medium">opening balance</span>{" "}
          movement, which appears in the register and can be reversed like any other movement. That is the
          point: it leaves a trail instead of a number that appeared from nowhere.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Lot details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createLotAction} submitLabel="Register lot" successMessage="Lot registered.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="productId">Product</Label>
                <Select id="productId" name="productId" required defaultValue="">
                  <option value="">Select…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="unitId">Unit</Label>
                <Select id="unitId" name="unitId" required defaultValue="">
                  <option value="">Select…</option>
                  {Array.from(new Map(products.map((p) => [p.unitId, p])).values()).map((product) => (
                    <option key={product.unitId} value={product.unitId}>
                      Base unit of {product.label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-ink-subtle">Use the product&apos;s base unit; conversions live in master data.</p>
              </div>
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
                <Label htmlFor="receivedDate">Received date</Label>
                <Input id="receivedDate" name="receivedDate" type="date" defaultValue={today} required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="manufactureDate">Manufacture date</Label>
                <Input id="manufactureDate" name="manufactureDate" type="date" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="expiryDate">Expiry date</Label>
                <Input id="expiryDate" name="expiryDate" type="date" className="h-9" />
                <p className="text-xs text-ink-subtle">Optional. A lot without an expiry is not assumed to last for ever.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="grade">Grade</Label>
                <Input id="grade" name="grade" placeholder="Whatever the factory calls it" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="openingQuantity">Opening quantity</Label>
                <Input
                  id="openingQuantity"
                  name="openingQuantity"
                  inputMode="decimal"
                  disabled={!canPost}
                  className="h-9"
                />
                {!canPost ? (
                  <p className="text-xs text-ink-subtle">
                    You cannot post movements, so the lot will be created empty.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
