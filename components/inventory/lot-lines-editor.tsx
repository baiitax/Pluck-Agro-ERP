"use client";

import * as React from "react";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export type LotOption = { id: string; label: string; available: number };

type Row = { key: string; lotId: string; quantity: string };

export type LotLinesEditorProps = {
  name?: string;
  lots: LotOption[];
  /** "quantity" for transfers, "quantityChange" (signed) for adjustments. */
  quantityFieldName?: "quantity" | "quantityChange";
  quantityLabel?: string;
  allowNegative?: boolean;
  emptyHint?: string;
};

/**
 * Line editor for documents that name lots rather than products.
 *
 * The options carry the lot's own available quantity, so the person choosing can see the ceiling. That is a
 * convenience, not the control: the database refuses an over-issue or over-transfer with a message naming the
 * lot and the quantity it actually holds.
 *
 * Quantities stay strings in the JSON this submits. Nothing here multiplies, sums or rounds them.
 */
export function LotLinesEditor({
  name = "items",
  lots,
  quantityFieldName = "quantity",
  quantityLabel = "Quantity",
  allowNegative = false,
  emptyHint,
}: LotLinesEditorProps) {
  const [rows, setRows] = React.useState<Row[]>([{ key: crypto.randomUUID(), lotId: "", quantity: "" }]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const payload = rows
    .filter((row) => row.lotId && row.quantity.trim() !== "")
    .map((row) => ({
      lotId: row.lotId,
      [quantityFieldName]: row.quantity.trim(),
    }));

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(payload)} />

      {rows.map((row, index) => (
        <div key={row.key} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`lot-${row.key}`} className="text-[0.6875rem] text-ink-muted">
              Lot {index + 1}
            </Label>
            <select
              id={`lot-${row.key}`}
              value={row.lotId}
              onChange={(event) => update(row.key, { lotId: event.target.value })}
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
            >
              <option value="">Select a lot…</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36 space-y-1">
            <Label htmlFor={`qty-${row.key}`} className="text-[0.6875rem] text-ink-muted">
              {quantityLabel}
            </Label>
            <Input
              id={`qty-${row.key}`}
              value={row.quantity}
              onChange={(event) => update(row.key, { quantity: event.target.value })}
              inputMode="decimal"
              placeholder={allowNegative ? "e.g. -12.5" : "e.g. 25"}
              className="h-8 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove line ${index + 1}`}
            disabled={rows.length === 1}
            onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), lotId: "", quantity: "" }])}
        >
          <Plus aria-hidden /> Add a lot
        </Button>
        {lots.length === 0 ? (
          <p className="text-xs text-warning-600">
            {emptyHint ?? "No lot currently has availability, so there is nothing to select."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
