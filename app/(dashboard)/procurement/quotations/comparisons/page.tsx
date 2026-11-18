import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { requireActiveProfile } from "@/services/authorization";
import { getComparableQuotations, getComparisons } from "@/services/procurement/quotations";
import { NewComparisonForm } from "./new-comparison-form";

export const metadata: Metadata = { title: "Quotation comparisons" };
export const dynamic = "force-dynamic";

/**
 * Comparison workspace index.
 *
 * The lowest price is displayed on every offer and is never translated into a recommendation. What
 * the screen asks for is a comparison that names the offers considered, and then a decision with a
 * reason attached to it.
 */
export default async function ComparisonsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.quotation.compare")) {
    return <PermissionGuard permission="procurement.quotation.compare" />;
  }

  const [{ rows, total }, comparable] = await Promise.all([getComparisons(), getComparableQuotations()]);
  const canSelect = principal.permissions.has("procurement.quotation.select");
  const canCreate = comparable.length >= 2;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quotation comparisons"
        description="Weigh offers side by side. Price, lead time and validity are shown together, and a decision above the lowest price is recorded as such — with the reason."
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Quotations", href: "/procurement/quotations" },
          { label: "Comparisons" },
        ]}
      />

      <Alert tone="info" title="The cheapest offer does not win automatically">
        Comparison is analysis; selection is a decision. {canSelect
          ? "You can record a selection from a comparison, and the justification is stored with it."
          : "Recording the selection needs procurement.quotation.select."}
      </Alert>

      {canCreate ? (
        <NewComparisonForm
          quotations={comparable.map((quotation) => ({
            id: quotation.id,
            label: `${quotation.reference} · ${quotation.supplier?.legal_name ?? "Unknown supplier"} · ${quotation.currency_code} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2 }).format(quotation.total_amount)}`,
          }))}
        />
      ) : (
        <Alert tone="warning" title="Not enough quotations to compare">
          A meaningful comparison needs at least two open offers. Record another quotation first — comparing a single
          offer would be a formality, not an analysis.
        </Alert>
      )}

      <div className="erp-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No comparisons built yet"
            description="Build a comparison from two or more recorded quotations for the same requirement."
          />
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Title</TH>
                  <TH>Requisition</TH>
                  <TH>Built</TH>
                  <TH>Currency note</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const comparison = row as unknown as {
                    id: string;
                    title: string;
                    comparison_date: string;
                    currency_note: string | null;
                    requisition: { id: string; reference: string } | null;
                  };
                  return (
                    <TR key={comparison.id}>
                      <TD>
                        <Link
                          href={`/procurement/quotations/comparisons/${comparison.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {comparison.title}
                        </Link>
                      </TD>
                      <TD>{comparison.requisition?.reference ?? "—"}</TD>
                      <TD>{formatDate(comparison.comparison_date)}</TD>
                      <TD className="text-ink-muted">{comparison.currency_note ?? "—"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
        )}
        {total > rows.length ? (
          <p className="border-t border-border px-4 py-2 text-[0.6875rem] text-ink-subtle">
            Showing {rows.length} of {total} comparisons.
          </p>
        ) : null}
      </div>
    </div>
  );
}
