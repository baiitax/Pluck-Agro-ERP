import type { Metadata } from "next";
import { FileText } from "lucide-react";

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
import { getDocumentRegister } from "@/services/procurement/dashboard";

export const metadata: Metadata = { title: "Procurement documents" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

type Row = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_reference: string;
  document_type: string;
  title: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  is_confidential: boolean;
  uploaded_at: string;
  uploaded_by_name: string | null;
  storage_state: string;
};

const bytes = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
 * The document register.
 *
 * There is no storage bucket configured, so this screen registers documents and does not serve them:
 * each row states whether the file is retrievable or metadata-only. Claiming a download that cannot
 * happen would be worse than saying the file lives elsewhere.
 */
export default async function ProcurementDocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.document.view")) {
    return <PermissionGuard permission="procurement.document.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const entityType = single(params.entityType);
  const { rows, total, pageSize } = await getDocumentRegister({ page, entityType });
  const documents = rows as unknown as Row[];

  const metadataOnly = documents.filter((document) => document.storage_state === "metadata_only").length;

  const filterFields: FilterField[] = [
    {
      type: "select",
      name: "entityType",
      label: "Attached to",
      defaultValue: entityType ?? "",
      options: [
        { value: "", label: "Any document" },
        ...ENTITY_TYPES.map((type) => ({ value: type, label: labelForStatus(type) })),
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Procurement documents"
        description="Every document registered against a procurement transaction — quotations, delivery notes, receipts, approvals. The register records what exists and where it lives."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Documents" }]}
      />

      <Alert tone="info" title="Files are registered, not stored">
        No document storage is configured, so a registered document records its metadata only. The file itself lives
        outside the system and is not downloadable from here — {metadataOnly} of the {documents.length} rows on this page
        are in that state.
      </Alert>

      <div className="erp-card overflow-hidden">
        <FilterBar action="/procurement/documents" fields={filterFields} />

        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={entityType ? "No documents of that type" : "No documents registered"}
            description={
              entityType
                ? "Filtering runs on the server, so an empty list is real."
                : "Documents are registered from the transaction they belong to — a quotation, order, receipt or advance."
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[60rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Document</TH>
                    <TH>Attached to</TH>
                    <TH>Type</TH>
                    <TH>File</TH>
                    <TH className="text-right">Size</TH>
                    <TH>Registered</TH>
                    <TH>Storage</TH>
                  </TR>
                </THead>
                <TBody>
                  {documents.map((document) => (
                    <TR key={document.id}>
                      <TD>
                        <p className="font-medium text-ink">{document.title}</p>
                        <p className="text-[0.6875rem] text-ink-subtle">{document.file_name}</p>
                      </TD>
                      <TD className="text-xs">
                        {document.entity_reference}
                        <p className="text-[0.6875rem] text-ink-subtle">{labelForStatus(document.entity_type)}</p>
                      </TD>
                      <TD className="text-xs text-ink-muted">{labelForStatus(document.document_type)}</TD>
                      <TD className="text-xs text-ink-muted">{document.mime_type}</TD>
                      <TD className="text-right tabular-nums text-xs">{bytes(Number(document.file_size_bytes))}</TD>
                      <TD className="text-xs">
                        {formatDateTime(document.uploaded_at)}
                        <p className="text-[0.6875rem] text-ink-subtle">{document.uploaded_by_name ?? "—"}</p>
                      </TD>
                      <TD>
                        {document.storage_state === "stored" ? (
                          <Badge tone="success">Stored</Badge>
                        ) : (
                          <Badge tone="neutral">Metadata only</Badge>
                        )}
                        {document.is_confidential ? <p className="text-[0.6875rem] text-warning-700">Confidential</p> : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>

            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              baseHref="/procurement/documents"
              params={{ entityType }}
            />
          </>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        To register a document, open the transaction it belongs to — the register form on a quotation, order, receipt or
        advance records the file&apos;s metadata against that document&apos;s own reference.
      </p>
    </div>
  );
}
