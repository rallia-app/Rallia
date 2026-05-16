/**
 * Period ↔ hour bridge
 *
 * Transitional helpers used while the availability UI still composes 6-block
 * period grids on top of the new per-hour `player_availability.hour_of_day`
 * column. Once the UI is rewritten to hourly cells (PR B), this module and
 * its consumers should be deleted along with `PeriodEnum`.
 *
 * Mapping is the same one used by the SQL backfill in
 * `20260516184214_player_availability_hourly.sql`. Keep both sides in sync.
 */
import type { PeriodEnum, AvailabilityHour } from '@rallia/shared-types';

export const PERIOD_TO_HOURS: Record<PeriodEnum, ReadonlyArray<AvailabilityHour>> = {
  early: [6, 7, 8],
  morning: [9, 10, 11],
  midday: [12, 13],
  afternoon: [14, 15, 16],
  evening: [17, 18, 19],
  late: [20, 21, 22],
};

const HOUR_TO_PERIOD: Record<AvailabilityHour, PeriodEnum> = (() => {
  const m: Record<AvailabilityHour, PeriodEnum> = {} as Record<AvailabilityHour, PeriodEnum>;
  (Object.entries(PERIOD_TO_HOURS) as Array<[PeriodEnum, ReadonlyArray<AvailabilityHour>]>).forEach(
    ([p, hours]) => {
      hours.forEach(h => {
        m[h] = p;
      });
    }
  );
  return m;
})();

/**
 * Expand a single period into its hour cells.
 */
export function expandPeriodToHours(period: PeriodEnum): ReadonlyArray<AvailabilityHour> {
  return PERIOD_TO_HOURS[period] ?? [];
}

/**
 * Map an individual hour back to its containing period.
 *
 * Returns undefined for hours outside the supported 6..22 range. Used by
 * read paths that still render a period grid: "if any hour in the early
 * band is active, mark early as selected."
 */
export function periodForHour(hour: AvailabilityHour): PeriodEnum | undefined {
  return HOUR_TO_PERIOD[hour];
}

/**
 * Collapse a set of selected hours back to the set of periods they cover.
 * A period is "covered" if at least one of its hours is in the input set.
 * Used to render the legacy 6×7 grid from hourly data.
 */
export function periodsCoveredByHours(
  hours: ReadonlyArray<AvailabilityHour>
): ReadonlySet<PeriodEnum> {
  const out = new Set<PeriodEnum>();
  for (const h of hours) {
    const p = HOUR_TO_PERIOD[h];
    if (p) out.add(p);
  }
  return out;
}
