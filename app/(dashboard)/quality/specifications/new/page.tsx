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
import { QUALITY_STAGES, labelForQualityStatus } from "@/lib/quality/statuses";
import { cn } from "@/lib/utils";
import { createSpecificationAction } from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listParameters } from "@/services/quality/specifications";
import { listProducts } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "New specification" };
export const dynamic = "force-dynamic";

/**
 * Create a specification draft (the header only).
 *
 * Parameter lines are added on the specification's own page, one at a time. That is not laziness about the form: the
 * database refuses any line change once a specification is approved, and a single-page grid that half-saves would make
 * "which lines went in" a question the operator has to reconstruct. One line, one confirmed write.
 */
export default async function NewSpecificationPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.specification.create")) {
    return <PermissionGuard permission="quality.specification.create" />;
  }

  const [products, parameters] = await Promise.all([listProducts(), listParameters()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New specification"
        description="A draft version. It judges nothing until it is approved, and approval is refused unless every mandatory parameter carries a limit or an expected value."
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Specifications", href: "/quality/specifications" },
          { label: "New" },
        ]}
        actions={
          <Link href="/quality/specifications" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      {parameters.length === 0 ? (
        <Alert tone="warning" title="No parameters in the catalogue">
          <p>
            A specification is built from the shared parameter catalogue. Add the parameters Pluck Agro actually tests
            for — moisture, purity, foreign matter, colour and so on — before writing a specification. You can still create
            the draft now and add lines once the catalogue has entries.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Specification header</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createSpecificationAction}
            submitLabel="Create draft"
            successMessage="Draft created."
            redirectTo="/quality/specifications"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="productId">Product</Label>
                <Select id="productId" name="productId" required>
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="stage">Stage</Label>
                <Select id="stage" name="stage" required defaultValue="incoming">
                  {QUALITY_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {labelForQualityStatus(stage)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" placeholder="Incoming raw gum arabic" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="methodReference">Method reference</Label>
                <Input
                  id="methodReference"
                  name="methodReference"
                  placeholder="Optional — copied from your own method documentation"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" placeholder="Why this version exists" />
              </div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where the limits come from</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink-muted">
          <p>
            Nothing in this system proposes a moisture limit, a purity figure or a grade definition. Those are commercial
            and technical definitions owned by Pluck Agro; a number invented here would be trusted and then be wrong.
          </p>
          <p>
            A numeric parameter is compared against its window. A text or pass/fail parameter is compared against its
            expected value. An observation is recorded for the reader and carries no verdict. A result with no limit to
            judge against is recorded as <span className="font-medium text-ink">not evaluated</span>, never as a pass.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
