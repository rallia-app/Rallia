import type { FacilityAvailabilitySlotRow } from '@rallia/shared-types';

import { createClient } from '@/lib/supabase/client';

import type { TimeDayOption } from './time-selection';

const SNAPSHOT_COLUMNS =
  'external_court_id, slot_start, slot_end, external_slot_id, court_name, court_number, price_cents, currency, source';

function mapSnapshotRow(row: {
  external_court_id: string;
  slot_start: string;
  slot_end: string;
  external_slot_id: string | null;
  court_name: string | null;
  court_number: number | null;
  price_cents: number | null;
  currency: string | null;
  source: string;
}): FacilityAvailabilitySlotRow {
  return {
    ...row,
    sport_id: null,
    booking_url: null,
  };
}

/** Calendar date key (YYYY-MM-DD) for a moment in the given IANA timezone. */
export function getDateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Local calendar date for a wizard day option in the facility timezone. */
export function getDayDateKey(
  day: TimeDayOption,
  timezone: string,
  now: Date = new Date()
): string {
  const todayKey = getDateKeyInTimezone(now, timezone);
  if (day === 'today') return todayKey;

  const [year, month, dayNum] = todayKey.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, dayNum + 1));
  return `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
}

function getSlotDateKey(slotStart: string, timezone: string): string {
  return getDateKeyInTimezone(new Date(slotStart), timezone);
}

function getSlotHour(slotStart: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(slotStart));

  return Number.parseInt(parts.find(part => part.type === 'hour')?.value ?? '0', 10);
}

function isFutureSlot(slotStart: string, now: Date): boolean {
  return new Date(slotStart).getTime() > now.getTime();
}

/** Total open snapshot rows on a calendar day at the facility. */
export function countAvailabilitySlotsForDay(
  slots: FacilityAvailabilitySlotRow[],
  day: TimeDayOption,
  timezone: string,
  now: Date = new Date()
): number {
  const dayKey = getDayDateKey(day, timezone, now);

  return slots.filter(
    slot =>
      isFutureSlot(slot.slot_start, now) && getSlotDateKey(slot.slot_start, timezone) === dayKey
  ).length;
}

/** Open snapshot rows starting at a specific local hour on a wizard day. */
export function countAvailabilitySlotsForHour(
  slots: FacilityAvailabilitySlotRow[],
  day: TimeDayOption,
  hour: number,
  timezone: string,
  now: Date = new Date()
): number {
  const dayKey = getDayDateKey(day, timezone, now);

  return slots.filter(slot => {
    if (!isFutureSlot(slot.slot_start, now)) return false;
    if (getSlotDateKey(slot.slot_start, timezone) !== dayKey) return false;
    return getSlotHour(slot.slot_start, timezone) === hour;
  }).length;
}

export type HourAvailabilityTier = 'none' | 'low' | 'medium' | 'high';

/** Peak open court count across the listed hours for a day (for relative tiering). */
export function getMaxAvailabilityCountForHours(
  slots: FacilityAvailabilitySlotRow[],
  day: TimeDayOption,
  hours: readonly number[],
  timezone: string,
  now: Date = new Date()
): number {
  let max = 0;
  for (const hour of hours) {
    const count = countAvailabilitySlotsForHour(slots, day, hour, timezone, now);
    if (count > max) max = count;
  }
  return max;
}

/** Relative availability tier for an hour vs the busiest hour that day. */
export function getHourAvailabilityTier(
  openCount: number,
  maxOpenCount: number
): HourAvailabilityTier {
  if (openCount <= 0) return 'none';
  if (maxOpenCount <= 1) return 'high';

  const ratio = openCount / maxOpenCount;
  if (ratio >= 0.66) return 'high';
  if (ratio >= 0.34) return 'medium';
  return 'low';
}

export async function fetchFacilityAvailabilitySlots(
  facilityId: string
): Promise<FacilityAvailabilitySlotRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('facility_availability_snapshot')
    .select(SNAPSHOT_COLUMNS)
    .eq('facility_id', facilityId)
    .eq('is_available', true)
    .gt('slot_start', new Date().toISOString())
    .order('slot_start', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapSnapshotRow);
}
