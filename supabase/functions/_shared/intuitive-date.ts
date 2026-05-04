/**
 * Intuitive date formatting — Deno port of
 * `packages/shared-utils/src/formatters/dateFormatter.ts`'s
 * `formatIntuitiveDateInTimezone`.
 *
 * Returns "Today" / "Tomorrow" / weekday name / "Mon DD" depending on how
 * far the target date is from today (in the given timezone). Used by email
 * templates so the digest matches the in-app card formatting.
 */

export type IntuitiveDateType = 'today' | 'tomorrow' | 'weekday' | 'date';

export interface IntuitiveDateResult {
  type: IntuitiveDateType;
  /** Set when the caller should swap in a translated "Today" / "Tomorrow"
   *  string. Null for weekday/date types where `formattedDate` is canonical. */
  translationKey: 'digest.dateLabel.today' | 'digest.dateLabel.tomorrow' | null;
  /** Formatted weekday or "Mon DD". Empty for today/tomorrow. */
  formattedDate: string;
  /** Caller-friendly label — same as `formattedDate` unless the caller
   *  supplied a `todayLabel` / `tomorrowLabel` override. */
  label: string;
}

/** Get the YYYY-MM-DD date string for today in a specific timezone. */
function getDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function getDaysDifference(dateStr: string, timezone: string): number {
  const today = getDateInTimezone(new Date(), timezone);
  const todayDate = new Date(today + 'T00:00:00');
  const targetDate = new Date(dateStr + 'T00:00:00');
  const diffMs = targetDate.getTime() - todayDate.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export interface IntuitiveDateLabels {
  today: string;
  tomorrow: string;
}

/**
 * Format a date intuitively. Returns `{type, label, ...}`.
 *
 *   - Today      → labels.today
 *   - Tomorrow   → labels.tomorrow
 *   - Days 2..6  → "Wednesday" / "Mercredi"
 *   - Otherwise  → "Mon, Jan 6" / "Lun. 6 janv."
 */
export function formatIntuitiveDate(
  dateStr: string,
  timezone: string,
  locale: string,
  labels: IntuitiveDateLabels
): IntuitiveDateResult {
  const tz = timezone || 'UTC';
  const today = getDateInTimezone(new Date(), tz);
  const tomorrow = getDateInTimezone(new Date(Date.now() + 86_400_000), tz);

  if (dateStr === today) {
    return {
      type: 'today',
      translationKey: 'digest.dateLabel.today',
      formattedDate: '',
      label: labels.today,
    };
  }
  if (dateStr === tomorrow) {
    return {
      type: 'tomorrow',
      translationKey: 'digest.dateLabel.tomorrow',
      formattedDate: '',
      label: labels.tomorrow,
    };
  }

  const daysDiff = getDaysDifference(dateStr, tz);
  // Use noon to avoid edge-of-day surprises in the formatter.
  const refDate = new Date(`${dateStr}T12:00:00`);

  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekday = capitalizeFirst(
      new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long' }).format(refDate)
    );
    return {
      type: 'weekday',
      translationKey: null,
      formattedDate: weekday,
      label: weekday,
    };
  }

  const formatted = capitalizeFirst(
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(refDate)
  );
  return {
    type: 'date',
    translationKey: null,
    formattedDate: formatted,
    label: formatted,
  };
}

/**
 * Cheap heuristic — pick a sensible IANA timezone from the user's preferred
 * locale when we don't have a per-row timezone. Good enough for "is this
 * Today vs Tomorrow" labels in the digest.
 */
export function timezoneForLocale(locale: string): string {
  if (locale.startsWith('fr')) return 'America/Montreal';
  return 'America/New_York';
}
