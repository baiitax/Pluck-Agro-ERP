import type { Metadata } from "next";
import { CopyCheck, ShieldAlert } from "lucide-react";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { detectDuplicatesAction, resolveDuplicateAction } from "@/app/(dashboard)/master-data/actions";
import { DUPLICATE_STATUSES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getDuplicateCandidates } from "@/services/master-data/duplicates";

export const metadata: Metadata = { title: "Duplicate review" };
export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.duplicates.view");
  if (!allowed) return <PermissionGuard permission="master_data.duplicates.view" />;

  const candidates = await getDuplicateCandidates();
  const canReview = principal.permissions.has("master_data.duplicates.review");
  const open = candidates.filter((candidate) => candidate.status === "open");

  const resolutionFields = [
    {
      name: "status",
      label: "Decision",
      type: "select" as const,
      required: true,
      options: DUPLICATE_STATUSES.filter((status) => status !== "merged").map((status) => ({ value: status, label: labelFor(status) })),
    },
    { name: "notes", label: "Notes", type: "textarea" as const, wide: true, hint: "Explain the decision. It is stored with the candidate and written to the audit trail." },
  ];

  return (
    <div>
      <PageHeader
        title="Duplicate review"
        description="Candidate pairs detected from real fields — registration numbers, tax identifiers, contact details and name similarity. Detection never merges anything: a merge is a separate, authorised operation, and it is not implemented in this phase because there is no transaction history to reconcile yet."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Duplicates" }]}
        actions={
          canReview ? (
            <div className="flex items-center gap-2">
              <RecordFormDialog
                title="Scan suppliers for duplicates"
                description="Compares non-archived supplier records. Existing candidate pairs are not duplicated."
                triggerLabel="Scan suppliers"
                action={detectDuplicatesAction}
                hidden={{ entity: "supplier" }}
                submitLabel="Run scan"
                fields={[
                  { name: "_note", label: "Scan scope", hint: "Legal name, trading name, registration number, tax ID, email, phone and website.", wide: true },
                ]}
              />
              <RecordFormDialog
                title="Scan customers for duplicates"
                description="Compares non-archived customer records using the same field rules."
                triggerLabel="Scan customers"
                action={detectDuplicatesAction}
                hidden={{ entity: "customer" }}
                submitLabel="Run scan"
                fields={[
                  { name: "_note", label: "Scan scope", hint: "Legal name, trading name, registration number, tax ID and contact email.", wide: true },
                ]}
              />
            </div>
          ) : null
        }
      />

      <Card className="mb-4 flex items-start gap-2 p-3">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-pending-600" aria-hidden />
        <p className="text-[0.6875rem] text-ink-muted">
          Marking a pair as a confirmed duplicate is a recorded judgement, not a merge. Nothing is renamed, deactivated or re-pointed automatically, and no record is deleted.
        </p>
      </Card>

      <div className="erp-card overflow-hidden">
        {candidates.length === 0 ? (
          <EmptyState
            icon={CopyCheck}
            title="No duplicate candidates"
            description={
              canReview
                ? "Run a scan to compare existing records. Candidates appear here for a person to judge; the scan itself changes no master data."
                : "A user with master_data.duplicates.review permission runs scans and records decisions."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Entity</TH>
                  <TH>Record A</TH>
                  <TH>Record B</TH>
                  <TH>Score</TH>
                  <TH>Matched on</TH>
                  <TH>Status</TH>
                  {canReview ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {candidates.map((candidate) => (
                  <TR key={candidate.id}>
                    <TD className="text-xs">{labelFor(candidate.entity_type)}</TD>
                    <TD className="text-xs">
                      <a href={`/master-data/${candidate.entity_type}s/${candidate.record_a_id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">
                        {candidate.record_a_label ?? "—"}
                      </a>
                    </TD>
                    <TD className="text-xs">
                      <a href={`/master-data/${candidate.entity_type}s/${candidate.record_b_id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">
                        {candidate.record_b_label ?? "—"}
                      </a>
                    </TD>
                    <TD className="font-mono text-xs">{String(candidate.match_score)}</TD>
                    <TD className="text-[0.6875rem] text-ink-muted">{candidate.matched_fields.join(", ") || "—"}</TD>
                    <TD>
                      <Badge tone={candidate.status === "open" ? "pending" : candidate.status === "not_duplicate" ? "neutral" : "info"} dot>
                        {labelFor(candidate.status)}
                      </Badge>
                    </TD>
                    {canReview ? (
                      <TD className="text-right">
                        <RecordFormDialog
                          title="Record a decision"
                          description="This records the reviewer's judgement. It does not modify either master record."
                          triggerLabel="Review"
                          trigger="edit"
                          action={resolveDuplicateAction}
                          hidden={{ id: candidate.id }}
                          fields={resolutionFields}
                          values={{ status: candidate.status, notes: candidate.resolution_notes ?? "" }}
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

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {candidates.length} candidate pair(s) · {open.length} open · detection thresholds are code-level constants and deliberately conservative.
      </p>
    </div>
  );
}
