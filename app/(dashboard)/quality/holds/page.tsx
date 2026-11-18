import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { placeHoldAction, releaseHoldAction } from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listHolds } from "@/services/quality/dispositions";

export const metadata: Metadata = { title: "Quality holds" };
export const dynamic = "force-dynamic";

const amount = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

/**
 * Open quality holds.
 *
 * The `Restriction` column is the honest answer to "did this hold actually stop the stock being used". A hold whose
 * inventory restriction failed shows `Restriction FAILED` with the database's own explanation, and there is no release
 * button for it, because there is nothing to release.
 */
export default async function HoldsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.disposition.view")) {
    return <PermissionGuard permission="quality.disposition.view" />;
  }

  const holds = await listHolds();
  const canHold = principal.permissions.has("quality.disposition.hold");
  const canRelease = principal.permissions.has("quality.disposition.release");
  const failed = holds.filter((hold) => hold.restriction_state === "failed");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quality holds"
        description="Holds take quantity out of availability by creating an inventory restriction. Releasing a hold returns it — and every hold, release and failure is recorded against the lot."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Holds" }]}
      />

      {failed.length > 0 ? (
        <Alert tone="danger" title={`${failed.length} hold(s) did not restrict anything`}>
          <p>
            The inventory side refused these restrictions, so the quantity they were meant to hold is still available.
            They are listed rather than hidden: a hold that restricts nothing is worse than none, because it looks like
            control.
          </p>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        {holds.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No open holds"
            description="Nothing is currently held by quality. Rejected and quarantined quantities appear here while they remain restricted."
          />
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Lot</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Held</TH>
                  <TH className="text-right">Actually restricted</TH>
                  <TH>Reason code</TH>
                  <TH>Statement</TH>
                  <TH>Restriction</TH>
                  <TH>Opened</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {holds.map((hold) => (
                  <TR key={hold.id}>
                    <TD className="font-mono text-xs font-medium text-brand-700">{hold.reference}</TD>
                    <TD className="font-mono text-xs">{hold.lot_reference}</TD>
                    <TD>{hold.product_name}</TD>
                    <TD className="text-right tabular-nums">
                      {amount(hold.quantity)} {hold.unit_code}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {hold.restriction_state === "confirmed" ? amount(hold.restricted_quantity) : "—"}
                    </TD>
                    <TD className="font-mono text-xs">{hold.reason_code}</TD>
                    <TD className="max-w-[20rem] text-xs text-ink-muted" title={hold.failure_reason ?? hold.reason ?? undefined}>
                      {hold.reason}
                      {hold.failure_reason ? (
                        <span className="mt-1 block text-danger-600">{hold.failure_reason}</span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone={qualityTone(hold.restriction_state)} dot>
                        {labelForQualityStatus(hold.restriction_state)}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-ink-muted">{formatDateTime(hold.created_at)}</TD>
                    <TD>
                      {canRelease && hold.restriction_state === "confirmed" ? (
                        <ActionForm
                          action={releaseHoldAction}
                          submitLabel="Release"
                          successMessage="Hold released."
                          hidden={{ holdId: hold.id ?? "" }}
                        >
                          <div className="space-y-1">
                            <Label htmlFor={`reason-${hold.id}`}>Reason</Label>
                            <Input id={`reason-${hold.id}`} name="reason" placeholder="Why the hold can be lifted" required />
                          </div>
                        </ActionForm>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {canHold ? (
        <Card>
          <CardHeader>
            <CardTitle>Place a hold</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-ink-muted">
              A hold may only be placed on quantity that is currently available. If the stock is already restricted, the
              inventory side refuses and the hold is recorded as failed rather than double-counting the same kilos.
            </p>
            <ActionForm action={placeHoldAction} submitLabel="Place hold" successMessage="Hold placed.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="lotId">Lot id</Label>
                  <Input id="lotId" name="lotId" placeholder="Paste the lot id from the stock register" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input id="quantity" name="quantity" inputMode="decimal" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reasonCode">Reason code</Label>
                  <Input id="reasonCode" name="reasonCode" placeholder="investigation, retest, complaint…" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reason">Statement</Label>
                  <Input id="reason" name="reason" placeholder="At least 10 characters" required />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="inspectionId">Inspection id (optional)</Label>
                  <Input id="inspectionId" name="inspectionId" placeholder="Links the hold to an inspection" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
