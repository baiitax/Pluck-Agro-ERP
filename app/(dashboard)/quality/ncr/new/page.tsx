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
import { NCR_SEVERITIES, NCR_SOURCES, labelForQualityStatus } from "@/lib/quality/statuses";
import { cn } from "@/lib/utils";
import { createNcrAction } from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Raise a non-conformance" };
export const dynamic = "force-dynamic";

/** Raise a non-conformance. The description is required to be substantial: a one-word NCR investigates nothing. */
export default async function NewNcrPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.ncr.create")) {
    return <PermissionGuard permission="quality.ncr.create" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Raise a non-conformance"
        description="Records what did not meet a requirement. This is about the process, not the stock — the stock decision is the disposition."
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Non-conformance", href: "/quality/ncr" },
          { label: "New" },
        ]}
        actions={
          <Link href="/quality/ncr" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Non-conformance</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createNcrAction} submitLabel="Raise" successMessage="Non-conformance raised." redirectTo="/quality/ncr">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required placeholder="Moisture excursion on incoming gum" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="description">What happened</Label>
                <Input
                  id="description"
                  name="description"
                  required
                  placeholder="At least 20 characters: what was observed, when, and against which requirement"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="severity">Severity</Label>
                <Select id="severity" name="severity" defaultValue="major" required>
                  {NCR_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {labelForQualityStatus(severity)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="source">Source</Label>
                <Select id="source" name="source" defaultValue="inspection" required>
                  {NCR_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {labelForQualityStatus(source)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="lotId">Lot id (optional)</Label>
                <Input id="lotId" name="lotId" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inspectionId">Inspection id (optional)</Label>
                <Input id="inspectionId" name="inspectionId" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="containmentAction">Immediate containment</Label>
                <Input id="containmentAction" name="containmentAction" placeholder="What was done straight away to stop it spreading" />
              </div>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Alert tone="info" title="Root cause is not guessed">
        <p>
          The investigation fields stay empty until a person fills them in. The system will not propose a root cause, and
          closing an NCR requires the actions on it to be complete or cancelled first.
        </p>
      </Alert>
    </div>
  );
}
