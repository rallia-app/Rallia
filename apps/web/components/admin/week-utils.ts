/** Monday of the ISO week containing the given ISO date (matches Postgres date_trunc('week')). */
export function weekStartOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().split('T')[0];
}

/** Mondays of the last n ISO weeks, oldest first, ending with the current week. */
export function lastNWeekStarts(n: number): string[] {
  const current = weekStartOf(new Date().toISOString().split('T')[0]);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${current}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i) * 7);
    return d.toISOString().split('T')[0];
  });
}

/** Days back from today to the Monday n-1 weeks ago — a fetch span covering the last n ISO weeks. */
export function daysCoveringLastNWeeks(n: number): number {
  return ((new Date().getUTCDay() + 6) % 7) + (n - 1) * 7;
}

/** ISO dates (YYYY-MM-DD) of the last n calendar days, oldest first, ending today (UTC). */
export function lastNDayStarts(n: number): string[] {
  const today = new Date().toISOString().split('T')[0];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().split('T')[0];
  });
}

export function formatWeekLabel(weekStart: string, locale: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Compact axis label for an ISO week start (the Monday, e.g. "May 5"). */
export function shortWeekLabel(weekStart: string, locale: string): string {
  return new Date(`${weekStart}T00:00:00`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

/** Compact axis label for a single ISO day (e.g. "May 5"). */
export function shortDayLabel(dayStart: string, locale: string): string {
  return new Date(`${dayStart}T00:00:00`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}
