import {
  pickTopGlobal,
  generateFixedHourSlots,
  hasTimeConflict,
  type BusySlot,
} from './suggestionService';
import type { OverlapSlot } from './suggestionService';

function makeTriplet(opts: {
  opponentId: string;
  facilityId?: string;
  dateKey: string;
  hour?: number;
  score: number;
}) {
  const date = new Date(`${opts.dateKey}T${String(opts.hour ?? 14).padStart(2, '0')}:00:00`);
  return {
    row: {
      opponent_id: opts.opponentId,
      opponent_first_name: 'Op',
      opponent_last_name: opts.opponentId,
      opponent_avatar: null,
      opponent_reputation_score: null,
      opponent_reputation_tier: 'unknown',
      opponent_rating_value: 4.0,
      opponent_rating_label: '4.0',
      opponent_badge_status: null,
      facility_id: opts.facilityId ?? `f:${opts.opponentId}`,
      facility_name: 'Court A',
      facility_address: '',
      facility_city: '',
      facility_data_provider_id: null,
      facility_provider_type: null,
      facility_external_id: null,
      facility_booking_url_tpl: null,
      facility_timezone: null,
      overlapping_days_periods: [],
      match_type: 'casual',
      match_duration: '60',
      player_compatibility: 0.5,
      facility_affinity: 0.5,
      matchup_score: 0.5,
    } as Parameters<typeof pickTopGlobal>[0][number]['row'],
    slot: {
      datetime: date,
      endDatetime: new Date(date.getTime() + 60 * 60 * 1000),
      bookingUrl: null,
    },
    dateKey: opts.dateKey,
    score: opts.score,
  };
}

describe('pickTopGlobal', () => {
  it('returns an empty array when there are no triplets', () => {
    expect(pickTopGlobal([], 5)).toEqual([]);
  });

  it('returns an empty array when maxItems is 0 or negative', () => {
    const triplets = [makeTriplet({ opponentId: 'o1', dateKey: '2026-05-06', score: 0.9 })];
    expect(pickTopGlobal(triplets, 0)).toEqual([]);
    expect(pickTopGlobal(triplets, -3)).toEqual([]);
  });

  it('caps output at maxItems, sorted by score desc', () => {
    const triplets = Array.from({ length: 8 }, (_, i) =>
      makeTriplet({ opponentId: `o${i}`, dateKey: '2026-05-06', score: i * 0.1 })
    );
    const out = pickTopGlobal(triplets, 5);
    expect(out).toHaveLength(5);
    // Highest scores first → o7, o6, o5, o4, o3
    expect(out.map(s => s.opponentId)).toEqual(['o7', 'o6', 'o5', 'o4', 'o3']);
  });

  it('dedupes by opponent globally (across all days), keeping the highest-scored slot', () => {
    const triplets = [
      makeTriplet({ opponentId: 'o1', facilityId: 'fa', dateKey: '2026-05-06', score: 0.5 }),
      makeTriplet({ opponentId: 'o1', facilityId: 'fb', dateKey: '2026-05-07', score: 0.9 }),
      makeTriplet({ opponentId: 'o1', facilityId: 'fc', dateKey: '2026-05-08', score: 0.7 }),
      makeTriplet({ opponentId: 'o2', facilityId: 'fd', dateKey: '2026-05-06', score: 0.6 }),
    ];
    const out = pickTopGlobal(triplets, 10);
    // o1 should appear once (its 0.9 slot at fb), o2 once.
    expect(out.map(s => s.opponentId)).toEqual(['o1', 'o2']);
    expect(out[0].facility.facilityId).toBe('fb');
    expect(out[0].score).toBeCloseTo(0.9);
  });

  it('returns fewer than maxItems when the input has fewer unique opponents', () => {
    const triplets = [
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-06', score: 0.9 }),
      makeTriplet({ opponentId: 'o2', dateKey: '2026-05-07', score: 0.6 }),
    ];
    const out = pickTopGlobal(triplets, 10);
    expect(out).toHaveLength(2);
  });

  it('does not group by day — same opponent across days collapses to one entry', () => {
    const triplets = [
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-06', score: 0.9 }),
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-07', score: 0.8 }),
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-08', score: 0.7 }),
    ];
    const out = pickTopGlobal(triplets, 10);
    expect(out).toHaveLength(1);
    expect(out[0].opponentId).toBe('o1');
  });
});

// =============================================================================
// hasTimeConflict — overlap detection between proposed and busy slots
// =============================================================================

describe('hasTimeConflict', () => {
  const busy: BusySlot[] = [{ matchDate: '2026-05-10', startTime: '14:00', endTime: '16:00' }];

  it('returns false when proposed slot is on a different date', () => {
    expect(hasTimeConflict('2026-05-11', 14, 15, busy)).toBe(false);
  });

  it('returns true when proposed slot fully overlaps a busy window', () => {
    expect(hasTimeConflict('2026-05-10', 14, 15, busy)).toBe(true);
  });

  it('returns true when proposed slot partially overlaps the start of a busy window', () => {
    expect(hasTimeConflict('2026-05-10', 13, 15, busy)).toBe(true);
  });

  it('returns true when proposed slot partially overlaps the end of a busy window', () => {
    expect(hasTimeConflict('2026-05-10', 15, 17, busy)).toBe(true);
  });

  it('returns false when proposed slot ends exactly when busy window starts', () => {
    // proposedEnd (14:00) > busyStart (14:00) is false → no overlap
    expect(hasTimeConflict('2026-05-10', 13, 14, busy)).toBe(false);
  });

  it('returns false when proposed slot starts exactly when busy window ends', () => {
    // proposedStart (16:00) < busyEnd (16:00) is false → no overlap
    expect(hasTimeConflict('2026-05-10', 16, 17, busy)).toBe(false);
  });

  it('returns false against an empty busy list', () => {
    expect(hasTimeConflict('2026-05-10', 14, 15, [])).toBe(false);
  });
});

// =============================================================================
// generateFixedHourSlots — past-time + busy-conflict filtering
// =============================================================================

describe('generateFixedHourSlots', () => {
  // Helper: build a 7-day window starting from a fixed reference date.
  function buildWindow(startDateStr: string): { date: Date; key: string }[] {
    const out: { date: Date; key: string }[] = [];
    const base = new Date(`${startDateStr}T00:00:00`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: d, key });
    }
    return out;
  }

  it('returns an empty array when there are no overlap cells', () => {
    const window = buildWindow('2026-05-11'); // Monday
    const now = new Date('2026-05-11T07:00:00');
    expect(generateFixedHourSlots([], window, [], [], now)).toEqual([]);
  });

  it('emits both fixed hours per overlap cell (e.g. morning → 8 + 10)', () => {
    // 2026-05-11 is a Monday
    const window = buildWindow('2026-05-11');
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    const now = new Date('2026-05-11T07:00:00');
    const slots = generateFixedHourSlots(overlaps, window, [], [], now);
    const hours = slots.map(s => s.datetime.getHours()).sort((a, b) => a - b);
    expect(hours).toEqual([8, 10]);
  });

  it('drops slots whose start time is at or before "now"', () => {
    const window = buildWindow('2026-05-11'); // Monday
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    // Now = 9:00 AM Monday. The 8:00 AM slot is past; the 10:00 AM slot is future.
    const now = new Date('2026-05-11T09:00:00');
    const slots = generateFixedHourSlots(overlaps, window, [], [], now);
    expect(slots.map(s => s.datetime.getHours())).toEqual([10]);
  });

  it("drops slots that conflict with the caller's busy window", () => {
    const window = buildWindow('2026-05-11'); // Monday
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    const now = new Date('2026-05-11T06:00:00');
    const callerBusy: BusySlot[] = [
      { matchDate: '2026-05-11', startTime: '08:00', endTime: '09:30' },
    ];
    const slots = generateFixedHourSlots(overlaps, window, callerBusy, [], now);
    // 8 AM slot conflicts (08:00–09:00 vs busy 08:00–09:30); 10 AM is free.
    expect(slots.map(s => s.datetime.getHours())).toEqual([10]);
  });

  it("drops slots that conflict with the opponent's busy window", () => {
    const window = buildWindow('2026-05-11'); // Monday
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    const now = new Date('2026-05-11T06:00:00');
    const opponentBusy: BusySlot[] = [
      { matchDate: '2026-05-11', startTime: '09:30', endTime: '11:00' },
    ];
    const slots = generateFixedHourSlots(overlaps, window, [], opponentBusy, now);
    // 10 AM slot conflicts (10:00–11:00 vs busy 09:30–11:00); 8 AM is free.
    expect(slots.map(s => s.datetime.getHours())).toEqual([8]);
  });

  it('keeps slots when busy windows are on a different date', () => {
    const window = buildWindow('2026-05-11'); // Monday
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    const now = new Date('2026-05-11T06:00:00');
    const callerBusy: BusySlot[] = [
      { matchDate: '2026-05-12', startTime: '08:00', endTime: '11:00' },
    ];
    const slots = generateFixedHourSlots(overlaps, window, callerBusy, [], now);
    expect(slots.map(s => s.datetime.getHours())).toEqual([8, 10]);
  });

  it('respects both caller AND opponent conflicts simultaneously', () => {
    const window = buildWindow('2026-05-11'); // Monday
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    const now = new Date('2026-05-11T06:00:00');
    const callerBusy: BusySlot[] = [
      { matchDate: '2026-05-11', startTime: '08:00', endTime: '09:00' },
    ];
    const opponentBusy: BusySlot[] = [
      { matchDate: '2026-05-11', startTime: '10:00', endTime: '11:00' },
    ];
    // Both 8 AM (caller busy) and 10 AM (opp busy) conflict.
    const slots = generateFixedHourSlots(overlaps, window, callerBusy, opponentBusy, now);
    expect(slots).toEqual([]);
  });

  it('skips date+period combinations not in the overlap set', () => {
    const window = buildWindow('2026-05-11'); // Monday
    // Only Tuesday morning is in the overlap.
    const overlaps: OverlapSlot[] = [{ day: 'tuesday', period: 'morning' }];
    const now = new Date('2026-05-11T06:00:00');
    const slots = generateFixedHourSlots(overlaps, window, [], [], now);
    // Monday produces no slots; Tuesday (the next day in window) produces 8 + 10.
    expect(slots).toHaveLength(2);
    expect(slots.every(s => s.datetime.getDay() === 2 /* Tuesday */)).toBe(true);
  });

  it('expands a single overlap across the 7-day window if the day repeats', () => {
    const window = buildWindow('2026-05-11'); // Monday → next Sunday (May 17)
    // Only one Monday in this window; only 8 AM + 10 AM should be emitted.
    const overlaps: OverlapSlot[] = [{ day: 'monday', period: 'morning' }];
    const now = new Date('2026-05-11T06:00:00');
    const slots = generateFixedHourSlots(overlaps, window, [], [], now);
    expect(slots).toHaveLength(2);
  });

  it('emits multiple cells from multiple overlap entries', () => {
    const window = buildWindow('2026-05-11');
    const overlaps: OverlapSlot[] = [
      { day: 'monday', period: 'morning' }, // 8, 10
      { day: 'monday', period: 'evening' }, // 18, 20
    ];
    const now = new Date('2026-05-11T06:00:00');
    const slots = generateFixedHourSlots(overlaps, window, [], [], now);
    const hours = slots.map(s => s.datetime.getHours()).sort((a, b) => a - b);
    expect(hours).toEqual([8, 10, 18, 20]);
  });
});
