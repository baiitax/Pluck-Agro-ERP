import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FileSearch } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getReportDefinition, runReport } from "@/services/procurement/reports";

export const metadata: Metadata = { title: "Procurement report" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

const money = (currency: string | null, value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value ?? "—");
  const formatted = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return currency ? `${currency} ${formatted}` : formatted;
};

const quantity = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value ?? "—");
  return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(amount);
};

/**
 * One report.
 *
 * Values are rendered by the column's declared kind — money, quantity, date, datetime, boolean — rather
 * than by guessing from the value, so an empty numeric column does not render as "0" and a date is not
 * printed as a number. A null is shown as an em dash because "no value" and "zero" are different facts.
 */
export default async function ProcurementReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: SearchParams;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.reports.view")) {
    return <PermissionGuard permission="procurement.reports.view" />;
  }

  const { reportId } = await params;
  const definition = getReportDefinition(reportId);
  if (!definition) notFound();

  const query = await searchParams;
  const filters = {
    from: single(query.from),
    to: single(query.to),
    currency: single(query.currency),
    limit: Number(single(query.limit) ?? "100") || 100,
  };

  const { rows } = await runReport(reportId, filters);

  return (
    <div className="space-y-4">
      <PageHeader
        title={definition.title}
        description={definition.description}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Reports", href: "/procurement/reports" },
          { label: definition.title },
        ]}
        actions={
          <Link
            href="/procurement/reports"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            All reports
          </Link>
        }
      />

      <Alert tone="warning" title="What this report cannot tell you">
        {definition.limitations}
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {definition.dateColumn ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="from">From</Label>
                  <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="to">To</Label>
                  <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-muted sm:col-span-2">
                This report has no date column, so no date filter is offered — a date filter here would silently return
                nothing.
              </p>
            )}
            {definition.currencyColumn ? (
              <div className="space-y-1">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  name="currency"
                  maxLength={3}
                  className="uppercase"
                  defaultValue={filters.currency ?? ""}
                  placeholder="Any"
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="limit">Rows</Label>
              <Input id="limit" name="limit" type="number" min={10} max={500} defaultValue={String(filters.limit)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                Apply filters
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="erp-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="This report returned no rows"
            description="The filters run in the database, so an empty result is a real answer: nothing matches the period or currency you chose. Widen the dates to check."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
              <p className="text-xs text-ink-muted">
                {rows.length} row(s) · {definition.view}
              </p>
              <p className="text-[0.6875rem] text-ink-subtle">Results are capped; they are not a full export.</p>
            </div>
            <TableWrapper>
              <Table className="min-w-[60rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    {definition.columns.map((column) => (
                      <TH key={column.key} className={column.kind === "money" || column.kind === "quantity" ? "text-right" : undefined}>
                        {column.label}
                      </TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row, index) => (
                    <TR key={index}>
                      {definition.columns.map((column) => {
                        const value = row[column.key];
                        const currency =
                          definition.currencyColumn && row[definition.currencyColumn] !== undefined
                            ? (row[definition.currencyColumn] as string | null)
                            : null;

                        if (value === null || value === undefined) {
                          return (
                            <TD key={column.key} className="text-ink-subtle">
                              —
                            </TD>
                          );
                        }

                        return (
                          <TD
                            key={column.key}
                            className={
                              column.kind === "money" || column.kind === "quantity" ? "text-right tabular-nums" : "text-xs"
                            }
                          >
                            {column.kind === "money"
                              ? money(currency, value)
                              : column.kind === "quantity"
                                ? quantity(value)
                                : column.kind === "date"
                                  ? formatDate(String(value))
                                  : column.kind === "datetime"
                                    ? formatDateTime(String(value))
                                    : column.kind === "bool"
                                      ? value
                                        ? "Yes"
                                        : "No"
                                      : String(value)}
                          </TD>
                        );
                      })}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </>
        )}
      </div>
    </div>
  );
}
