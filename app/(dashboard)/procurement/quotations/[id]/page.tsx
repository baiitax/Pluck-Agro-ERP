import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getQuotationDetail } from "@/services/procurement/quotations";

export const metadata: Metadata = { title: "Quotation" };
export const dynamic = "force-dynamic";

const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);
const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.quotation.view")) {
    return <PermissionGuard permission="procurement.quotation.view" />;
  }

  const { id } = await params;
  const detail = await getQuotationDetail(id).catch(() => null);
  if (!detail) notFound();

  const { quotation, items, supplier, requisition, comparisonIds } = detail;

  return (
    <div className="space-y-4">
      <PageHeader
        title={quotation.reference}
        description={`Offer from ${supplier?.legal_name ?? "a supplier"}`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Quotations", href: "/procurement/quotations" },
          { label: quotation.reference },
        ]}
        actions={<Badge tone={procurementStatusTone(quotation.status)}>{labelForStatus(quotation.status)}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quoted lines</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>#</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH>Unit</TH>
                    <TH className="text-right">Unit price</TH>
                    <TH className="text-right">Discount</TH>
                    <TH className="text-right">Line total</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((item, index) => (
                    <TR key={`${item.line_number}-${index}`}>
                      <TD className="text-ink-muted">{item.line_number}</TD>
                      <TD className="font-medium text-ink">{item.product_description}</TD>
                      <TD className="text-right tabular-nums">{qty(item.quantity)}</TD>
                      <TD>—</TD>
                      <TD className="text-right tabular-nums">{money(quotation.currency_code, item.unit_price)}</TD>
                      <TD className="text-right tabular-nums">{money(quotation.currency_code, (item as unknown as { discount_amount: number }).discount_amount)}</TD>
                      <TD className="text-right tabular-nums font-medium">
                        {money(quotation.currency_code, (item as unknown as { line_total: number }).line_total)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Offer details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[
              ["Supplier", supplier?.legal_name ?? "—"],
              ["Supplier status", supplier ? labelForStatus(supplier.status) : "—"],
              ["Verification", supplier ? labelForStatus(supplier.verification_status) : "—"],
              ["Supplier reference", quotation.supplier_quotation_reference ?? "—"],
              ["Quoted", formatDate(quotation.quotation_date)],
              ["Valid until", formatDate(quotation.valid_until)],
              ["Lead time", quotation.delivery_lead_time_days === null ? "Not stated" : `${quotation.delivery_lead_time_days} days`],
              ["Payment terms", quotation.payment_terms_snapshot ?? "Not stated"],
              ["Delivery terms", quotation.delivery_terms_snapshot ?? "Not stated"],
              ["Requisition", requisition?.reference ?? "Not linked"],
              ["Subtotal", money(quotation.currency_code, quotation.subtotal)],
              ["Delivery charges", money(quotation.currency_code, quotation.delivery_charges)],
              ["Other charges", money(quotation.currency_code, quotation.other_charges)],
              ["Discount", money(quotation.currency_code, quotation.discount_amount)],
              ["Total", money(quotation.currency_code, quotation.total_amount)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <span className="text-ink-muted">{label}</span>
                <span className="text-right font-medium text-ink">{value}</span>
              </div>
            ))}
            {quotation.charge_notes ? (
              <p className="border-t border-border pt-2 text-xs text-ink-muted">{quotation.charge_notes}</p>
            ) : null}
            {requisition ? (
              <Link
                href={`/procurement/requisitions/${requisition.id}`}
                className="block pt-1 text-xs font-medium text-brand-700 hover:underline"
              >
                Open requisition {requisition.reference}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comparisons</CardTitle>
        </CardHeader>
        <CardContent>
          {comparisonIds.length === 0 ? (
            <p className="text-xs text-ink-muted">
              This quotation has not been put into a comparison. {principal.permissions.has("procurement.quotation.compare")
                ? "Open the comparison workspace to weigh it against other offers."
                : "A holder of procurement.quotation.compare builds the comparison."}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {comparisonIds.map((comparisonId) => (
                <li key={comparisonId}>
                  <Link href={`/procurement/quotations/comparisons/${comparisonId}`} className="text-brand-700 hover:underline">
                    Open comparison
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
