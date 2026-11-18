import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/shared/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { startBatchAction } from "@/app/(dashboard)/production/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listProducts, listWarehouses } from "@/services/inventory/stock";
import { listPlans } from "@/services/production/plans";

export const metadata: Metadata = { title: "Start a batch" };
export const dynamic = "force-dynamic";

/**
 * Start a batch, either from an approved plan or standalone.
 *
 * Starting from a plan carries the product, quantity and output warehouse across and moves the plan to
 * in progress, which is what keeps a plan from sitting approved while its work happens elsewhere.
 */
export default async function NewBatchPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.batch.create")) {
    return <PermissionGuard permission="production.batch.create" />;
  }

  const [plans, products, warehouses] = await Promise.all([
    listPlans({ status: "approved" }),
    listProducts(),
    listWarehouses(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Start a production batch"
        description="A batch consumes material and produces output. Starting it opens the run; issuing material and recording output are separate, audited acts."
        breadcrumbs={[
          { label: "Production", href: "/production" },
          { label: "Batches", href: "/production/batches" },
          { label: "Start" },
        ]}
        actions={
          <Link
            href="/production/batches"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      {plans.rows.length === 0 ? (
        <Alert tone="info" title="No approved plans">
          <p>
            There is no approved plan to start from, so a batch would have to state its own product and
            quantity. Approve a plan first if the run was planned.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>From an approved plan</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={startBatchAction} submitLabel="Start batch" successMessage="Batch started.">
            <div className="space-y-1">
              <Label htmlFor="planId">Plan</Label>
              <Select id="planId" name="planId" defaultValue="">
                <option value="">No plan — standalone batch</option>
                {plans.rows.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.reference} · {plan.product_name} · {plan.planned_quantity} {plan.unit_code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-3 space-y-1">
              <Label htmlFor="batchDate">Batch date</Label>
              <Input id="batchDate" name="batchDate" type="date" defaultValue={today} className="h-9" />
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standalone batch</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={startBatchAction} submitLabel="Start batch" successMessage="Batch started.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="productId">Product</Label>
                <Select id="productId" name="productId" defaultValue="">
                  <option value="">Select…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="plannedQuantity">Planned quantity</Label>
                <Input id="plannedQuantity" name="plannedQuantity" inputMode="decimal" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="unitId">Unit</Label>
                <Select id="unitId" name="unitId" defaultValue="">
                  <option value="">Select…</option>
                  {Array.from(new Map(products.map((p) => [p.unitId, p])).values()).map((product) => (
                    <option key={product.unitId} value={product.unitId}>
                      Base unit of {product.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouseId">Warehouse</Label>
                <Select id="warehouseId" name="warehouseId" defaultValue="">
                  <option value="">Select…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="standalone-batchDate">Batch date</Label>
                <Input id="standalone-batchDate" name="batchDate" type="date" defaultValue={today} className="h-9" />
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              A standalone batch needs a product, quantity, unit and warehouse — the database refuses one
              without them rather than guessing.
            </p>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
