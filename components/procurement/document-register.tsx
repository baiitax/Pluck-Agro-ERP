"use client";

import * as React from "react";

import { FileText, Paperclip } from "lucide-react";

import { ActionForm } from "@/components/procurement/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { registerDocumentAction } from "@/app/(dashboard)/procurement/actions";

export type RegisteredDocument = {
  id: string;
  title: string;
  document_type: string;
  file_name: string;
  mime_type?: string;
  file_size_bytes?: number;
  uploaded_at: string;
  storage_path: string | null;
};

/**
 * Document register for one procurement transaction.
 *
 * The register records metadata only. No storage bucket is configured for this project, so the panel
 * states that plainly instead of offering a download that would fail — and when a bucket exists,
 * `storage_path` is what the link will use.
 */
export function DocumentRegister({
  entityType,
  entityId,
  entityReference,
  documents,
  canUpload,
}: {
  entityType: string;
  entityId: string;
  entityReference: string;
  documents: RegisteredDocument[];
  canUpload: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        {canUpload ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {open ? "Close" : "Register a document"}
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {documents.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-ink-muted">
            No document has been registered against {entityReference}.
          </p>
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Title</TH>
                  <TH>Type</TH>
                  <TH>File</TH>
                  <TH>Storage</TH>
                  <TH>Registered</TH>
                </TR>
              </THead>
              <TBody>
                {documents.map((document) => (
                  <TR key={document.id}>
                    <TD className="font-medium text-ink">{document.title}</TD>
                    <TD>{document.document_type.replace(/_/g, " ")}</TD>
                    <TD className="text-ink-muted">{document.file_name}</TD>
                    <TD>
                      <Badge tone={document.storage_path ? "info" : "neutral"}>
                        {document.storage_path ? "Path recorded" : "Metadata only"}
                      </Badge>
                    </TD>
                    <TD>{formatDateTime(document.uploaded_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}

        {open ? (
          <div className="border-t border-border px-4 py-3">
            <Alert tone="info" title="Metadata only">
              No document storage bucket is configured for this deployment, so the register records the file&apos;s details
              and an optional external path. Files are not uploaded from here.
            </Alert>
            <ActionForm
              action={registerDocumentAction}
              submitLabel="Register"
              successMessage="Document registered."
              hidden={{ entityType, entityId }}
              className="mt-3 grid gap-3 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label htmlFor="documentType">Document type</Label>
                <Select id="documentType" name="documentType" defaultValue="other">
                  <option value="quotation">Quotation</option>
                  <option value="purchase_order">Purchase order</option>
                  <option value="delivery_note">Delivery note</option>
                  <option value="goods_receipt">Goods receipt</option>
                  <option value="product_photo">Product photo</option>
                  <option value="inspection">Inspection record</option>
                  <option value="payment_evidence">Payment evidence</option>
                  <option value="correspondence">Correspondence</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required placeholder="Signed delivery note" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fileName">File name</Label>
                <Input id="fileName" name="fileName" required placeholder="dn-001.pdf" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mimeType">Content type</Label>
                <Select id="mimeType" name="mimeType" defaultValue="application/pdf">
                  <option value="application/pdf">PDF</option>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/png">PNG</option>
                  <option value="image/webp">WebP</option>
                  <option value="text/csv">CSV</option>
                  <option value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">XLSX</option>
                  <option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">DOCX</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="fileSizeBytes">Size in bytes</Label>
                <Input id="fileSizeBytes" name="fileSizeBytes" inputMode="numeric" required placeholder="204800" />
                <FieldHint>The configured limit is enforced on the server.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="storagePath">External path (optional)</Label>
                <Input id="storagePath" name="storagePath" placeholder="shared-drive://procurement/2026/dn-001.pdf" />
              </div>
            </ActionForm>
          </div>
        ) : (
          <p className="flex items-center gap-1 px-4 pb-3 text-[0.6875rem] text-ink-subtle">
            <Paperclip className="size-3" aria-hidden /> Documents are metadata records; files are held outside the
            application until storage is configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Placeholder used where a document register cannot be resolved. */
export function DocumentRegisterFallback({ reference }: { reference: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <FileText className="size-3.5" aria-hidden /> Documents for {reference} are not included on this screen.
        </p>
      </CardContent>
    </Card>
  );
}
