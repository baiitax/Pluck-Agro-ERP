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
import { INSPECTION_TYPES, labelForQualityStatus } from "@/lib/quality/statuses";
import { cn } from "@/lib/utils";
import { createInspectionAction } from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listLots, listUnits } from "@/services/inventory/stock";
import { listSamplingPlans, listSpecifications } from "@/services/quality/specifications";

export const metadata: Metadata = { title: "New inspection" };
export const dynamic = "force-dynamic";

/**
 * Raise an inspection.
 *
 * Only approved specifications are offered — the database refuses an inspection against a draft, because a judgement
 * made against a document nobody approved is not a judgement. The lot list shows what is on hand in each lot, since the
 * whole point of the inspection is to decide whether that quantity may be used.
 */
export default async function NewInspectionPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.inspection.manage")) {
    return <PermissionGuard permission="quality.inspection.manage" />;
  }

  const [specifications, lots, units, plans] = await Promise.all([
    listSpecifications({ status: "approved" }),
    listLots({ page: 1 }),
    listUnits(),
    listSamplingPlans().catch(() => []),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New inspection"
        description="An inspection judges one lot against one approved specification version. Its results decide the lot's disposition, and the disposition decides whether the stock is available."
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Inspections", href: "/quality/inspections" },
          { label: "New" },
        ]}
        actions={
          <Link href="/quality/inspections" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      {specifications.rows.length === 0 ? (
        <Alert tone="warning" title="No approved specification">
          <p>
            An inspection can only be raised against an approved specification. Approve one first — a draft specification
            has no limits in force, so an inspection against it could not decide anything.
          </p>
          <p className="mt-2">
            <Link className="text-brand-700 hover:underline" href="/quality/specifications">
              Go to specifications
            </Link>
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Inspection</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createInspectionAction}
            submitLabel="Raise inspection"
            successMessage="Inspection raised."
            redirectTo="/quality/inspections"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="specificationId">Specification</Label>
                <Select id="specificationId" name="specificationId" required>
                  <option value="">Select an approved specification</option>
                  {specifications.rows.map((specification) => (
                    <option key={specification.id} value={specification.id ?? ""}>
                      {specification.reference} · {specification.product_name} ·{" "}
                      {labelForQualityStatus(specification.stage)} (v{specification.version})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="lotId">Lot</Label>
                <Select id="lotId" name="lotId" required>
                  <option value="">Select a lot</option>
                  {lots.rows.map((lot) => (
                    <option key={lot.lot_id} value={lot.lot_id}>
                      {lot.lot_reference} · {lot.product_name} · {Number(lot.on_hand_quantity).toLocaleString()}{" "}
                      {lot.unit_code} on hand
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="inspectionType">Inspection type</Label>
                <Select id="inspectionType" name="inspectionType" defaultValue="incoming" required>
                  {INSPECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {labelForQualityStatus(type)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="samplingPlanId">Sampling plan</Label>
                <Select id="samplingPlanId" name="samplingPlanId" defaultValue="">
                  <option value="">No plan</option>
                  {(plans ?? []).map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({labelForQualityStatus(plan.stage)})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sampledQuantity">Sampled quantity</Label>
                <Input id="sampledQuantity" name="sampledQuantity" inputMode="decimal" placeholder="e.g. 0.5" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sampleUnitId">Sample unit</Label>
                <Select id="sampleUnitId" name="sampleUnitId" defaultValue="">
                  <option value="">Not stated</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" placeholder="Anything the inspector should know" />
              </div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Alert tone="info" title="What happens next">
        <p>
          Recording results does not decide anything by itself. Submitting computes the summary from the results,
          approval is a separate step and a separate permission, and only then can a disposition be recorded. A release
          disposition is the single path that returns this stock to availability.
        </p>
      </Alert>
    </div>
  );
}
