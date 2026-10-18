/** Calendar-day arithmetic on ISO dates (YYYY-MM-DD) without time zones, for the date picker. */
export interface CalendarDay { iso: string; year: number; month: number; day: number }

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

export function toIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseIsoDate(value: string | undefined | null): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  return toIsoDate(year, month, day) === value ? { iso: value!, year, month, day } : null;
}

export function addDays(iso: string, days: number): string {
  const day = parseIsoDate(iso)!;
  return toIsoDate(day.year, day.month, day.day + days);
}

/** Moves by whole months; the day is clamped to the target month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const day = parseIsoDate(iso)!;
  const target = new Date(Date.UTC(day.year, day.month - 1 + months, 1));
  const length = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return toIsoDate(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(day.day, length));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  const day = parseIsoDate(iso)!;
  return (new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() + 6) % 7;
}

/** Six Monday-first weeks covering the month of `iso`, including leading and trailing days of neighbouring months. */
export function monthGrid(iso: string): CalendarDay[][] {
  const first = parseIsoDate(iso)!;
  const firstOfMonth = toIsoDate(first.year, first.month, 1);
  const start = addDays(firstOfMonth, -weekdayIndex(firstOfMonth));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, offset) => parseIsoDate(addDays(start, week * 7 + offset))!));
}

export function todayIso(now = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function formatDate(iso: string | undefined | null, locale = 'de-DE'): string {
  const day = parseIsoDate(iso);
  return day ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(day.year, day.month - 1, day.day))) : '';
}

export function formatLongDate(iso: string, locale = 'de-DE'): string {
  const day = parseIsoDate(iso)!;
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

export function formatMonth(iso: string, locale = 'de-DE'): string {
  const day = parseIsoDate(iso)!;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(day.year, day.month - 1, 1)));
}

export function weekdayLabels(locale = 'de-DE'): Array<{ short: string; long: string }> {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + index));
    return {
      short: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date).replace('.', ''),
      long: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date),
    };
  });
}
