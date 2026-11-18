import { describe, expect, it } from "vitest";

import {
  findDuplicateCandidates,
  nameSimilarity,
  normaliseDigits,
  normaliseDomain,
  normaliseName,
  scorePair,
  type DuplicateCandidateInput,
} from "@/lib/master-data/similarity";

const supplier = (overrides: Partial<DuplicateCandidateInput> = {}): DuplicateCandidateInput => ({
  id: "a",
  label: "Alpha Ltd",
  legalName: "Alpha Ltd",
  registrationNumber: "RC 123456",
  taxId: "TIN-99887766",
  email: "accounts@alpha.example",
  phone: "+234 803 123 4567",
  website: "https://www.alpha.example",
  country: "NG",
  ...overrides,
});

describe("duplicate similarity", () => {
  it("normalises names by case, punctuation and legal suffixes", () => {
    expect(normaliseName("  Alpha  Enterprises, LTD. ")).toBe(normaliseName("alpha enterprises limited"));
    expect(normaliseName("Bello & Sons Nig. Ltd")).toContain("bello");
  });

  it("normalises digits and domains, ignoring formatting noise", () => {
    expect(normaliseDigits("+234 803-123-4567")).toBe("2348031234567");
    expect(normaliseDigits("abc")).toBe("");
    expect(normaliseDomain("https://www.Alpha.example/contact")).toBe("alpha.example");
    expect(normaliseDomain(null)).toBe("");
  });

  it("scores identical names as an exact-ish match and unrelated names as low", () => {
    expect(nameSimilarity("Alpha Ltd", "Alpha Limited")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("Alpha Ltd", "Zeta Foods")).toBeLessThan(0.5);
  });

  it("does not treat two missing phone numbers as a match", () => {
    const left = supplier({ phone: null, email: null, website: null, registrationNumber: null, taxId: null, legalName: "Alpha Ltd" });
    const right = supplier({ id: "b", phone: null, email: null, website: null, registrationNumber: null, taxId: null, legalName: "Zeta Foods" });
    const match = scorePair("supplier", left, right);
    expect(match?.matchedFields ?? []).not.toContain("phone");
    expect(match === null || match.score < 45).toBe(true);
  });

  it("surfaces a candidate when a registration number repeats", () => {
    const match = scorePair("supplier", supplier(), supplier({ id: "b", legalName: "Alpha Trading", email: "other@example.test" }));
    expect(match).not.toBeNull();
    expect(match?.matchedFields).toContain("registrationNumber");
  });

  it("never returns a candidate below the configured floor", () => {
    const candidates = findDuplicateCandidates("supplier", [
      supplier(),
      supplier({ id: "b", legalName: "Completely Different Company", registrationNumber: null, taxId: null, email: null, phone: null, website: null }),
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("returns each pair once and never pairs a record with itself", () => {
    const records = [
      supplier({ id: "1" }),
      supplier({ id: "2" }),
      supplier({ id: "3", legalName: "Alpha Limited" }),
    ];
    const candidates = findDuplicateCandidates("supplier", records);
    expect(candidates.every((candidate) => candidate.recordA.id !== candidate.recordB.id)).toBe(true);
    const keys = candidates.map((candidate) => [candidate.recordA.id, candidate.recordB.id].sort().join(":"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sorts candidates by descending score so the strongest signal is reviewed first", () => {
    const candidates = findDuplicateCandidates("supplier", [
      supplier({ id: "1" }),
      supplier({ id: "2" }),
      supplier({ id: "3", legalName: "Alpha Ltd" }),
    ] as DuplicateCandidateInput[]);
    const scores = candidates.map((candidate) => candidate.score);
    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
  });
});
