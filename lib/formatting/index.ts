import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

const FALLBACK = "—";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy") : FALLBACK;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy, HH:mm") : FALLBACK;
}

export function formatDateTimeWithZone(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy, HH:mm 'UTC'xxx") : FALLBACK;
}

export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return FALLBACK;
  return `${formatDistanceToNowStrict(date)} ago`;
}
