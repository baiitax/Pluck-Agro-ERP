import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, formatRelative } from "@/lib/formatting";
import { cn, getInitials, titleCase } from "@/lib/utils";

describe("formatting", () => {
  it("formats business dates and timestamps", () => {
    expect(formatDate("2026-11-17T09:30:00Z")).toBe("17 Nov 2026");
    expect(formatDateTime("2026-11-17T09:30:00Z")).toContain("17 Nov 2026");
  });

  it("returns a placeholder instead of crashing on bad input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatRelative(undefined)).toBe("—");
  });

  it("describes recent timestamps relatively", () => {
    expect(formatRelative(new Date(Date.now() - 3_600_000).toISOString())).toContain("ago");
  });
});

describe("utils", () => {
  it("builds initials safely", () => {
    expect(getInitials("Ada Ngozi Obi")).toBe("AO");
    expect(getInitials("Ada")).toBe("A");
    expect(getInitials(null)).toBe("?");
  });

  it("title-cases codes and slugs", () => {
    expect(titleCase("super_administrator")).toBe("Super Administrator");
    expect(titleCase("goods-receipt")).toBe("Goods Receipt");
  });

  it("merges conflicting tailwind classes predictably", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
