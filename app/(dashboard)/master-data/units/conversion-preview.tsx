"use client";

import * as React from "react";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { previewConversionAction } from "@/app/(dashboard)/master-data/actions";
import type { ConversionPreview } from "@/services/master-data/units";

type UnitOption = { id: string; label: string };

/**
 * Conversion tester.
 *
 * It calls the same server-side function procurement and inventory will call, so what is shown here
 * is the real behaviour — including refusals for incompatible categories and ambiguous paths.
 */
export function ConversionPreviewPanel({ units, products }: { units: UnitOption[]; products: { id: string; label: string }[] }) {
  const [result, setResult] = React.useState<ConversionPreview | null>(null);
  const [inputQuantity, setInputQuantity] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="space-y-3">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setInputQuantity(String(formData.get("quantity") ?? ""));
          startTransition(async () => {
            const response = await previewConversionAction(null, formData);
            setResult(response.ok ? response.data : { ok: false, error: response.error.message });
          });
        }}
      >
        <div>
          <Label htmlFor="preview-quantity">Quantity</Label>
          <Input id="preview-quantity" name="quantity" defaultValue="1" inputMode="decimal" />
        </div>
        <div>
          <Label htmlFor="preview-from">From</Label>
          <Select id="preview-from" name="fromUnitId" defaultValue="">
            <option value="">—</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="preview-to">To</Label>
          <Select id="preview-to" name="toUnitId" defaultValue="">
            <option value="">—</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="preview-product">Product (optional)</Label>
          <Select id="preview-product" name="productId" defaultValue="">
            <option value="">Standard rule</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Converting…" : "Test conversion"}
          </Button>
        </div>
      </form>

      {result ? (
        result.ok ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs">
            <span className="font-mono">{inputQuantity || "—"}</span>
            <span className="text-ink-muted">{result.result.fromUnitCode}</span>
            <ArrowRight className="size-3.5 text-ink-subtle" aria-hidden />
            <span className="font-mono font-semibold text-ink">{result.result.quantity}</span>
            <span className="text-ink-muted">{result.result.toUnitCode}</span>
            <span className="text-ink-subtle">
              · factor {result.result.factor} ({result.result.basis === "product_specific" ? "product-specific" : "standard"} rule)
            </span>
          </div>
        ) : (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">{result.error}</p>
        )
      ) : (
        <p className="text-[0.6875rem] text-ink-subtle">
          No conversion is assumed. If no rule applies, the test refuses rather than guessing a factor.
        </p>
      )}
    </div>
  );
}
