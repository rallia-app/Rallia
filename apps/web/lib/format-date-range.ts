/**
 * Locale-aware date range for tournament/league date pairs ("YYYY-MM-DD" or
 * UTC-midnight timestamptz strings — only the date part is read).
 * Collapses same-day ranges to a single date and lets Intl merge shared
 * month/year parts (e.g. "August 15 – 17, 2026" / "15 – 17 août 2026").
 */
export function formatDateRange(start: string, end: string | null, locale: string): string {
  const parse = (d: string) => {
    const [year, month, day] = d.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  };
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const startDate = parse(start);
  const endDate = parse(end || start);
  return startDate.getTime() === endDate.getTime()
    ? formatter.format(startDate)
    : formatter.formatRange(startDate, endDate);
}
