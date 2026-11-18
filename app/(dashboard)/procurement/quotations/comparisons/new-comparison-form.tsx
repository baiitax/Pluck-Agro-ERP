"use client";

import * as React from "react";

import { ActionForm } from "@/components/procurement/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { createComparisonAction } from "@/app/(dashboard)/procurement/actions";

/** Builds a comparison from selected offers. Offers in different currencies are refused server-side. */
export function NewComparisonForm({ quotations }: { quotations: { id: string; label: string }[] }) {
  const [selected, setSelected] = React.useState<string[]>([]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Build a comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={createComparisonAction}
          submitLabel="Build comparison"
          successMessage="Comparison built."
          redirectTo="/procurement/quotations/comparisons"
          className="grid gap-3 sm:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required placeholder="Maize sourcing — November" maxLength={200} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="currencyNote">Currency note</Label>
            <Input id="currencyNote" name="currencyNote" placeholder="All offers quoted in NGN" maxLength={300} />
            <FieldHint>Offers in different currencies cannot be compared here; convert them with a recorded rate first.</FieldHint>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Offers to compare</Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {quotations.map((quotation) => {
                const checked = selected.includes(quotation.id);
                return (
                  <label
                    key={quotation.id}
                    className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      name="quotationIds"
                      value={quotation.id}
                      checked={checked}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, quotation.id]
                            : current.filter((id) => id !== quotation.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="text-ink">{quotation.label}</span>
                  </label>
                );
              })}
            </div>
            <FieldHint>{selected.length} selected — at least two are needed.</FieldHint>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} placeholder="What the comparison is for and what it leaves out." />
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
