import type { ReactNode } from "react";

/** Label/value pairs used across the profile tabs. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">{item.label}</dt>
          <dd className="mt-0.5 truncate text-xs text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
