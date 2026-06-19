/**
 * Check-in window → grid config (formatting ONLY — no date math here).
 *
 * The server (get_check_in_context) computes the rolling window in the player's
 * timezone and returns each day as { date: 'YYYY-MM-DD', dayOfWeek }. This
 * module only turns that into the props HourlyAvailabilityGrid needs: the
 * ordered day columns and a localized label per column. Column labels are
 * relative: "Today", "Tomorrow", then the weekday name (no date number).
 *
 * Weekday names are formatted by reading the literal date back in UTC — NOT in
 * the player timezone. The `date` string already encodes the player-local
 * calendar day, so applying a timezone offset when formatting would shift it
 * (e.g. a UTC-4 zone turns midnight 2026-06-20 into the previous day).
 * Formatting at UTC noon echoes the exact weekday the server's date sent.
 */
import type { DayEnum } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';

import type { CheckInWindowDay } from './api';

const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getWeekdayFormatter(locale: string): Intl.DateTimeFormat {
  const cached = weekdayFormatterCache.get(locale);
  if (cached) return cached;
  const f = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
  weekdayFormatterCache.set(locale, f);
  return f;
}

/** Localized weekday name (e.g. "Friday") from a window day's ISO date. */
export function formatWeekdayName(isoDate: string, locale: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  // UTC noon so the formatter (timeZone: 'UTC') reads back the same weekday.
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return getWeekdayFormatter(locale).format(dt);
}

export interface WindowGridConfig {
  /** Ordered day columns for the grid (the window's 4 weekdays). */
  days: DayEnum[];
  /** Per-day localized date label ("Fri 20"). */
  columnLabels: Partial<Record<DayEnum, string>>;
}

/**
 * Count selected grid cells whose weekday is in `days`. The wizard seeds the
 * grid from ALL of the player's existing availability (7 days) but only edits
 * the window columns, so the Continue gate must count window cells only — not
 * the full set size.
 */
export function countCellsForDays(grid: ReadonlySet<string>, days: DayEnum[]): number {
  if (days.length === 0) return 0;
  const scope = new Set<string>(days);
  let n = 0;
  grid.forEach(key => {
    const day = key.slice(0, key.lastIndexOf('-'));
    if (scope.has(day)) n += 1;
  });
  return n;
}

/**
 * Serialize the selected cells within `days` into sorted {day, hour} slots —
 * the shape the match-opportunities RPC expects. Sorted so the query key stays
 * stable regardless of Set iteration order.
 */
export function slotsForDays(
  grid: ReadonlySet<string>,
  days: DayEnum[]
): { day: DayEnum; hour: number }[] {
  if (days.length === 0) return [];
  const scope = new Set<string>(days);
  const out: { day: DayEnum; hour: number }[] = [];
  grid.forEach(key => {
    const sep = key.lastIndexOf('-');
    const day = key.slice(0, sep);
    if (scope.has(day)) {
      out.push({ day: day as DayEnum, hour: Number(key.slice(sep + 1)) });
    }
  });
  out.sort((a, b) => (a.day === b.day ? a.hour - b.hour : a.day < b.day ? -1 : 1));
  return out;
}

/**
 * Map the server window to grid props. Labels are relative to position:
 * index 0 → "Today", 1 → "Tomorrow", 2+ → the localized weekday name (no date
 * number). The 4 window dates are consecutive, so their weekdays are always
 * distinct — no key collision in `columnLabels`.
 */
export function windowToGridConfig(
  window: CheckInWindowDay[],
  locale: string,
  t: (key: TranslationKey) => string
): WindowGridConfig {
  const days: DayEnum[] = [];
  const columnLabels: Partial<Record<DayEnum, string>> = {};
  window.forEach((w, i) => {
    days.push(w.dayOfWeek);
    columnLabels[w.dayOfWeek] =
      i === 0
        ? t('common.time.today')
        : i === 1
          ? t('common.time.tomorrow')
          : formatWeekdayName(w.date, locale);
  });
  return { days, columnLabels };
}
