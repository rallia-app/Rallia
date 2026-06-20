export const FLEXIBLE_TIME_SLOT = 'flexible_48h';

export const TIME_DAY_OPTIONS = ['today', 'tomorrow', 'dayAfter'] as const;
export type TimeDayOption = (typeof TIME_DAY_OPTIONS)[number];

/** First selectable hour (inclusive), local time. */
export const PLAY_HOUR_START = 6;
/** Last selectable hour (inclusive), local time — 11 PM slot. */
export const PLAY_HOUR_END = 23;

/** Rolling booking window: today, tomorrow, and the day after. */
const BOOKING_WINDOW_MS = 72 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getDateForDay(day: TimeDayOption, now: Date = new Date()): Date {
  const d = startOfLocalDay(now);
  if (day === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (day === 'dayAfter') d.setDate(d.getDate() + 2);
  return d;
}

/** Localized weekday name (e.g. "Monday") for a day option. */
export function getDayWeekdayName(
  day: TimeDayOption,
  locale: string,
  now: Date = new Date()
): string {
  const name = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(getDateForDay(day, now));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function getPlayHours(): number[] {
  const hours: number[] = [];
  for (let hour = PLAY_HOUR_START; hour <= PLAY_HOUR_END; hour++) {
    hours.push(hour);
  }
  return hours;
}

export const TIME_HOUR_GROUPS = [
  { id: 'morning', hours: [6, 7, 8, 9, 10, 11] },
  { id: 'afternoon', hours: [12, 13, 14, 15, 16, 17] },
  { id: 'evening', hours: [18, 19, 20, 21, 22, 23] },
] as const;

export type TimeHourGroupId = (typeof TIME_HOUR_GROUPS)[number]['id'];

export function formatHourLabel(hour: number, locale: string, compact = false): string {
  const ref = new Date(2000, 0, 1);
  ref.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    ...(compact ? {} : { minute: '2-digit' }),
  }).format(ref);
}

function getHourBounds(
  day: TimeDayOption,
  hour: number,
  now: Date = new Date()
): { start: Date; end: Date } {
  const date = getDateForDay(day, now);
  const start = new Date(date);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(date);
  end.setHours(hour + 1, 0, 0, 0);
  return { start, end };
}

export function isHourSelectable(
  day: TimeDayOption,
  hour: number,
  now: Date = new Date()
): boolean {
  if (hour < PLAY_HOUR_START || hour > PLAY_HOUR_END) return false;
  const max = new Date(now.getTime() + BOOKING_WINDOW_MS);
  const { start } = getHourBounds(day, hour, now);
  return start < max && start > now;
}

export function getSelectableHours(day: TimeDayOption, now: Date = new Date()): number[] {
  return getPlayHours().filter(hour => isHourSelectable(day, hour, now));
}

export function isDaySelectable(day: TimeDayOption, now: Date = new Date()): boolean {
  return getSelectableHours(day, now).length > 0;
}

export function encodeTimeSlot(day: TimeDayOption, hour: number): string {
  return `${day}|${hour}`;
}

export function parseTimeSlot(value: string): { day: TimeDayOption; hour: number } | null {
  if (value === FLEXIBLE_TIME_SLOT) return null;
  const [day, hourRaw, legacyEndRaw] = value.split('|');
  if (!TIME_DAY_OPTIONS.includes(day as TimeDayOption)) return null;

  const hour = Number(hourRaw);
  if (!Number.isInteger(hour)) return null;

  // Legacy range slots (day|start|end) — treat the start hour as the selected time.
  if (legacyEndRaw !== undefined && Number.isInteger(Number(legacyEndRaw))) {
    return { day: day as TimeDayOption, hour };
  }

  return { day: day as TimeDayOption, hour };
}

export function isValidTimeSlot(value: string, now: Date = new Date()): boolean {
  if (value === FLEXIBLE_TIME_SLOT) return true;
  const parsed = parseTimeSlot(value);
  if (!parsed) return false;
  return isHourSelectable(parsed.day, parsed.hour, now);
}

export function isFlexibleTimeSlot(value: string): boolean {
  return value === FLEXIBLE_TIME_SLOT;
}
