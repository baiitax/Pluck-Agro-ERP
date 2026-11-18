import { Search } from "lucide-react";

import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type FilterField =
  | { type: "search"; name: string; label: string; placeholder?: string; defaultValue?: string }
  | {
      type: "select";
      name: string;
      label: string;
      options: { value: string; label: string }[];
      defaultValue?: string;
    };

/** GET-based filter bar: works without client JavaScript and keeps filters in the URL. */
export function FilterBar({ action, fields }: { action: string; fields: FilterField[] }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3">
      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          <Label htmlFor={field.name} className="text-[0.6875rem] text-ink-muted">
            {field.label}
          </Label>
          {field.type === "search" ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle"
                aria-hidden
              />
              <Input
                id={field.name}
                name={field.name}
                defaultValue={field.defaultValue}
                placeholder={field.placeholder ?? "Search…"}
                className="h-8 w-56 pl-8 text-xs"
              />
            </div>
          ) : (
            <Select id={field.name} name={field.name} defaultValue={field.defaultValue ?? ""} className="h-8 w-44 text-xs">
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      ))}
      <Button type="submit" size="sm" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
