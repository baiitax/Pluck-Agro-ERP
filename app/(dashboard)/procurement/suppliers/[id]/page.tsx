import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/procurement/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getSupplierPosition } from "@/services/procurement/supplier-accounts";
import { prepareReconciliationAction, recordTransactionReferenceAction } from "../../actions";

export const metadata: Metadata = { title: "Supplier account" };
export const dynamic = "force-dynamic";

const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One supplier's account.
 *
 * The statement is built from four independent sources: orders, receipts, advances, and the references
 * Finance records. Where they disagree, the disagreement is shown rather than smoothed away — an
 * unreconciled difference is information, and a zero would be a claim nobody has checked.
 */
export default async function SupplierAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.reconciliation.view")) {
    return <PermissionGuard permission="procurement.reconciliation.view" />;
  }

  const { id } = await params;
  const detail = await getSupplierPosition(id).catch(() => null);
  if (!detail) notFound();

  const { supplier, positions, ledger, references, reconciliations, orders, receipts, advances } = detail;
  const canManage = principal.permissions.has("procurement.reconciliation.manage");

  return (
    <div className="space-y-4">
      <PageHeader
        title={supplier.legal_name}
        description={`${supplier.reference} · ${labelForStatus(supplier.status)} · ${supplier.verification_status === "verified" ? "Verified" : "Not verified"}`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Supplier accounts", href: "/procurement/suppliers" },
          { label: supplier.reference },
        ]}
        actions={
          canManage ? (
            <Link
              href={`/procurement/supplier-advances/new`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Record an advance
            </Link>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Position</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {positions.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-ink-muted">
              No balance position has been derived for this supplier. Positions appear once an order, receipt or advance
              exists.
            </p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Currency</TH>
                    <TH className="text-right">Ordered</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Invoiced</TH>
                    <TH className="text-right">Paid</TH>
                    <TH className="text-right">Advance balance</TH>
                    <TH className="text-right">Confirmed payable</TH>
                    <TH className="text-right">Unreconciled</TH>
                  </TR>
                </THead>
                <TBody>
                  {positions.map((position) => (
                    <TR key={position.currency_code}>
                      <TD className="text-xs">{position.currency_code}</TD>
                      <TD className="text-right tabular-nums">{money(position.currency_code, position.ordered_amount)}</TD>
                      <TD className="text-right tabular-nums">{money(position.currency_code, position.received_value)}</TD>
                      <TD className="text-right tabular-nums">{money(position.currency_code, position.invoiced_amount)}</TD>
                      <TD className="text-right tabular-nums">{money(position.currency_code, position.paid_amount)}</TD>
                      <TD className="text-right tabular-nums">{money(position.currency_code, position.advance_balance)}</TD>
                      <TD className="text-right tabular-nums">
                        {position.confirmed_payable === null ? (
                          <Badge tone="neutral">No invoice recorded</Badge>
                        ) : (
                          money(position.currency_code, position.confirmed_payable)
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {position.unreconciled_difference && Number(position.unreconciled_difference) !== 0 ? (
                          <span className="text-warning-700">
                            {money(position.currency_code, position.unreconciled_difference)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Advances</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {advances.length === 0 ? (
              <p className="text-xs text-ink-muted">No advances recorded against this supplier.</p>
            ) : (
              <ul className="space-y-1.5">
                {advances.map((advance) => (
                  <li key={advance.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      <Link
                        href={`/procurement/supplier-advances/${advance.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {advance.reference}
                      </Link>
                      <span className="text-ink-subtle"> · {formatDate(advance.transaction_date)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-ink">
                        {money(advance.currency_code, Number(advance.outstanding_amount))} left
                      </span>
                      <Badge tone={procurementStatusTone(advance.status)}>{labelForStatus(advance.status)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orders.length === 0 ? (
              <p className="text-xs text-ink-muted">No purchase orders for this supplier.</p>
            ) : (
              <ul className="space-y-1.5">
                {orders.slice(0, 10).map((order) => (
                  <li key={order.purchase_order_id} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      <Link
                        href={`/procurement/purchase-orders/${order.purchase_order_id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {order.reference}
                      </Link>
                      <span className="text-ink-subtle"> · {formatDate(order.order_date)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-ink">
                        {money(order.currency_code, Number(order.total_amount))}
                      </span>
                      <Badge tone={procurementStatusTone(order.status)}>{labelForStatus(order.status)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          {reconciliations.length === 0 ? (
            <p className="px-4 text-xs text-ink-muted">
              No reconciliation has been prepared. A reconciliation states the position for a period; it does not change
              any document.
            </p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Period</TH>
                    <TH className="text-right">Ordered</TH>
                    <TH className="text-right">Invoiced</TH>
                    <TH className="text-right">Paid</TH>
                    <TH className="text-right">Difference</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {reconciliations.map((reconciliation) => (
                    <TR key={reconciliation.id}>
                      <TD className="font-medium">{reconciliation.reference}</TD>
                      <TD className="text-xs">
                        {formatDate(reconciliation.period_start)} – {formatDate(reconciliation.period_end)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {money(reconciliation.currency_code, Number(reconciliation.ordered_amount))}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {money(reconciliation.currency_code, Number(reconciliation.invoiced_amount))}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {money(reconciliation.currency_code, Number(reconciliation.paid_amount))}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {Number(reconciliation.difference_amount) !== 0 ? (
                          <span className="text-warning-700">
                            {money(reconciliation.currency_code, Number(reconciliation.difference_amount))}
                          </span>
                        ) : (
                          money(reconciliation.currency_code, 0)
                        )}
                      </TD>
                      <TD>
                        <Badge tone={procurementStatusTone(reconciliation.status)}>
                          {labelForStatus(reconciliation.status)}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}

          {canManage ? (
            <div className="border-t border-border p-3">
              <p className="pb-2 text-xs font-medium text-ink">Prepare a reconciliation</p>
              <ActionForm
                action={prepareReconciliationAction}
                submitLabel="Prepare reconciliation"
                successMessage="Reconciliation prepared."
                hidden={{ supplierId: supplier.id }}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
              >
                <div className="space-y-1">
                  <Label htmlFor="periodStart">Period start</Label>
                  <Input id="periodStart" name="periodStart" type="date" required defaultValue={today().slice(0, 8) + "01"} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="periodEnd">Period end</Label>
                  <Input id="periodEnd" name="periodEnd" type="date" required defaultValue={today()} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="currencyCode">Currency</Label>
                  <Input
                    id="currencyCode"
                    name="currencyCode"
                    required
                    maxLength={3}
                    className="uppercase"
                    defaultValue={supplier.preferred_currency_code ?? "NGN"}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" placeholder="Optional" />
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <FieldHint>
                    Figures are derived from the documents dated inside the period. Preparing a reconciliation records a
                    position; it does not adjust any document.
                  </FieldHint>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supplier documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          {references.length === 0 ? (
            <p className="px-4 text-xs text-ink-muted">
              Finance has recorded no invoice, payment or credit note reference for this supplier.
            </p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Type</TH>
                    <TH>Reference</TH>
                    <TH>Date</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Source</TH>
                  </TR>
                </THead>
                <TBody>
                  {references.map((reference) => (
                    <TR key={reference.id}>
                      <TD className="text-xs">{labelForStatus(reference.transaction_type)}</TD>
                      <TD className="text-xs font-medium">{reference.transaction_reference}</TD>
                      <TD className="text-xs">{formatDate(reference.transaction_date)}</TD>
                      <TD className="text-right tabular-nums">
                        {money(reference.currency_code, Number(reference.amount))}
                      </TD>
                      <TD className="text-xs text-ink-muted">{labelForStatus(reference.source)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}

          {canManage ? (
            <div className="border-t border-border p-3">
              <p className="pb-2 text-xs font-medium text-ink">Record a supplier document</p>
              <ActionForm
                action={recordTransactionReferenceAction}
                submitLabel="Record reference"
                successMessage="Reference recorded."
                hidden={{ supplierId: supplier.id }}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                <div className="space-y-1">
                  <Label htmlFor="transactionType">Type</Label>
                  <Select id="transactionType" name="transactionType" defaultValue="supplier_invoice">
                    <option value="supplier_invoice">Supplier invoice</option>
                    <option value="supplier_payment">Supplier payment</option>
                    <option value="credit_note">Credit note</option>
                    <option value="adjustment">Adjustment</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="transactionReference">Reference</Label>
                  <Input id="transactionReference" name="transactionReference" required placeholder="The supplier's document number" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="transactionDate">Date</Label>
                  <Input id="transactionDate" name="transactionDate" type="date" required defaultValue={today()} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="amount">Amount</Label>
                  <Input id="amount" name="amount" required inputMode="decimal" placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="referenceCurrency">Currency</Label>
                  <Input
                    id="referenceCurrency"
                    name="currencyCode"
                    required
                    maxLength={3}
                    className="uppercase"
                    defaultValue={supplier.preferred_currency_code ?? "NGN"}
                  />
                </div>
                <div className="space-y-1 lg:col-span-3">
                  <Label htmlFor="referenceNotes">Notes</Label>
                  <Textarea id="referenceNotes" name="notes" rows={2} placeholder="Optional context for the reference." />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <FieldHint>
                    Recording the supplier&apos;s document does not create a payable. It records what the supplier claims so
                    the two sides can be compared.
                  </FieldHint>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ledger.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-ink-muted">No activity recorded for this supplier.</p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Reference</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {ledger.map((entry) => (
                    <TR key={`${entry.activity_type}-${entry.activity_id}`}>
                      <TD className="text-xs">{formatDate(entry.activity_date)}</TD>
                      <TD className="text-xs">{labelForStatus(entry.activity_type)}</TD>
                      <TD className="text-xs font-medium">{entry.activity_reference}</TD>
                      <TD className="text-right tabular-nums">
                        {entry.amount === null ? "—" : money(entry.currency_code, Number(entry.amount))}
                      </TD>
                      <TD>
                        <Badge tone={procurementStatusTone(entry.status)}>{labelForStatus(entry.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Goods received</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {receipts.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-ink-muted">Nothing has been received from this supplier.</p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Date</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Accepted</TH>
                    <TH className="text-right">Rejected</TH>
                    <TH className="text-right">Quarantined</TH>
                  </TR>
                </THead>
                <TBody>
                  {receipts.map((receipt) => (
                    <TR key={receipt.id}>
                      <TD className="text-xs font-medium">
                        <Link href={`/procurement/goods-receipts/${receipt.id}`} className="text-brand-700 hover:underline">
                          {receipt.reference}
                        </Link>
                      </TD>
                      <TD className="text-xs">{formatDate(receipt.receipt_date)}</TD>
                      <TD>
                        <Badge tone={procurementStatusTone(receipt.status)}>{labelForStatus(receipt.status)}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{Number(receipt.accepted_quantity)}</TD>
                      <TD className="text-right tabular-nums">{Number(receipt.rejected_quantity)}</TD>
                      <TD className="text-right tabular-nums">{Number(receipt.quarantined_quantity)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Alert tone="info" title="What is deliberately absent">
        This statement does not show a supplier performance score, a rating, or a payment score. Those judgements are not
        derived from these figures here, and a number invented for a screen would be trusted more than it deserves.
      </Alert>

      <div>
        <Link href="/procurement/suppliers" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Back to supplier accounts
        </Link>
      </div>
    </div>
  );
}
