import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveExchangeRateAction } from "@/app/(dashboard)/master-data/actions";
import { EXCHANGE_RATE_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getCurrencies, getExchangeRates } from "@/services/master-data/commercial";

export const metadata: Metadata = { title: "Exchange rates" };
export const dynamic = "force-dynamic";

export default async function ExchangeRatesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.exchange_rates.view");
  if (!allowed) return <PermissionGuard permission="master_data.exchange_rates.view" />;

  const [rates, currencies] = await Promise.all([getExchangeRates(), getCurrencies()]);
  const canManage = principal.permissions.has("master_data.exchange_rates.manage");

  const currencyOptions = currencies.map((currency) => ({ value: currency.code, label: `${currency.code} — ${currency.name}` }));

  const fields = [
    { name: "baseCurrencyCode", label: "Base currency", type: "select" as const, required: true, options: currencyOptions },
    { name: "quoteCurrencyCode", label: "Quote currency", type: "select" as const, required: true, options: currencyOptions },
    { name: "exchangeRate", label: "Rate (1 base = ? quote)", required: true, step: "any", hint: "Stored as NUMERIC. Entered from a recorded source, never estimated." },
    {
      name: "rateType",
      label: "Rate type",
      type: "select" as const,
      required: true,
      options: EXCHANGE_RATE_TYPES.map((type) => ({ value: type, label: labelFor(type) })),
      hint: "The type is explicit because official, treasury, commercial and customs rates differ.",
    },
    { name: "rateDate", label: "Rate date", type: "date" as const, required: true },
    { name: "effectiveFrom", label: "Effective from", type: "date" as const, required: true },
    { name: "effectiveUntil", label: "Effective until", type: "date" as const },
    { name: "rateSource", label: "Source", hint: "Where the rate came from, so it can be checked later." },
    { name: "notes", label: "Notes", type: "textarea" as const, wide: true },
  ];

  return (
    <div>
      <PageHeader
        title="Exchange rates"
        description="Dated rates with an explicit type and source. An approved rate is never edited: correcting a rate means recording a new one, so any amount already converted remains reproducible against the rate that actually applied."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Exchange rates" }]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="Record exchange rate"
              description="No rate is pre-filled or suggested. Enter only a rate you have a recorded source for."
              triggerLabel="Record rate"
              action={saveExchangeRateAction}
              fields={fields}
              values={{ rateType: "official", rateDate: new Date().toISOString().slice(0, 10), effectiveFrom: new Date().toISOString().slice(0, 10) }}
            />
          ) : null
        }
      />

      {currencies.length < 2 ? (
        <Card className="mb-4 p-4">
          <p className="text-xs text-ink-muted">
            At least two currencies are needed before a rate can exist. {currencies.length === 0 ? "No currencies are recorded yet." : "Only one currency is recorded."}
          </p>
        </Card>
      ) : null}

      <div className="erp-card overflow-hidden">
        {rates.length === 0 ? (
          <EmptyState
            title="No exchange rates recorded"
            description="This is an empty register, not a zero rate. Nothing is converted until a rate is recorded with its effective dates and type."
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Pair</TH>
                  <TH>Rate</TH>
                  <TH>Type</TH>
                  <TH>Rate date</TH>
                  <TH>Effective</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rates.map((rate) => (
                  <TR key={rate.id}>
                    <TD className="font-mono text-xs font-semibold text-ink">
                      {rate.base_currency_code}/{rate.quote_currency_code}
                    </TD>
                    <TD className="font-mono text-xs">{String(rate.exchange_rate)}</TD>
                    <TD className="text-xs">{labelFor(rate.rate_type)}</TD>
                    <TD className="text-xs">{rate.rate_date}</TD>
                    <TD className="text-xs">
                      {rate.effective_from} → {rate.effective_until ?? "open"}
                    </TD>
                    <TD className="text-xs text-ink-muted">{rate.rate_source ?? "—"}</TD>
                    <TD>
                      <Badge tone={rate.status === "approved" ? "success" : rate.status === "rejected" ? "danger" : "neutral"} dot>
                        {labelFor(rate.status)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {rates.length} rate record(s) shown · approved rates are immutable; updating today&rsquo;s rate never rewrites a rate already applied to a historical entry.
      </p>
    </div>
  );
}
