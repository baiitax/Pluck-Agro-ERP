import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { labelForStatus } from "@/lib/procurement/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getApprovalTrail } from "@/services/procurement/dashboard";

export const metadata: Metadata = { title: "Approval trail" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

const money = (currency: string | null, value: number | null) =>
  value === null
    ? "—"
    : `${currency ?? ""} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`.trim();

type Row = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_reference: string;
  stage: string | null;
  decision: string;
  amount_at_decision: number | null;
  currency_code: string | null;
  authority_maximum: number | null;
  decided_by_name: string | null;
  sod_rule_id: string | null;
  comment: string | null;
  created_at: string;
};

const ENTITY_TYPES = [
  "purchase_requisition",
  "supplier_quotation",
  "purchase_order",
  "purchase_order_amendment",
  "goods_receipt",
  "supplier_advance",
  "supplier_reconciliation",
];

/**
 * Every approval decision, in order.
 *
 * This is a reading of `procurement_approvals`, which is append-only: a decision is never edited or
 * withdrawn, so the trail cannot be tidied up after the fact. Separation-of-duties interventions are
 * shown on the row they affected, because an approval made under an override reads differently from one
 * that was not.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.approval.view")) {
    return <PermissionGuard permission="procurement.approval.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const entityType = single(params.entityType);
  const { rows, total, pageSize } = await getApprovalTrail({ page, entityType });
  const decisions = rows as unknown as Row[];

  const filterFields: FilterField[] = [
    {
      type: "select",
      name: "entityType",
      label: "Document type",
      defaultValue: entityType ?? "",
      options: [
        { value: "", label: "All documents" },
        ...ENTITY_TYPES.map((type) => ({ value: type, label: labelForStatus(type) })),
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Approval trail"
        description="Who decided what, on which document, at what value, and under which authority. Decisions are appended, never amended."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Approvals" }]}
      />

      <Alert tone="info" title="Read the authority column with the amount">
        An approval is recorded with the amount at the time of the decision and the maximum the approver was authorised
        for. A value above that maximum, or a separation-of-duties reference on the row, means an override was in play.
      </Alert>

      <div className="erp-card mt-4 overflow-hidden">
        <FilterBar action="/procurement/approvals" fields={filterFields} />

        {decisions.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={entityType ? "No decisions for this document type" : "No approval decisions yet"}
            description={
              entityType
                ? "Filtering runs on the server, so an empty result is real — nothing of that type has been decided."
                : "Decisions appear here as soon as an approver acts. A submitted document that is still waiting has no row yet."
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[62rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>When</TH>
                    <TH>Document</TH>
                    <TH>Stage</TH>
                    <TH>Decision</TH>
                    <TH className="text-right">Amount at decision</TH>
                    <TH className="text-right">Authority</TH>
                    <TH>Decided by</TH>
                    <TH>Comment</TH>
                  </TR>
                </THead>
                <TBody>
                  {decisions.map((decision) => (
                    <TR key={decision.id}>
                      <TD className="text-xs">{formatDateTime(decision.created_at)}</TD>
                      <TD>
                        <p className="font-medium text-ink">{decision.entity_reference}</p>
                        <p className="text-[0.6875rem] text-ink-subtle">{labelForStatus(decision.entity_type)}</p>
                      </TD>
                      <TD className="text-xs text-ink-muted">{decision.stage ? labelForStatus(decision.stage) : "—"}</TD>
                      <TD>
                        <Badge
                          tone={
                            decision.decision === "approved" || decision.decision === "issued"
                              ? "success"
                              : decision.decision === "rejected"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {labelForStatus(decision.decision)}
                        </Badge>
                        {decision.sod_rule_id ? <p className="text-[0.6875rem] text-warning-700">SOD override</p> : null}
                      </TD>
                      <TD className="text-right tabular-nums">{money(decision.currency_code, decision.amount_at_decision)}</TD>
                      <TD className="text-right tabular-nums">
                        {decision.authority_maximum === null ? (
                          <span className="text-ink-subtle">—</span>
                        ) : (
                          money(decision.currency_code, decision.authority_maximum)
                        )}
                      </TD>
                      <TD className="text-xs">{decision.decided_by_name ?? "—"}</TD>
                      <TD className="max-w-[18rem] text-xs text-ink-muted">{decision.comment ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>

            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              baseHref="/procurement/approvals"
              params={{ entityType }}
            />
          </>
        )}
      </div>
    </div>
  );
}
