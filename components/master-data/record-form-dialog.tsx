"use client";

import { cn } from "@/lib/utils";

import * as React from "react";

import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/errors";

export type FormField = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "checkbox" | "email";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  step?: string;
  /** Two-column span in the dialog grid. */
  wide?: boolean;
};

/**
 * One dialog component, driven by a field list.
 *
 * The master-data module has a lot of small reference records (currencies, terms, categories).
 * Rather than twenty near-identical forms, each screen declares its fields and the shared dialog
 * handles rendering, pending state, server validation errors and the success toast.
 */
export function RecordFormDialog<T = undefined>({
  title,
  description,
  submitLabel,
  triggerLabel,
  trigger = "create",
  action,
  fields,
  values,
  hidden,
}: {
  title: string;
  description?: string;
  submitLabel?: string;
  triggerLabel: string;
  trigger?: "create" | "edit";
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  fields: FormField[];
  values?: Record<string, string | boolean | null>;
  hidden?: Record<string, string>;
}) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(`${title} saved.`);
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};
  const formId = React.useId();

  return (
    <>
      {trigger === "create" ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> {triggerLabel}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> {triggerLabel}
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form={formId} disabled={isPending}>
              {isPending ? "Saving…" : (submitLabel ?? "Save")}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          {hidden
            ? Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)
            : null}

          {fields.map((field) => (
            <div key={field.name} className={cn(field.wide && "sm:col-span-2")}>
              {field.type === "checkbox" ? (
                <label className="flex items-center gap-2 pt-5 text-xs text-ink">
                  <input
                    type="checkbox"
                    name={field.name}
                    defaultChecked={values?.[field.name] === true}
                    className="size-4 rounded border-border"
                  />
                  {field.label}
                </label>
              ) : (
                <>
                  <Label htmlFor={`${formId}-${field.name}`}>
                    {field.label}
                    {field.required ? <span className="text-danger-600"> *</span> : null}
                  </Label>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={`${formId}-${field.name}`}
                      name={field.name}
                      rows={3}
                      defaultValue={String(values?.[field.name] ?? "")}
                      placeholder={field.placeholder}
                    />
                  ) : field.type === "select" ? (
                    <Select
                      id={`${formId}-${field.name}`}
                      name={field.name}
                      defaultValue={String(values?.[field.name] ?? "")}
                    >
                      <option value="">—</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={`${formId}-${field.name}`}
                      name={field.name}
                      type={field.type ?? "text"}
                      step={field.step}
                      defaultValue={String(values?.[field.name] ?? "")}
                      placeholder={field.placeholder}
                    />
                  )}
                </>
              )}
              {field.hint ? <FieldHint>{field.hint}</FieldHint> : null}
              <FieldError message={fieldErrors[field.name]?.[0]} />
            </div>
          ))}
        </form>
      </Dialog>
    </>
  );
}
