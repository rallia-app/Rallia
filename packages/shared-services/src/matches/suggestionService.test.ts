import { bucketByDay } from './suggestionService';

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
    } as Parameters<typeof bucketByDay>[1][number]['row'],
    slot: {
      datetime: date,
      endDatetime: new Date(date.getTime() + 60 * 60 * 1000),
      bookingUrl: null,
    },
    dateKey: opts.dateKey,
    score: opts.score,
  };
}

describe('bucketByDay', () => {
  const days = ['2026-05-06', '2026-05-07', '2026-05-08'];

  it('returns one entry per requested day, even when no triplets fall on that day', () => {
    const out = bucketByDay(days, []);
    expect(out).toHaveLength(3);
    expect(out.map(d => d.date)).toEqual(days);
    expect(out.every(d => d.suggestions.length === 0)).toBe(true);
  });

  it('caps each day at 5 suggestions, sorted by score desc', () => {
    const triplets = Array.from({ length: 8 }, (_, i) =>
      makeTriplet({ opponentId: `o${i}`, dateKey: '2026-05-06', score: i * 0.1 })
    );
    const out = bucketByDay(days, triplets);
    const day0 = out.find(d => d.date === '2026-05-06')!;
    expect(day0.suggestions).toHaveLength(5);
    // Highest scores first → o7, o6, o5, o4, o3
    expect(day0.suggestions.map(s => s.opponentId)).toEqual(['o7', 'o6', 'o5', 'o4', 'o3']);
  });

  it('dedupes by opponent within a day (max 1× per opponent per day)', () => {
    const triplets = [
      makeTriplet({ opponentId: 'o1', facilityId: 'fa', dateKey: '2026-05-06', score: 0.9 }),
      makeTriplet({ opponentId: 'o1', facilityId: 'fb', dateKey: '2026-05-06', score: 0.8 }),
      makeTriplet({ opponentId: 'o1', facilityId: 'fc', dateKey: '2026-05-06', score: 0.7 }),
      makeTriplet({ opponentId: 'o2', dateKey: '2026-05-06', score: 0.6 }),
    ];
    const out = bucketByDay(days, triplets);
    const day0 = out.find(d => d.date === '2026-05-06')!;
    expect(day0.suggestions.map(s => s.opponentId)).toEqual(['o1', 'o2']);
    // Highest-scored facility for the deduped opponent is kept.
    expect(day0.suggestions[0].facility.facilityId).toBe('fa');
  });

  it('allows the same opponent to appear on different days', () => {
    const triplets = [
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-06', score: 0.9 }),
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-07', score: 0.8 }),
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-08', score: 0.7 }),
    ];
    const out = bucketByDay(days, triplets);
    expect(out.map(d => d.suggestions.map(s => s.opponentId))).toEqual([['o1'], ['o1'], ['o1']]);
  });

  it('drops triplets whose dateKey is not in the requested window', () => {
    const triplets = [
      makeTriplet({ opponentId: 'o1', dateKey: '2026-05-06', score: 0.9 }),
      makeTriplet({ opponentId: 'o2', dateKey: '2026-05-99', score: 0.9 }),
    ];
    const out = bucketByDay(days, triplets);
    const total = out.reduce((sum, d) => sum + d.suggestions.length, 0);
    expect(total).toBe(1);
    expect(out[0].suggestions[0].opponentId).toBe('o1');
  });
});
