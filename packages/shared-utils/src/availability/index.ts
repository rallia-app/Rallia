import type { DayEnum } from '@rallia/shared-types';

/**
 * The weekly availability grid's shape and cell encoding.
 *
 * Extracted from the mobile onboarding grid so mobile, the web onboarding wizard and
 * the weekly check-in all agree on which hours exist and how a selected cell is keyed.
 * A drift here is silent and expensive: cells written under one encoding simply do not
 * match under another, and the player looks unavailable.
 */

/** Hour cells the grid supports: 06..22 inclusive (17 cells). */
export const SUPPORTED_HOURS: number[] = Array.from({ length: 17 }, (_, i) => i + 6);

/** Display and storage order. Monday-first, matching the product's week. */
export const ORDERED_DAYS: DayEnum[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Selection state. Keys are `${day}-${hour}` strings — a flat representation so one
 * Set clone per drag tick stays cheap.
 */
export type HourGrid = ReadonlySet<string>;

export function cellKey(day: DayEnum, hour: number): string {
  return `${day}-${hour}`;
}

/** Inverse of cellKey. Returns null for anything not a well-formed cell. */
export function parseCellKey(key: string): { day: DayEnum; hour: number } | null {
  const separator = key.lastIndexOf('-');
  if (separator <= 0) return null;

  const day = key.slice(0, separator) as DayEnum;
  const hour = Number(key.slice(separator + 1));

  if (!ORDERED_DAYS.includes(day) || !Number.isInteger(hour)) return null;
  if (!SUPPORTED_HOURS.includes(hour)) return null;

  return { day, hour };
}

/** Build an empty grid (no cells selected). */
export function emptyGrid(): HourGrid {
  return new Set();
}

/** Total cells selected. */
export function countSelected(grid: HourGrid): number {
  return grid.size;
}

/**
 * Minimum cells onboarding requires before a player can continue.
 * Fewer than this and the matchmaking engine has too little to work with.
 */
export const MIN_AVAILABILITY_CELLS = 6;

const WEEKDAYS: DayEnum[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const WEEKEND: DayEnum[] = ['saturday', 'sunday'];

/** True for Saturday and Sunday — both grids tint those columns. */
export function isWeekendDay(day: DayEnum): boolean {
  return WEEKEND.includes(day);
}

/**
 * Day parts, in grid order. Used to band the hour rows so a player can find
 * "weekday evenings" without reading every label.
 */
export const DAY_PARTS: Array<{ key: 'morning' | 'afternoon' | 'evening'; hours: number[] }> = [
  { key: 'morning', hours: SUPPORTED_HOURS.filter(h => h < 12) },
  { key: 'afternoon', hours: SUPPORTED_HOURS.filter(h => h >= 12 && h < 17) },
  { key: 'evening', hours: SUPPORTED_HOURS.filter(h => h >= 17) },
];

const hourFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getHourFormatter(locale: string): Intl.DateTimeFormat {
  const cached = hourFormatterCache.get(locale);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    // English reads 7 PM; French-Canadian reads 19 h. Following the locale beats
    // a zero-padded 24h label nobody has to translate but everybody has to decode.
    hour12: locale.toLowerCase().startsWith('en'),
  });
  hourFormatterCache.set(locale, formatter);
  return formatter;
}

/** Locale-aware label for an hour cell, e.g. "7 PM" (en-US) or "19 h" (fr-CA). */
export function formatHourLabel(hour: number, locale: string): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return getHourFormatter(locale).format(date);
}

function buildCells(days: ReadonlyArray<DayEnum>, hours: ReadonlyArray<number>): string[] {
  const out: string[] = [];
  for (const d of days) for (const h of hours) out.push(cellKey(d, h));
  return out;
}

export type AvailabilityPresetKey = 'afterWork' | 'weekendsAny' | 'lunch' | 'mornings';

export interface AvailabilityPreset {
  key: AvailabilityPresetKey;
  cells: ReadonlyArray<string>;
}

/**
 * One-tap selection patterns for the grid. Labels live under
 * `onboarding.availabilityStep.presets.{key}`; each platform renders its own chips.
 *
 * Hour ranges (cell h = the [h:00, h+1:00) window):
 *   afterWork    Mon–Fri 17:00–22:00
 *   weekendsAny  Sat–Sun all 17 hours
 *   lunch        Mon–Fri 12:00–13:00
 *   mornings     Daily   06:00–09:00
 */
export const AVAILABILITY_PRESETS: AvailabilityPreset[] = [
  { key: 'afterWork', cells: buildCells(WEEKDAYS, [17, 18, 19, 20, 21, 22]) },
  { key: 'weekendsAny', cells: buildCells(WEEKEND, SUPPORTED_HOURS) },
  { key: 'lunch', cells: buildCells(WEEKDAYS, [12]) },
  { key: 'mornings', cells: buildCells(ORDERED_DAYS, [6, 7, 8]) },
];

/** A preset reads as applied only when every one of its cells is selected. */
export function isPresetApplied(grid: HourGrid, preset: AvailabilityPreset): boolean {
  return preset.cells.every(cell => grid.has(cell));
}

/** Adds the preset's cells, or removes exactly them when already fully applied. */
export function togglePreset(grid: HourGrid, preset: AvailabilityPreset): HourGrid {
  const next = new Set(grid);
  if (isPresetApplied(grid, preset)) {
    for (const cell of preset.cells) next.delete(cell);
  } else {
    for (const cell of preset.cells) next.add(cell);
  }
  return next;
}
