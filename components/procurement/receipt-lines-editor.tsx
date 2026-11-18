"use client";

import * as React from "react";

import { Input, Select } from "@/components/ui/input";
import { receiptCheck, receiptSplit } from "@/lib/procurement/calc";

export type ReceivableLine = {
  id: string;
  line_number: number;
  product_description: string;
  product_code_snapshot: string;
  unit_code_snapshot: string;
  quantity: number;
  received_quantity: number;
  outstanding_quantity: number;
  unit_price: number;
};

type Entry = {
  purchaseOrderItemId: string;
  received: string;
  accepted: string;
  rejected: string;
  quarantined: string;
  rejectionReason: string;
  observations: string;
};

const qty = (value: string | number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(Number(value));

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/**
 * Receipt line editor.
 *
 * The receiver records what arrived and how it was split. Two checks run in the browser as the
 * operator types, using the same arithmetic the database uses:
 *   1. received = accepted + rejected + quarantined;
 *   2. received ≤ outstanding (+ the configured tolerance).
 *
 * Neither check is a control — the posting function re-derives the position under a row lock — but
 * catching a mistyped figure here is far cheaper than explaining an over-receipt afterwards.
 */
export function ReceiptLinesEditor({
  lines,
  tolerancePercent,
  currencyCode,
}: {
  lines: ReceivableLine[];
  tolerancePercent: string;
  currencyCode: string;
}) {
  const [entries, setEntries] = React.useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        {
          purchaseOrderItemId: line.id,
          received: "",
          accepted: "",
          rejected: "0",
          quarantined: "0",
          rejectionReason: "",
          observations: "",
        },
      ]),
    ),
  );

  const update = (id: string, patch: Partial<Entry>) =>
    setEntries((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));

  const payload = React.useMemo(
    () =>
      Object.values(entries)
        .filter((entry) => Number(entry.received || 0) > 0)
        .map((entry) => ({
          purchaseOrderItemId: entry.purchaseOrderItemId,
          receivedQuantity: entry.received,
          acceptedQuantity: entry.accepted || "0",
          rejectedQuantity: entry.rejected || "0",
          quarantinedQuantity: entry.quarantined || "0",
          rejectionReason: entry.rejectionReason,
          observations: entry.observations,
        })),
    [entries],
  );

  const problems = React.useMemo(() => {
    const issues: string[] = [];
    for (const line of lines) {
      const entry = entries[line.id];
      if (!entry || Number(entry.received || 0) <= 0) continue;

      const split = receiptSplit({
        received: entry.received,
        accepted: entry.accepted || "0",
        rejected: entry.rejected || "0",
        quarantined: entry.quarantined || "0",
      });
      if (!split.balanced) {
        issues.push(
          `Line ${line.line_number}: accepted + rejected + quarantined must equal the received quantity (${qty(entry.received)} ${line.unit_code_snapshot}).`,
        );
      }
      if (Number(entry.rejected || 0) > 0 && entry.rejectionReason.trim().length < 3) {
        issues.push(`Line ${line.line_number}: state why the rejected quantity is being rejected.`);
      }

      const check = receiptCheck({
        ordered: String(line.quantity),
        previouslyReceived: String(line.received_quantity),
        receiving: entry.received,
        tolerancePercent,
      });
      if (check.exceedsOutstanding) {
        issues.push(
          `Line ${line.line_number}: ${qty(entry.received)} ${line.unit_code_snapshot} exceeds the ${qty(
            check.outstanding,
          )} outstanding by more than the ${tolerancePercent}% tolerance policy allows.`,
        );
      }
    }
    return issues;
  }, [entries, lines, tolerancePercent]);

  return (
    <div className="space-y-3">
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[66rem] text-sm">
          <thead className="bg-surface-muted text-left text-xs text-ink-muted">
            <tr>
              <th className="px-2 py-2 font-medium">Line</th>
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="px-2 py-2 text-right font-medium">Ordered</th>
              <th className="px-2 py-2 text-right font-medium">Received before</th>
              <th className="px-2 py-2 text-right font-medium">Outstanding</th>
              <th className="w-28 px-2 py-2 font-medium">Received now</th>
              <th className="w-28 px-2 py-2 font-medium">Accepted</th>
              <th className="w-28 px-2 py-2 font-medium">Rejected</th>
              <th className="w-28 px-2 py-2 font-medium">Quarantined</th>
              <th className="w-44 px-2 py-2 font-medium">Rejection reason</th>
              <th className="px-2 py-2 text-right font-medium">Accepted value</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const entry = entries[line.id]!;
              const acceptedValue = Number(entry.accepted || 0) * Number(line.unit_price);
              return (
                <tr key={line.id} className="border-t border-border align-top">
                  <td className="px-2 py-2 text-ink-muted">{line.line_number}</td>
                  <td className="px-2 py-2">
                    <p className="font-medium text-ink">{line.product_description}</p>
                    <p className="text-[0.6875rem] text-ink-subtle">
                      {line.product_code_snapshot} · {line.unit_code_snapshot}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(line.quantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(line.received_quantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium">{qty(line.outstanding_quantity)}</td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Received quantity for line ${line.line_number}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={entry.received}
                      onChange={(event) => {
                        const received = event.target.value;
                        // Accepted defaults to everything received until the receiver says otherwise.
                        update(line.id, {
                          received,
                          accepted: entry.accepted === "" || entry.accepted === "" ? received : entry.accepted,
                        });
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Accepted quantity for line ${line.line_number}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={entry.accepted}
                      onChange={(event) => update(line.id, { accepted: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Rejected quantity for line ${line.line_number}`}
                      inputMode="decimal"
                      value={entry.rejected}
                      onChange={(event) => update(line.id, { rejected: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Quarantined quantity for line ${line.line_number}`}
                      inputMode="decimal"
                      value={entry.quarantined}
                      onChange={(event) => update(line.id, { quarantined: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`Rejection reason for line ${line.line_number}`}
                      value={entry.rejectionReason}
                      onChange={(event) => update(line.id, { rejectionReason: event.target.value })}
                    >
                      <option value="">Not applicable</option>
                      <option value="Damaged in transit">Damaged in transit</option>
                      <option value="Below agreed quality">Below agreed quality</option>
                      <option value="Wrong product delivered">Wrong product delivered</option>
                      <option value="Short weight">Short weight</option>
                      <option value="Excess quantity delivered">Excess quantity delivered</option>
                      <option value="Documentation incomplete">Documentation incomplete</option>
                      <option value="Other — see observations">Other — see observations</option>
                    </Select>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {acceptedValue > 0 ? `${currencyCode} ${money(acceptedValue)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {problems.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-warning-600/25 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-subtle">
          Only accepted quantity can become inventory. Rejected and quarantined quantities stay separate and are
          never netted off against what arrived.
        </p>
      )}
    </div>
  );
}
