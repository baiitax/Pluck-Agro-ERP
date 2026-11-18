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
import { createPlanAction } from "@/app/(dashboard)/production/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getProductionConfiguration } from "@/services/inventory/dashboard";
import { listProducts, listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "New production plan" };
export const dynamic = "force-dynamic";

/**
 * Create a production plan.
 *
 * The checkbox copies the company's declared inputs onto the plan. If no input has been declared for the
 * product the plan will simply have no requirement lines — and the page says so before the form is submitted,
 * rather than leaving an empty section that looks like a fault.
 */
export default async function NewPlanPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.plan.create")) {
    return <PermissionGuard permission="production.plan.create" />;
  }

  const [products, warehouses, configuration] = await Promise.all([
    listProducts(),
    listWarehouses(),
    getProductionConfiguration().catch(() => null),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const declaredInputs = configuration?.inputs.length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="New production plan"
        description="State what is to be made, how much, and where the output will be stored. Approval follows, then the store reserves material per lot."
        breadcrumbs={[
          { label: "Production", href: "/production" },
          { label: "Plans", href: "/production/plans" },
          { label: "New" },
        ]}
        actions={
          <Link href="/production/plans" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      {declaredInputs === 0 ? (
        <Alert tone="warning" title="No material input has been declared">
          <p>
            The configuration holds no declared input for any product, so copying the requirement will produce
            nothing to reserve. Declare the input quantities the factory uses — the system will scale them, but
            it cannot know them.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Plan details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createPlanAction} submitLabel="Create plan" successMessage="Production plan created.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="productId">Product to produce</Label>
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
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouseId">Output warehouse</Label>
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
                <Label htmlFor="plannedQuantity">Planned quantity</Label>
                <Input id="plannedQuantity" name="plannedQuantity" inputMode="decimal" required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plannedDate">Planned date</Label>
                <Input id="plannedDate" name="plannedDate" type="date" defaultValue={today} required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plannedEndDate">Planned end date</Label>
                <Input id="plannedEndDate" name="plannedEndDate" type="date" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="priority">Priority</Label>
                <Select id="priority" name="priority" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sourceReference">Source reference</Label>
                <Input id="sourceReference" name="sourceReference" placeholder="Order or request this answers" />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="applyDeclaredInputs" defaultChecked={declaredInputs > 0} />
              Copy the declared material requirements onto this plan
            </label>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
