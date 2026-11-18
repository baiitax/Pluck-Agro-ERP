import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { savePaymentTermAction } from "@/app/(dashboard)/master-data/actions";
import { labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getPaymentTerms } from "@/services/master-data/commercial";

export const metadata: Metadata = { title: "Payment terms" };
export const dynamic = "force-dynamic";

const PAYMENT_TYPES = ["advance", "cash_on_delivery", "immediate", "credit", "custom"] as const;

export default async function PaymentTermsPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.payment_terms.view");
  if (!allowed) return <PermissionGuard permission="master_data.payment_terms.view" />;

  const terms = await getPaymentTerms();
  const canManage = principal.permissions.has("master_data.payment_terms.manage");

  const fields = [
    { name: "code", label: "Code", required: true, placeholder: "e.g. net_30" },
    { name: "name", label: "Name", required: true },
    {
      name: "paymentType",
      label: "Type",
      type: "select" as const,
      required: true,
      options: PAYMENT_TYPES.map((type) => ({ value: type, label: labelFor(type) })),
    },
    { name: "paymentDays", label: "Days", type: "number" as const, hint: "Leave blank for terms with no fixed period." },
    { name: "isActive", label: "Active", type: "checkbox" as const },
    { name: "description", label: "Description", type: "textarea" as const, wide: true },
  ];

  return (
    <div>
      <PageHeader
        title="Payment terms"
        description="Reference terms that partners can be tagged with. They record intent only: this phase calculates no due dates, ageing or interest, and a credit-type term does not by itself authorise a credit sale."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Payment terms" }]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="New payment term"
              description="Terms are templates. The commercial decision to offer them belongs to Finance and Management."
              triggerLabel="New term"
              action={savePaymentTermAction}
              fields={fields}
              values={{ paymentType: "credit", isActive: true }}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        {terms.length === 0 ? (
          <EmptyState title="No payment terms recorded" description="Terms are optional. Add them only if the business actually uses them, rather than inventing a set." />
        ) : (
          <TableWrapper>
            <Table className="min-w-[40rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Term</TH>
                  <TH>Code</TH>
                  <TH>Type</TH>
                  <TH>Days</TH>
                  <TH>Status</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {terms.map((term) => (
                  <TR key={term.id}>
                    <TD className="text-xs font-semibold text-ink">
                      {term.name}
                      {term.description ? <span className="block text-[0.6875rem] font-normal text-ink-subtle">{term.description}</span> : null}
                    </TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{term.code}</TD>
                    <TD className="text-xs">{labelFor(term.payment_type)}</TD>
                    <TD className="text-xs">{term.payment_days ?? "—"}</TD>
                    <TD>
                      <Badge tone={term.is_active ? "success" : "neutral"} dot>
                        {term.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canManage ? (
                      <TD className="text-right">
                        <RecordFormDialog
                          title={`Edit ${term.name}`}
                          description="Deactivating removes the term from selection lists while leaving existing partner references intact."
                          triggerLabel="Edit"
                          trigger="edit"
                          action={savePaymentTermAction}
                          hidden={{ id: term.id }}
                          fields={fields}
                          values={{
                            code: term.code,
                            name: term.name,
                            paymentType: term.payment_type,
                            paymentDays: term.payment_days === null ? "" : String(term.payment_days),
                            isActive: term.is_active,
                            description: term.description ?? "",
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

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">{terms.length} term(s), {terms.filter((term) => term.is_active).length} active.</p>
    </div>
  );
}
