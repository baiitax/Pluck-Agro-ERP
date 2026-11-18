/** Access review periods: `YYYY-Qn` quarters or `YYYY-MM` months. */
const PERIOD_PATTERN = /^(\d{4})-(Q[1-4]|0[1-9]|1[0-2])$/;

export function isValidReviewPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

export function currentReviewPeriod(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based
  return `${year}-Q${Math.floor(month / 3) + 1}`;
}

export function reviewPeriodLabel(period: string): string {
  const match = PERIOD_PATTERN.exec(period);
  if (!match) return period;
  const year = match[1] ?? "";
  const suffix = match[2] ?? "";
  if (suffix.startsWith("Q")) return `${suffix} ${year}`;
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${monthNames[Number(suffix) - 1]} ${year}`;
}

export function recentReviewPeriods(count = 4, date: Date = new Date()): string[] {
  const periods: string[] = [];
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  for (let index = 0; index < count; index += 1) {
    periods.push(currentReviewPeriod(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() - 3);
  }
  return periods;
}
