"use client";

import * as React from "react";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { lineTotals, previewTotals } from "@/lib/procurement/calc";

export type ProductOption = { id: string; code: string; name: string; base_unit_id: string | null };
export type UnitOption = { id: string; code: string; name: string };

export type LineRow = {
  key: string;
  productId: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  discountAmount: string;
  additionalCharges: string;
  taxAmount: string;
  specificationNotes: string;
  requisitionItemId: string;
};

export type LineItemsEditorProps = {
  /** "requisition" prices are estimates; "quotation"/"purchase_order" are agreed prices. */
  mode: "requisition" | "quotation" | "purchase_order";
  products: ProductOption[];
  units: UnitOption[];
  initial?: Partial<LineRow>[];
  currencyCode: string;
  /** Requisition lines may reference the requisition line they satisfy. */
  requisitionLines?: { id: string; label: string }[];
};

function blankRow(): LineRow {
  return {
    key: crypto.randomUUID(),
    productId: "",
    quantity: "",
    unitId: "",
    unitPrice: "",
    discountAmount: "",
    additionalCharges: "",
    taxAmount: "",
    specificationNotes: "",
    requisitionItemId: "",
  };
}

const money = (value: string | number) =>
  new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));

/**
 * Line editor for requisitions, quotations and purchase orders.
 *
 * Quantities and prices are kept as strings all the way to the server. The totals shown here use the
 * same fixed-point helpers the server uses, so what is previewed is what will be stored — and if the
 * two ever disagree, the database figure wins because it recalculates in NUMERIC.
 *
 * The submitted value is a single JSON field named `items`, which the server action re-validates.
 */
export function LineItemsEditor({
  mode,
  products,
  units,
  initial,
  currencyCode,
  requisitionLines,
}: LineItemsEditorProps) {
  const [rows, setRows] = React.useState<LineRow[]>(() =>
    initial && initial.length > 0
      ? initial.map((row) => ({ ...blankRow(), ...row }))
      : [{ ...blankRow(), key: crypto.randomUUID() }],
  );

  const showDiscount = mode !== "requisition";
  const priceLabel = mode === "requisition" ? "Estimated unit price" : "Unit price";

  const update = (key: string, patch: Partial<LineRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => setRows((current) => [...current, blankRow()]);
  const removeRow = (key: string) =>
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.key !== key)));

  const payload = rows.map((row) => ({
    productId: row.productId,
    quantity: row.quantity,
    unitId: row.unitId,
    unitPrice: row.unitPrice,
    estimatedUnitPrice: mode === "requisition" ? row.unitPrice : "",
    discountAmount: row.discountAmount,
    additionalCharges: row.additionalCharges,
    taxAmount: row.taxAmount,
    specificationNotes: row.specificationNotes,
    requisitionItemId: row.requisitionItemId,
  }));

  const totals = React.useMemo(() => {
    const usable = payload
      .filter((row) => row.quantity && row.unitPrice)
      .map((row) => ({
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        discount: row.discountAmount || "0",
        additionalCharges: row.additionalCharges || "0",
        taxAmount: row.taxAmount || "0",
      }));
    return previewTotals(usable, "0");
  }, [payload]);

  return (
    <div className="space-y-3">
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-surface-muted text-left text-xs text-ink-muted">
            <tr>
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="w-28 px-2 py-2 font-medium">Quantity</th>
              <th className="w-32 px-2 py-2 font-medium">Unit</th>
              <th className="w-32 px-2 py-2 font-medium">{priceLabel}</th>
              {showDiscount ? <th className="w-28 px-2 py-2 font-medium">Discount</th> : null}
              {mode === "purchase_order" ? <th className="w-28 px-2 py-2 font-medium">Other charges</th> : null}
              {mode === "purchase_order" ? <th className="w-28 px-2 py-2 font-medium">Tax</th> : null}
              {requisitionLines ? <th className="w-44 px-2 py-2 font-medium">Requisition line</th> : null}
              <th className="w-32 px-2 py-2 text-right font-medium">Line total</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const product = products.find((option) => option.id === row.productId);
              let lineTotal: string | null = null;
              if (row.quantity && row.unitPrice) {
                try {
                  lineTotal = lineTotals({
                    quantity: row.quantity,
                    unitPrice: row.unitPrice,
                    discount: row.discountAmount || "0",
                    additionalCharges: row.additionalCharges || "0",
                    taxAmount: row.taxAmount || "0",
                  }).lineTotal;
                } catch {
                  lineTotal = null;
                }
              }

              return (
                <tr key={row.key} className="border-t border-border align-top">
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`Product for line ${index + 1}`}
                      value={row.productId}
                      onChange={(event) => {
                        const productId = event.target.value;
                        const chosen = products.find((option) => option.id === productId);
                        update(row.key, {
                          productId,
                          unitId: chosen?.base_unit_id ?? row.unitId,
                        });
                      }}
                    >
                      <option value="">Select a product…</option>
                      {products.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.code} — {option.name}
                        </option>
                      ))}
                    </Select>
                    {product && !row.unitId ? (
                      <p className="mt-1 text-[0.6875rem] text-warning-600">
                        Choose the unit the quantity is stated in.
                      </p>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Quantity for line ${index + 1}`}
                      inputMode="decimal"
                      placeholder="0.000"
                      value={row.quantity}
                      onChange={(event) => update(row.key, { quantity: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`Unit for line ${index + 1}`}
                      value={row.unitId}
                      onChange={(event) => update(row.key, { unitId: event.target.value })}
                    >
                      <option value="">Unit…</option>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.code}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`${priceLabel} for line ${index + 1}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={row.unitPrice}
                      onChange={(event) => update(row.key, { unitPrice: event.target.value })}
                    />
                  </td>
                  {showDiscount ? (
                    <td className="px-2 py-2">
                      <Input
                        aria-label={`Discount for line ${index + 1}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={row.discountAmount}
                        onChange={(event) => update(row.key, { discountAmount: event.target.value })}
                      />
                    </td>
                  ) : null}
                  {mode === "purchase_order" ? (
                    <td className="px-2 py-2">
                      <Input
                        aria-label={`Additional charges for line ${index + 1}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={row.additionalCharges}
                        onChange={(event) => update(row.key, { additionalCharges: event.target.value })}
                      />
                    </td>
                  ) : null}
                  {mode === "purchase_order" ? (
                    <td className="px-2 py-2">
                      <Input
                        aria-label={`Tax amount for line ${index + 1}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={row.taxAmount}
                        onChange={(event) => update(row.key, { taxAmount: event.target.value })}
                      />
                    </td>
                  ) : null}
                  {requisitionLines ? (
                    <td className="px-2 py-2">
                      <Select
                        aria-label={`Requisition line for line ${index + 1}`}
                        value={row.requisitionItemId}
                        onChange={(event) => update(row.key, { requisitionItemId: event.target.value })}
                      >
                        <option value="">Not against a requisition</option>
                        {requisitionLines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                  ) : null}
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-ink">
                    {lineTotal ? `${currencyCode} ${money(lineTotal)}` : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length === 1}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          <Plus aria-hidden /> Add line
        </Button>
        <div className="text-xs text-ink-muted">
          {totals ? (
            <span className="tabular-nums">
              Goods value {currencyCode} {money(totals.subtotal)} · Discounts {currencyCode}{" "}
              {money(totals.discountTotal)} · Charges {currencyCode} {money(totals.chargesTotal)} ·{" "}
              <span className="font-semibold text-ink">
                Total {currencyCode} {money(totals.total)}
              </span>
            </span>
          ) : (
            <span>Enter a quantity and a price on at least one line to see the total.</span>
          )}
        </div>
      </div>
      <Label className="sr-only" htmlFor="items-summary">
        Lines
      </Label>
      <p id="items-summary" className="text-[0.6875rem] text-ink-subtle">
        Totals are recalculated by the database in fixed-point arithmetic when the document is saved.
      </p>
    </div>
  );
}
