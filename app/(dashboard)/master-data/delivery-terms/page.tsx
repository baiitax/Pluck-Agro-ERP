import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveDeliveryTermAction } from "@/app/(dashboard)/master-data/actions";
import { labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getDeliveryTerms } from "@/services/master-data/commercial";

export const metadata: Metadata = { title: "Delivery terms" };
export const dynamic = "force-dynamic";

export default async function DeliveryTermsPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.delivery_terms.view");
  if (!allowed) return <PermissionGuard permission="master_data.delivery_terms.view" />;

  const terms = await getDeliveryTerms();
  const canManage = principal.permissions.has("master_data.delivery_terms.manage");

  const incoterms = terms.filter((term) => term.term_kind === "incoterm");
  const domestic = terms.filter((term) => term.term_kind !== "incoterm");

  const fields = [
    { name: "code", label: "Code", required: true },
    { name: "name", label: "Name", required: true },
    {
      name: "termKind",
      label: "Kind",
      type: "select" as const,
      required: true,
      options: [
        { value: "incoterm", label: "Incoterm" },
        { value: "domestic", label: "Domestic" },
        { value: "other", label: "Other" },
      ],
    },
    { name: "edition", label: "Edition", hint: "e.g. 2020 for Incoterms." },
    { name: "isActive", label: "Active", type: "checkbox" as const },
    { name: "description", label: "Description", type: "textarea" as const, wide: true },
  ];

  const renderTable = (rows: typeof terms) => (
    <TableWrapper>
      <Table className="min-w-[36rem]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Code</TH>
            <TH>Term</TH>
            <TH>Edition</TH>
            <TH>Status</TH>
            {canManage ? <TH className="text-right">Actions</TH> : null}
          </TR>
        </THead>
        <TBody>
          {rows.map((term) => (
            <TR key={term.id}>
              <TD className="font-mono text-xs font-semibold text-ink">{term.code}</TD>
              <TD className="text-xs">
                {term.name}
                {term.description ? <span className="block text-[0.6875rem] text-ink-subtle">{term.description}</span> : null}
              </TD>
              <TD className="text-xs">{term.edition ?? "—"}</TD>
              <TD>
                <Badge tone={term.is_active ? "success" : "neutral"} dot>
                  {term.is_active ? "Active" : "Inactive"}
                </Badge>
              </TD>
              {canManage ? (
                <TD className="text-right">
                  <RecordFormDialog
                    title={`Edit ${term.code}`}
                    description="Delivery terms describe where responsibility transfers. They are recorded as written in the trade terms, not interpreted."
                    triggerLabel="Edit"
                    trigger="edit"
                    action={saveDeliveryTermAction}
                    hidden={{ id: term.id }}
                    fields={fields}
                    values={{
                      code: term.code,
                      name: term.name,
                      termKind: term.term_kind,
                      edition: term.edition ?? "",
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
  );

  return (
    <div>
      <PageHeader
        title="Delivery terms"
        description="Incoterms and domestic delivery terms. Codes are the standard three-letter Incoterm codes; names are recorded as published, not paraphrased into invented definitions."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Delivery terms" }]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="New delivery term"
              description="Use the published code and edition for Incoterms."
              triggerLabel="New term"
              action={saveDeliveryTermAction}
              fields={fields}
              values={{ termKind: "incoterm", isActive: true }}
            />
          ) : null
        }
      />

      <div className="grid gap-4">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Incoterms</h2>
            <p className="text-[0.6875rem] text-ink-subtle">{incoterms.length} recorded</p>
          </div>
          {incoterms.length === 0 ? (
            <EmptyState title="No Incoterms recorded" description="Add the Incoterms the business actually trades on. Nothing is seeded on your behalf." />
          ) : (
            renderTable(incoterms)
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Other delivery terms</h2>
            <p className="text-[0.6875rem] text-ink-subtle">{domestic.length} recorded</p>
          </div>
          {domestic.length === 0 ? (
            <EmptyState title="No domestic delivery terms" description="Optional. Add terms only where the business uses a defined naming." />
          ) : (
            renderTable(domestic)
          )}
        </Card>
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {labelFor("incoterm")} rows are separated from domestic terms so a domestic arrangement is never mistaken for an international rule.
      </p>
    </div>
  );
}
