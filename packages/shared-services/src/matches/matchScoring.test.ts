import {
  scoreNearbyMatch,
  maxCostInBatch,
  matchUrgencyBoost,
  isMatchStillJoinable,
  type Scorable,
} from './matchScoring';

function makeMatch(overrides: Partial<Scorable> = {}): Scorable {
  return {
    id: 'm1',
    created_by: 'c1',
    match_date: '2026-12-31',
    start_time: '12:00:00',
    end_time: '13:00:00',
    duration: '60',
    format: 'singles',
    visibility: 'public',
    is_court_free: true,
    estimated_cost: 0,
    court_status: null,
    participants: [],
    preferred_opponent_gender: null,
    player_expectation: 'casual',
    distance_meters: 1000,
    player_compatibility: null,
    facility_affinity: null,
    score_history: null,
    ...overrides,
  } as unknown as Scorable;
}

describe('scoreNearbyMatch', () => {
  it('auth path: returns 0..1 using server compat + affinity', () => {
    const match = makeMatch({
      player_compatibility: 0.8,
      facility_affinity: 0.6,
    });
    const score = scoreNearbyMatch(match, {}, 0);
    // base = 0.55*0.8 + 0.20*0.6 + 0.10*spotsLeft(0.7) + 0.05*tier(0.2) + 0.05*gender(0.7) + 0.05*cost(1.0)
    //      = 0.44   + 0.12   + 0.07              + 0.01           + 0.035           + 0.05
    //      = 0.725
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeCloseTo(0.725, 3);
  });

  it('anon path: returns the legacy 9-factor sum scaled to 0..1', () => {
    const match = makeMatch({
      // No server fields → anon path
      player_compatibility: null,
      facility_affinity: null,
    });
    const score = scoreNearbyMatch(match, { maxTravelDistanceKm: 25 }, 0);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('auth-path scores stay below or at 1 even with max signals', () => {
    const match = makeMatch({
      player_compatibility: 1.0,
      facility_affinity: 1.0,
      court_status: 'reserved',
      participants: [
        { status: 'joined', player: { sportCertificationStatus: 'certified' } } as any,
      ],
      format: 'doubles', // capacity 4, only 1 joined → spots=3 → 0.4
      preferred_opponent_gender: 'male',
    });
    const score = scoreNearbyMatch(match, { playerGender: 'male' }, 0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('maxCostInBatch', () => {
  it('returns 0 for an empty batch', () => {
    expect(maxCostInBatch([])).toBe(0);
  });
  it('returns the max cost', () => {
    const batch = [
      makeMatch({ estimated_cost: 10 }),
      makeMatch({ estimated_cost: 25 }),
      makeMatch({ estimated_cost: 5 }),
    ];
    expect(maxCostInBatch(batch)).toBe(25);
  });
});

describe('matchUrgencyBoost', () => {
  it('returns 0.05 for a same-day match', () => {
    const now = new Date('2026-05-16T10:00:00Z');
    const match = makeMatch({ match_date: '2026-05-16', start_time: '18:00:00' });
    expect(matchUrgencyBoost(match, now)).toBe(0.05);
  });

  it('returns 0.03 for tomorrow', () => {
    const now = new Date('2026-05-16T10:00:00Z');
    const match = makeMatch({ match_date: '2026-05-17', start_time: '18:00:00' });
    expect(matchUrgencyBoost(match, now)).toBe(0.03);
  });

  it('returns 0.01 for day+2', () => {
    const now = new Date('2026-05-16T10:00:00Z');
    const match = makeMatch({ match_date: '2026-05-18', start_time: '18:00:00' });
    expect(matchUrgencyBoost(match, now)).toBe(0.01);
  });

  it('returns 0 beyond day+2', () => {
    const now = new Date('2026-05-16T10:00:00Z');
    const match = makeMatch({ match_date: '2026-05-25', start_time: '18:00:00' });
    expect(matchUrgencyBoost(match, now)).toBe(0);
  });

  it('returns 0 when match_date or start_time is missing', () => {
    expect(matchUrgencyBoost(makeMatch({ match_date: null as unknown as string }))).toBe(0);
    expect(matchUrgencyBoost(makeMatch({ start_time: null as unknown as string }))).toBe(0);
  });
});

describe('isMatchStillJoinable', () => {
  it('true when start is more than leadMinutes in the future', () => {
    const now = new Date('2026-05-16T10:00:00Z');
    const match = makeMatch({ match_date: '2026-05-16', start_time: '12:00:00' });
    expect(isMatchStillJoinable(match, now, 30)).toBe(true);
  });

  it('false when start is within leadMinutes', () => {
    const now = new Date('2026-05-16T11:45:00Z');
    const match = makeMatch({ match_date: '2026-05-16', start_time: '12:00:00' });
    expect(isMatchStillJoinable(match, now, 30)).toBe(false);
  });

  it('false when start is already past', () => {
    const now = new Date('2026-05-16T13:00:00Z');
    const match = makeMatch({ match_date: '2026-05-16', start_time: '12:00:00' });
    expect(isMatchStillJoinable(match, now, 30)).toBe(false);
  });

  it('returns true (do-not-drop) when start info is missing — RPC would have filtered', () => {
    expect(isMatchStillJoinable(makeMatch({ match_date: null as unknown as string }))).toBe(true);
  });
});
