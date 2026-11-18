import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveCurrencyAction } from "@/app/(dashboard)/master-data/actions";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getCurrencies } from "@/services/master-data/commercial";

export const metadata: Metadata = { title: "Currencies" };
export const dynamic = "force-dynamic";

export default async function CurrenciesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.currencies.view");
  if (!allowed) return <PermissionGuard permission="master_data.currencies.view" />;

  const currencies = await getCurrencies();
  const canManage = principal.permissions.has("master_data.currencies.manage");

  const fields = [
    { name: "code", label: "ISO 4217 code", required: true, placeholder: "e.g. NGN" },
    { name: "name", label: "Currency name", required: true },
    { name: "symbol", label: "Symbol", hint: "Display only. No symbol is ever used in a calculation." },
    { name: "decimalPlaces", label: "Decimal places", type: "number" as const, required: true },
    { name: "isActive", label: "Active", type: "checkbox" as const },
    { name: "notes", label: "Notes", type: "textarea" as const, wide: true },
  ];

  return (
    <div>
      <PageHeader
        title="Currencies"
        description="The currency registry. Only currencies recorded here can be referenced by partners, rates or tax categories. A symbol is never used for arithmetic: amounts are stored as NUMERIC with an explicit currency code."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Currencies" }]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="Add currency"
              description="Codes are ISO 4217 and cannot be imagined: use the official three-letter code."
              triggerLabel="Add currency"
              action={saveCurrencyAction}
              fields={fields}
              values={{ decimalPlaces: "2", isActive: true }}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        {currencies.length === 0 ? (
          <EmptyState title="No currencies recorded" description="Add at least the reporting currency before recording partners or exchange rates." />
        ) : (
          <TableWrapper>
            <Table className="min-w-[36rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Symbol</TH>
                  <TH>Decimals</TH>
                  <TH>Status</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {currencies.map((currency) => (
                  <TR key={currency.id}>
                    <TD className="font-mono text-xs font-semibold text-ink">{currency.code}</TD>
                    <TD className="text-xs">{currency.name}</TD>
                    <TD className="text-xs text-ink-muted">{currency.symbol ?? "—"}</TD>
                    <TD className="text-xs">{currency.decimal_places}</TD>
                    <TD>
                      <Badge tone={currency.is_active ? "success" : "neutral"} dot>
                        {currency.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canManage ? (
                      <TD className="text-right">
                        <RecordFormDialog
                          title={`Edit ${currency.code}`}
                          description="Deactivating a currency keeps historical references but removes it from selection lists."
                          triggerLabel="Edit"
                          trigger="edit"
                          action={saveCurrencyAction}
                          hidden={{ id: currency.id }}
                          fields={fields}
                          values={{
                            code: currency.code,
                            name: currency.name,
                            symbol: currency.symbol ?? "",
                            decimalPlaces: String(currency.decimal_places),
                            isActive: currency.is_active,
                            notes: currency.notes ?? "",
                          }}
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">{currencies.length} currency(ies), {currencies.filter((currency) => currency.is_active).length} active.</p>
    </div>
  );
}
