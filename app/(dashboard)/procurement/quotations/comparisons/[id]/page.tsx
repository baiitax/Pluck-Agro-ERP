import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/procurement/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForStatus } from "@/lib/procurement/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getComparisonDetail } from "@/services/procurement/quotations";
import { selectQuotationAction } from "../../../actions";

export const metadata: Metadata = { title: "Comparison" };
export const dynamic = "force-dynamic";

const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

/**
 * One comparison: the offers, the analysis, and the decision.
 *
 * The lowest price is marked on the row it belongs to and nowhere else. There is no "recommended"
 * badge and no default selection, because either would turn a comparison screen into an automatic
 * award. When the chosen offer is not the cheapest, the panel states that plainly and keeps the
 * justification beside it.
 */
export default async function ComparisonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.quotation.compare")) {
    return <PermissionGuard permission="procurement.quotation.compare" />;
  }

  const { id } = await params;
  const detail = await getComparisonDetail(id).catch(() => null);
  if (!detail) notFound();

  const { comparison, offers, selection, requisition, settings } = detail;
  const canSelect = principal.permissions.has("procurement.quotation.select") && !selection;
  const lowest = offers.find((offer) => offer.is_lowest_price);
  const supplierHealthy = (offer: { supplier_status: string; verification_status: string }) =>
    offer.supplier_status === "active" && offer.verification_status === "verified";

  return (
    <div className="space-y-4">
      <PageHeader
        title={comparison.title}
        description={requisition ? `Against requisition ${requisition.reference}` : "Not linked to a requisition"}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Quotations", href: "/procurement/quotations" },
          { label: "Comparisons", href: "/procurement/quotations/comparisons" },
          { label: comparison.title },
        ]}
        actions={
          selection ? (
            <Badge tone="success">Selection recorded</Badge>
          ) : (
            <Badge tone="info">Awaiting a decision</Badge>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Offers compared</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrapper>
            <Table className="min-w-[54rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Quotation</TH>
                  <TH>Supplier</TH>
                  <TH>Supplier standing</TH>
                  <TH className="text-right">Total at comparison</TH>
                  <TH>Lead time</TH>
                  <TH>Valid until</TH>
                  <TH>Price position</TH>
                  <TH>Decision</TH>
                </TR>
              </THead>
              <TBody>
                {offers.map((offer) => (
                  <TR key={offer.quotation_id} className={offer.is_selected ? "bg-brand-50/60" : undefined}>
                    <TD className="font-medium text-ink">{offer.quotation_reference}</TD>
                    <TD>{offer.supplier_name}</TD>
                    <TD>
                      <Badge tone={supplierHealthy(offer) ? "success" : "warning"}>
                        {labelForStatus(offer.supplier_status)} · {labelForStatus(offer.verification_status)}
                      </Badge>
                    </TD>
                    <TD className="text-right tabular-nums font-medium">
                      {money(offer.currency_code, offer.total_at_comparison)}
                    </TD>
                    <TD>{offer.lead_time_days_at_comparison === null ? "Not stated" : `${offer.lead_time_days_at_comparison} days`}</TD>
                    <TD>{formatDate(offer.validity_at_comparison)}</TD>
                    <TD>
                      {offer.is_lowest_price ? <Badge tone="info">Lowest price</Badge> : <span className="text-xs text-ink-muted">—</span>}
                    </TD>
                    <TD>
                      {offer.is_selected ? (
                        <Badge tone="success">Selected</Badge>
                      ) : selection ? (
                        <span className="text-xs text-ink-muted">Not selected</span>
                      ) : (
                        <span className="text-xs text-ink-subtle">Open</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>

      {lowest ? (
        <Alert tone="info" title="Lowest price is information, not an instruction">
          {money(lowest.currency_code, lowest.total_at_comparison)} from {lowest.supplier_name} is the cheapest offer
          among those compared. Choosing any other offer is allowed — it simply has to be explained.
        </Alert>
      ) : null}

      {selection ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selection.selected_was_lowest ? "success" : "warning"}>
                {selection.selected_was_lowest ? "Lowest price selected" : "A higher offer was selected"}
              </Badge>
              <span className="text-xs text-ink-subtle">Recorded {formatDateTime(selection.decided_at)}</span>
            </div>
            <p className="font-medium text-ink">Justification</p>
            <p className="text-ink-muted">{selection.justification}</p>
            <FieldHint>
              The lowest-price quotation at the time of the decision is stored on the selection, so the comparison this
              decision was made against cannot be restated later.
            </FieldHint>
          </CardContent>
        </Card>
      ) : canSelect ? (
        <Card>
          <CardHeader>
            <CardTitle>Record the selection</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={selectQuotationAction}
              submitLabel="Record decision"
              successMessage="Selection recorded."
              hidden={{ comparisonId: comparison.id }}
            >
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label htmlFor="selectedQuotationId">Selected offer</Label>
                  <Select id="selectedQuotationId" name="selectedQuotationId" required defaultValue="">
                    <option value="">Choose the offer being selected…</option>
                    {offers.map((offer) => (
                      <option key={offer.quotation_id} value={offer.quotation_id}>
                        {offer.quotation_reference} · {offer.supplier_name} ·{" "}
                        {money(offer.currency_code, offer.total_at_comparison)}
                        {offer.is_lowest_price ? " (lowest)" : ""}
                      </option>
                    ))}
                  </Select>
                  <FieldHint>No offer is preselected. The decision is yours to record.</FieldHint>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="justification">Justification</Label>
                  <Textarea
                    id="justification"
                    name="justification"
                    rows={3}
                    required
                    placeholder="Why this supplier, considering price, lead time, quality history and risk."
                  />
                  {settings.quotationSelectionRequiresJustification ? (
                    <FieldHint>
                      Policy requires a written justification for every selection. It is stored with the decision and
                      appears in the quotation comparison report.
                    </FieldHint>
                  ) : (
                    <FieldHint>Policy currently does not require a justification, but it is always stored.</FieldHint>
                  )}
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : (
        <Alert tone="warning" title="You cannot record a selection">
          Recording the supplier decision needs procurement.quotation.select.{" "}
          {selection ? "" : "The comparison remains available for review."}
        </Alert>
      )}

      {comparison.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-muted">{comparison.notes}</p>
            {comparison.currency_note ? (
              <p className="mt-1 text-xs text-ink-subtle">{comparison.currency_note}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
