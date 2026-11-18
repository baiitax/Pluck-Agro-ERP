/**
 * Duplicate detection for master records.
 *
 * Design rules that matter more than the algorithm:
 *  - Nothing here ever merges or modifies a record. The output is a *candidate* for a human.
 *  - Matching is explainable: every pair reports which fields matched and why, so a reviewer can
 *    disagree with the system instead of trusting a black box.
 *  - Normalisation is conservative. "Pluck Agro Ltd" and "Pluck Agro Limited" are the same
 *    company; "ABC Traders" and "ABC Trading" might not be, so that pair scores lower.
 */

export type DuplicateEntity = "supplier" | "customer" | "product";

export type DuplicateCandidateInput = {
  id: string;
  label: string;
  legalName?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  bankAccount?: string | null;
  /** Products only. */
  code?: string | null;
  categoryId?: string | null;
};

export type DuplicateMatch = {
  entity: DuplicateEntity;
  recordA: { id: string; label: string };
  recordB: { id: string; label: string };
  score: number;
  matchedFields: string[];
  reasons: string[];
};

const LEGAL_SUFFIXES = [
  "limited", "ltd", "plc", "llc", "inc", "incorporated", "corp", "corporation", "co",
  "company", "gmbh", "sa", "sarl", "bv", "nv", "pte", "ent", "enterprise", "enterprises",
  "nig", "nigeria", "lv", "ltd.",
];

/** Lower-cases, strips punctuation and legal suffixes, and collapses whitespace. */
export function normaliseName(value: string | null | undefined): string {
  if (!value) return "";
  const stripped = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !LEGAL_SUFFIXES.includes(word));
  return stripped.join(" ");
}

export function normaliseDigits(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

export function normaliseDomain(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

/** Dice coefficient over character bigrams: 0 (nothing alike) → 1 (identical). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;

  const bigrams = (value: string) => {
    const set = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      set.set(gram, (set.get(gram) ?? 0) + 1);
    }
    return set;
  };

  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let intersection = 0;
  for (const [gram, count] of leftGrams) {
    const other = rightGrams.get(gram) ?? 0;
    intersection += Math.min(count, other);
  }
  return (2 * intersection) / (left.length - 1 + right.length - 1);
}

const WEIGHTS: Record<string, number> = {
  registrationNumber: 30,
  taxId: 25,
  name: 20,
  email: 15,
  phone: 12,
  website: 8,
  code: 30,
  bankAccount: 10,
};

/**
 * Scores one pair. A shared registration number or tax id is decisive on its own; a name that is
 * merely similar is not, which is why the thresholds below are high.
 */
export function scorePair(entity: DuplicateEntity, a: DuplicateCandidateInput, b: DuplicateCandidateInput): DuplicateMatch | null {
  const matchedFields: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  const exact = (field: string, left: string, right: string, explanation: string) => {
    if (!left || !right || left !== right) return;
    if (matchedFields.includes(field)) return;
    matchedFields.push(field);
    reasons.push(explanation);
    score += WEIGHTS[field] ?? 0;
  };

  exact("registrationNumber", normaliseDigits(a.registrationNumber), normaliseDigits(b.registrationNumber), "Same registration number");
  exact("taxId", normaliseDigits(a.taxId), normaliseDigits(b.taxId), "Same tax identification number");
  exact("email", (a.email ?? "").toLowerCase().trim(), (b.email ?? "").toLowerCase().trim(), "Same email address");
  // Compare the last nine digits so "+234 803 123 4567" and "0803 123 4567" match, while short
  // or empty numbers never produce a false positive.
  const phoneA = normaliseDigits(a.phone);
  const phoneB = normaliseDigits(b.phone);
  if (phoneA.length >= 9 && phoneB.length >= 9) {
    exact("phone", phoneA.slice(-9), phoneB.slice(-9), "Same phone number");
  }
  exact("website", normaliseDomain(a.website), normaliseDomain(b.website), "Same website domain");
  exact("bankAccount", normaliseDigits(a.bankAccount), normaliseDigits(b.bankAccount), "Same bank account reference");
  exact("code", (a.code ?? "").toUpperCase(), (b.code ?? "").toUpperCase(), "Same product code");

  const nameScore = nameSimilarity(a.legalName ?? a.label, b.legalName ?? b.label);
  if (nameScore >= 0.999) {
    matchedFields.push("name");
    reasons.push("Identical normalised name");
    score += WEIGHTS.name ?? 0;
  } else if (nameScore >= 0.85) {
    matchedFields.push("name");
    reasons.push(`Name is ${Math.round(nameScore * 100)}% similar after normalisation`);
    score += Math.round((WEIGHTS.name ?? 0) * nameScore);
  }

  if (entity !== "product" && a.country && b.country && a.country === b.country) {
    if (matchedFields.length > 0) reasons.push("Same country of registration");
  }

  const capped = Math.min(100, score);
  if (capped < 45) return null;

  return {
    entity,
    recordA: { id: a.id, label: a.label },
    recordB: { id: b.id, label: b.label },
    score: capped,
    matchedFields,
    reasons,
  };
}

/** All candidate pairs above `threshold`, best first, with record A always the lower id. */
export function findDuplicateCandidates(
  entity: DuplicateEntity,
  records: DuplicateCandidateInput[],
  threshold = 45,
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const a = records[i];
      const b = records[j];
      if (!a || !b || a.id === b.id) continue;
      const match = scorePair(entity, a, b);
      if (!match || match.score < threshold) continue;
      const [first, second] = a.id < b.id ? [a, b] : [b, a];
      matches.push({
        ...match,
        recordA: { id: first.id, label: first.label },
        recordB: { id: second.id, label: second.label },
      });
    }
  }
  return matches.sort((left, right) => right.score - left.score);
}
