"use client";

import * as React from "react";

import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { executeImportAction, stageImportAction } from "@/app/(dashboard)/master-data/actions";
import { IMPORT_TEMPLATES, templateCsv, type ImportEntity } from "@/lib/master-data/csv";

type StageResult = {
  jobId: string;
  entityType: string;
  headers: string[];
  accepted: number;
  rejected: number;
  rejectedRows: { rowNumber: number; errors: string[]; values: Record<string, string> }[];
  structuralErrors: { rowNumber: number; message: string }[];
};

/**
 * CSV import centre.
 *
 * The file is read in the browser only to obtain its text; parsing, validation and staging all
 * happen on the server. Rejected rows are shown here and remain stored against the job, so nothing
 * a user uploaded silently disappears.
 */
export function ImportUploader() {
  const router = useRouter();
  const [entityType, setEntityType] = React.useState<ImportEntity>("supplier");
  const [fileName, setFileName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [staged, setStaged] = React.useState<StageResult | null>(null);

  const stage = useServerForm(stageImportAction, (result) => {
    if (result.ok) {
      const data = result.data as StageResult;
      setStaged(data);
      toast.success(`Staged ${data.accepted + data.rejected} row(s): ${data.accepted} accepted, ${data.rejected} rejected.`);
    } else {
      toast.error(result.error.message);
    }
  });

  const execute = useServerForm(executeImportAction, (result) => {
    if (result.ok) {
      const data = result.data as { imported: number; skipped: number };
      toast.success(`Imported ${data.imported} row(s); ${data.skipped} skipped.`);
      setStaged(null);
      setContent("");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  });

  const template = IMPORT_TEMPLATES[entityType];

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv(entityType)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${entityType}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink">Stage an import</h2>
      <p className="mt-1 max-w-3xl text-[0.6875rem] text-ink-subtle">
        Uploading only stages and validates. Nothing is written to a master table until you confirm, and a rejected row is stored with the reason it was rejected.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="entityType">Record type</Label>
          <Select
            id="entityType"
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value as ImportEntity);
              setStaged(null);
              setContent("");
              setFileName("");
            }}
          >
            {Object.entries(IMPORT_TEMPLATES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="csv-file">CSV file</Label>
          <Input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setContent(await file.text());
              setStaged(null);
            }}
          />
          <FieldHint>{fileName ? `Selected: ${fileName}` : "UTF-8 CSV, comma separated."}</FieldHint>
        </div>
        <div className="flex items-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={downloadTemplate}>
            <Download aria-hidden /> Template
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!content || stage.isPending}
            onClick={() => {
              const formData = new FormData();
              formData.set("entityType", entityType);
              formData.set("fileName", fileName || "upload.csv");
              formData.set("content", content);
              stage.run(formData);
            }}
          >
            <Upload aria-hidden /> {stage.isPending ? "Validating…" : "Validate & stage"}
          </Button>
        </div>
      </div>

      <p className="mt-2 text-[0.6875rem] text-ink-subtle">{template.notes}</p>
      <p className="mt-1 font-mono text-[0.625rem] text-ink-subtle">Columns: {template.columns.join(", ")}</p>

      {staged ? (
        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink">
              {staged.accepted} row(s) accepted · {staged.rejected} rejected
            </p>
            <Button
              type="button"
              size="sm"
              disabled={staged.accepted === 0 || execute.isPending}
              onClick={() => {
                const formData = new FormData();
                formData.set("jobId", staged.jobId);
                execute.run(formData);
              }}
            >
              {execute.isPending ? "Importing…" : `Import ${staged.accepted} accepted row(s)`}
            </Button>
          </div>

          {staged.structuralErrors.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {staged.structuralErrors.map((error) => (
                <li key={`structural-${error.rowNumber}-${error.message}`} className="text-[0.6875rem] text-danger-600">
                  Row {error.rowNumber}: {error.message}
                </li>
              ))}
            </ul>
          ) : null}

          {staged.rejectedRows.length > 0 ? (
            <div className="mt-3">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">Rejected rows</p>
              <ul className="mt-1 divide-y divide-border">
                {staged.rejectedRows.map((row) => (
                  <li key={`rejected-${row.rowNumber}`} className="py-1.5">
                    <p className="text-[0.6875rem] text-ink">Row {row.rowNumber}</p>
                    <ul className="mt-0.5 list-inside list-disc text-[0.625rem] text-danger-600">
                      {row.errors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {staged.rejected > staged.rejectedRows.length ? (
                <p className="mt-1 text-[0.625rem] text-ink-subtle">
                  Showing the first {staged.rejectedRows.length} of {staged.rejected}. All of them are stored against the job.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
