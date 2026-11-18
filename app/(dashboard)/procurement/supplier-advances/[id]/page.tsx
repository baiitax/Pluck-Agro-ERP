import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton, ActionForm } from "@/components/procurement/action-form";
import { DocumentRegister, DocumentRegisterFallback } from "@/components/procurement/document-register";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getAdvanceDetail } from "@/services/procurement/supplier-accounts";
import {
  applyAdvanceAction,
  confirmAdvanceApplicationAction,
  confirmAdvancePaymentAction,
  decideAdvanceAction,
  markAdvancePaymentPendingAction,
  submitAdvanceAction,
} from "../../actions";

export const metadata: Metadata = { title: "Supplier advance" };
export const dynamic = "force-dynamic";

const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

/**
 * One supplier advance.
 *
 * The advance's outstanding balance is not a field anyone may type into: the database keeps it equal to
 * the amount less the confirmed applications, through a trigger. Two applications can be outstanding at
 * once, which is why the sum of pending applications is shown separately from the balance — a pending
 * application is a claim on the balance, not a reduction of it.
 */
export default async function SupplierAdvanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.supplier_advance.view")) {
    return <PermissionGuard permission="procurement.supplier_advance.view" />;
  }

  const { id } = await params;
  const detail = await getAdvanceDetail(id).catch(() => null);
  if (!detail) notFound();

  const { advance, applications, paymentDetails, supplier, history, approvals, documents, bankAccounts, canViewPayment } =
    detail;

  const canSubmit = principal.permissions.has("procurement.supplier_advance.create");
  const canDecide = principal.permissions.has("procurement.supplier_advance.approve");
  const canPay = principal.permissions.has("procurement.supplier_advance_payment.manage");
  const canApply = principal.permissions.has("procurement.supplier_advance.manage");

  const confirmed = applications.filter((application) => application.confirmation_status === "confirmed");
  const pending = applications.filter((application) => application.confirmation_status !== "confirmed");
  const pendingTotal = pending.reduce((sum, application) => sum + Number(application.applied_amount), 0);
  const outstanding = Number(advance.outstanding_amount);

  const statusAllowsApplication = ["paid", "partially_applied", "fully_applied"].includes(advance.status);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Advance ${advance.reference}`}
        description={`${supplier?.legal_name ?? "Supplier"} · recorded ${formatDate(advance.transaction_date)}`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Supplier advances", href: "/procurement/supplier-advances" },
          { label: advance.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={procurementStatusTone(advance.status)}>{labelForStatus(advance.status)}</Badge>
            {canSubmit && advance.status === "draft" ? (
              <ActionButton
                action={submitAdvanceAction}
                fields={{ id: advance.id, reference: advance.reference }}
                label="Submit for approval"
                successMessage="Advance submitted."
              />
            ) : null}
            {canPay && advance.status === "approved" ? (
              <ActionButton
                action={markAdvancePaymentPendingAction}
                fields={{ id: advance.id, reference: advance.reference }}
                label="Send to treasury"
                successMessage="Advance passed to treasury."
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Advance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-ink-muted">Supplier</p>
              <p className="text-ink">
                {supplier ? (
                  <Link href={`/procurement/suppliers/${supplier.id}`} className="text-brand-700 hover:underline">
                    {supplier.legal_name}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Payment method</p>
              <p className="text-ink">{labelForStatus(advance.payment_method)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Transaction date</p>
              <p className="text-ink">{formatDate(advance.transaction_date)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">External reference</p>
              <p className="text-ink">{advance.advance_reference ?? "—"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-ink-muted">Purpose</p>
              <p className="text-ink">{advance.purpose ?? "—"}</p>
            </div>
            <div className="sm:col-span-2 border-t border-border pt-2">
              <p className="text-xs text-ink-muted">Treasury confirmation</p>
              <p className="text-ink">
                {advance.treasury_confirmation_reference
                  ? `${advance.treasury_confirmation_reference} · ${formatDateTime(advance.treasury_confirmed_at)}`
                  : "Not confirmed by treasury"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Advance</span>
              <span className="tabular-nums text-ink">{money(advance.currency_code, Number(advance.amount))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Applied (confirmed)</span>
              <span className="tabular-nums text-ink">
                {money(
                  advance.currency_code,
                  confirmed.reduce((sum, application) => sum + Number(application.applied_amount), 0),
                )}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-ink-muted">Outstanding</span>
              <span className="tabular-nums font-medium text-ink">{money(advance.currency_code, outstanding)}</span>
            </div>
            {pending.length > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Pending applications</span>
                <span className="tabular-nums text-warning-700">
                  {money(advance.currency_code, pendingTotal)}
                </span>
              </div>
            ) : null}
            <p className="pt-1 text-[0.6875rem] text-ink-subtle">
              The outstanding balance is derived: it equals the advance less confirmed applications, and nothing else
              changes it. Pending applications are a claim on it and are not deducted until confirmed.
            </p>
          </CardContent>
        </Card>
      </div>

      {!canViewPayment ? (
        <Alert tone="info" title="Payment details are restricted">
          The account and payment references for this advance are visible only to holders of
          procurement.supplier_advance_payment.view. Their absence here is deliberate, not a loading failure.
        </Alert>
      ) : paymentDetails ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-ink-muted">Payment reference</p>
              <p className="text-ink">{paymentDetails.payment_reference ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Paid to</p>
              <p className="text-ink">
                {bankAccounts.find((account) => account.id === paymentDetails.paying_bank_account_id)?.label ??
                  paymentDetails.paying_account_note ??
                  "—"}
              </p>
            </div>
            {paymentDetails.notes ? (
              <div className="sm:col-span-2">
                <p className="text-xs text-ink-muted">Notes</p>
                <p className="text-ink">{paymentDetails.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canDecide && ["submitted", "under_review"].includes(advance.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Approval decision</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={decideAdvanceAction}
              submitLabel="Record decision"
              successMessage="Decision recorded."
              hidden={{ id: advance.id, reference: advance.reference }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label htmlFor="decision">Decision</Label>
                <Select id="decision" name="decision" defaultValue="approve">
                  <option value="approve">Approve the advance</option>
                  <option value="reject">Reject</option>
                  <option value="cancel">Cancel</option>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="comment">Comment</Label>
                <Textarea id="comment" name="comment" rows={2} placeholder="Required when rejecting or cancelling." />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {canPay && ["approved", "payment_pending"].includes(advance.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Confirm payment (treasury)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ink-muted">
              Confirming payment states that money left the company&apos;s account. It requires a payment reference and a
              treasury reference — both are recorded on the advance and audited.
            </p>
            <ActionForm
              action={confirmAdvancePaymentAction}
              submitLabel="Confirm payment"
              successMessage="Payment confirmed."
              hidden={{ advanceId: advance.id, reference: advance.reference }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label htmlFor="payingBankAccountId">Paid to</Label>
                {bankAccounts.length > 0 ? (
                  <Select id="payingBankAccountId" name="payingBankAccountId" defaultValue="">
                    <option value="">Not recorded / other</option>
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label}
                        {account.verification_status === "verified" ? "" : " — unverified"}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input id="payingBankAccountId" name="payingBankAccountId" type="hidden" value="" />
                )}
                <p className="text-[0.6875rem] text-ink-subtle">
                  {bankAccounts.length > 0
                    ? "Accounts are shown masked; the full number is never rendered."
                    : "No supplier bank account is visible to you, or none is on file. Record the destination in the note."}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="payingAccountNote">Account note</Label>
                <Input id="payingAccountNote" name="payingAccountNote" placeholder="Where it was paid, if not on file" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="paymentReference">Payment reference</Label>
                <Input id="paymentReference" name="paymentReference" required placeholder="Bank or transfer reference" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="treasuryConfirmationReference">Treasury reference</Label>
                <Input
                  id="treasuryConfirmationReference"
                  name="treasuryConfirmationReference"
                  required
                  placeholder="Treasury's own confirmation number"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={2} placeholder="Anything treasury should record with the payment." />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          {applications.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-ink-muted">
              This advance has not been applied to anything. It stays a receivable until it is set against an invoice,
              order or credit note.
            </p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Target</TH>
                    <TH>Reference</TH>
                    <TH className="text-right">Applied</TH>
                    <TH>Confirmation</TH>
                    <TH>Applied at</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {applications.map((application) => (
                    <TR key={application.id}>
                      <TD className="text-xs">{labelForStatus(application.target_type)}</TD>
                      <TD className="text-xs">{application.target_reference}</TD>
                      <TD className="text-right tabular-nums">
                        {money(advance.currency_code, Number(application.applied_amount))}
                      </TD>
                      <TD>
                        <Badge tone={application.confirmation_status === "confirmed" ? "success" : "warning"}>
                          {labelForStatus(application.confirmation_status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-ink-muted">{formatDateTime(application.applied_at)}</TD>
                      <TD className="text-right">
                        {canApply && application.confirmation_status !== "confirmed" ? (
                          <ActionButton
                            action={confirmAdvanceApplicationAction}
                            fields={{ applicationId: application.id, reference: advance.reference }}
                            label="Confirm"
                            successMessage="Application confirmed."
                          />
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}

          {canApply && statusAllowsApplication && outstanding > 0 ? (
            <div className="border-t border-border p-3">
              <p className="pb-2 text-xs font-medium text-ink">Apply part of this advance</p>
              <ActionForm
                action={applyAdvanceAction}
                submitLabel="Apply advance"
                successMessage="Application recorded, awaiting confirmation."
                hidden={{ advanceId: advance.id, reference: advance.reference }}
                className="grid gap-2 sm:grid-cols-2"
              >
                <div className="space-y-1">
                  <Label htmlFor="targetType">Apply to</Label>
                  <Select id="targetType" name="targetType" defaultValue="supplier_invoice">
                    <option value="supplier_invoice">Supplier invoice</option>
                    <option value="purchase_order">Purchase order</option>
                    <option value="credit_note">Credit note</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="targetReference">Document reference</Label>
                  <Input id="targetReference" name="targetReference" required placeholder="e.g. INV-2041" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="appliedAmount">Amount to apply</Label>
                  <Input
                    id="appliedAmount"
                    name="appliedAmount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                  <p className="text-[0.6875rem] text-ink-subtle">
                    Up to {money(advance.currency_code, outstanding)} is outstanding. The database refuses anything more.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" placeholder="Optional" />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-ink-muted">No status changes recorded.</p>
            ) : (
              <ol className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <p className="text-ink">
                      {entry.from_status ? `${labelForStatus(entry.from_status)} → ` : ""}
                      {labelForStatus(entry.to_status)}
                    </p>
                    <p className="text-ink-subtle">
                      {entry.actor_name ?? "System"} · {formatDateTime(entry.created_at)}
                    </p>
                    {entry.reason ? <p className="text-ink-muted">{entry.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approvals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {approvals.length === 0 ? (
              <p className="text-xs text-ink-muted">No approval decisions recorded.</p>
            ) : (
              <ul className="space-y-2">
                {approvals.map((decision) => (
                  <li key={decision.id} className="text-xs">
                    <p className="text-ink">
                      {labelForStatus(decision.decision)}
                      {decision.stage ? ` · ${decision.stage}` : ""}
                    </p>
                    <p className="text-ink-subtle">
                      {decision.decided_by_name ?? "—"} · {formatDateTime(decision.created_at)}
                    </p>
                    {decision.comment ? <p className="text-ink-muted">{decision.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {principal.permissions.has("procurement.document.view") ? (
        <DocumentRegister
          entityType="supplier_advance"
          entityId={advance.id}
          entityReference={advance.reference}
          documents={(documents ?? []).map((document) => ({
            id: document.id,
            title: document.title,
            document_type: document.document_type,
            file_name: document.file_name,
            uploaded_at: document.uploaded_at,
            storage_path: null,
          }))}
          canUpload={principal.permissions.has("procurement.document.upload")}
        />
      ) : (
        <DocumentRegisterFallback reference={advance.reference} />
      )}

      <div>
        <Link href="/procurement/supplier-advances" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Back to advances
        </Link>
      </div>
    </div>
  );
}
