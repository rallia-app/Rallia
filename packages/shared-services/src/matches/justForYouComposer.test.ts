/**
 * Composer tests: unified ranking, cross-pool opponent dedup, past-cutoff
 * filter, urgency tiebreak, match-limit cap.
 *
 * `getNearbyMatches` and `getTopSuggestions` are mocked at the module
 * boundary so the test stays focused on the composer's merge/rank logic.
 */

jest.mock('./matchService', () => ({
  getNearbyMatches: jest.fn(),
}));

jest.mock('./suggestionService', () => ({
  getTopSuggestions: jest.fn(),
}));

import { composeJustForYou } from './justForYouComposer';
import { getNearbyMatches } from './matchService';
import { getTopSuggestions } from './suggestionService';
import type { Scorable } from './matchScoring';
import type { SlotSuggestion } from './suggestionService';

const mockGetNearby = getNearbyMatches as jest.Mock;
const mockGetTopSugg = getTopSuggestions as jest.Mock;

// Pin Math.random so jitter doesn't make tests flaky. 0.5 → jitter = 0.
const realRandom = Math.random;
beforeEach(() => {
  jest.clearAllMocks();
  Math.random = () => 0.5;
});
afterAll(() => {
  Math.random = realRandom;
});

// =============================================================================
// Fixture builders
// =============================================================================

/** A future match — start_time tomorrow at noon UTC so urgency doesn't kick. */
function farFutureDate(): { date: string; time: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 5);
  return { date: d.toISOString().slice(0, 10), time: '12:00:00' };
}

function todayLocal(): { date: string; time: string } {
  const d = new Date();
  // Pick an hour later today so isMatchStillJoinable keeps it.
  const future = new Date(d.getTime() + 4 * 60 * 60 * 1000);
  return { date: future.toISOString().slice(0, 10), time: future.toISOString().slice(11, 19) };
}

function pastDate(): { date: string; time: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return { date: d.toISOString().slice(0, 10), time: '12:00:00' };
}

interface MatchOverrides {
  id: string;
  creatorId: string;
  player_compatibility: number;
  facility_affinity?: number;
  date?: string;
  time?: string;
}

function makeMatch(o: MatchOverrides): Scorable {
  const { date, time } = o.date && o.time ? { date: o.date, time: o.time } : farFutureDate();
  return {
    id: o.id,
    created_by: o.creatorId,
    match_date: date,
    start_time: time,
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
    player_compatibility: o.player_compatibility,
    facility_affinity: o.facility_affinity ?? 0.5,
    score_history: 0,
    // The rest of MatchWithDetails isn't read by the composer for these tests.
  } as unknown as Scorable;
}

function makeSuggestion(opts: {
  opponentId: string;
  score: number;
  date?: string;
}): SlotSuggestion {
  const dateStr = opts.date ?? farFutureDate().date;
  const dt = new Date(`${dateStr}T18:00:00Z`);
  return {
    opponentId: opts.opponentId,
    opponentFirstName: 'Op',
    opponentLastName: opts.opponentId,
    opponentAvatar: null,
    opponentReputationScore: null,
    opponentReputationTier: 'unknown',
    opponentRatingScoreValue: 4.0,
    opponentRatingLabel: '4.0',
    opponentBadgeStatus: null,
    matchType: 'casual',
    matchDuration: '60',
    facility: {
      facilityId: 'fac',
      facilityName: 'Court',
      facilityAddress: '',
      facilityCity: '',
      facilityAffinity: 0.5,
      hasAvailabilitySource: false,
    },
    slot: {
      datetime: dt,
      endDatetime: new Date(dt.getTime() + 60 * 60 * 1000),
      bookingUrl: null,
    },
    score: opts.score,
    rank: 1,
  } as unknown as SlotSuggestion;
}

function defaultInput(over: Partial<Parameters<typeof composeJustForYou>[0]> = {}) {
  return {
    playerId: 'caller-1',
    sportId: 'sport-1',
    latitude: 45.5,
    longitude: -73.5,
    maxDistanceKm: 25,
    scoringPreferences: {},
    matchLimit: 5,
    ...over,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('composeJustForYou', () => {
  it('returns an empty result when both pools are empty', async () => {
    mockGetNearby.mockResolvedValue({ matches: [], hasMore: false, nextOffset: null });
    mockGetTopSugg.mockResolvedValue([]);

    const result = await composeJustForYou(defaultInput());
    expect(result.items).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it('ranks a strong match above a weak suggestion', async () => {
    // Match: pc=0.9, fa=0.6 → unified base = 0.55*0.9 + 0.20*0.6 + small TS factors ≈ 0.6+
    // Suggestion: 0.3
    mockGetNearby.mockResolvedValue({
      matches: [
        makeMatch({ id: 'm1', creatorId: 'c1', player_compatibility: 0.9, facility_affinity: 0.6 }),
      ],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([makeSuggestion({ opponentId: 'o1', score: 0.3 })]);

    const result = await composeJustForYou(defaultInput());
    expect(result.items.length).toBe(2);
    expect(result.items[0].kind).toBe('match');
    expect(result.items[1].kind).toBe('suggestion');
  });

  it('a strong suggestion outranks a weak match (the key unified-scale win)', async () => {
    // Weak match: pc=0.1, fa=0.1 → unified base ≈ 0.55*0.1 + 0.20*0.1 + small TS = ~0.1
    // Strong suggestion: 0.85
    mockGetNearby.mockResolvedValue({
      matches: [
        makeMatch({ id: 'm1', creatorId: 'c1', player_compatibility: 0.1, facility_affinity: 0.1 }),
      ],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([makeSuggestion({ opponentId: 'o1', score: 0.85 })]);

    const result = await composeJustForYou(defaultInput());
    expect(result.items[0].kind).toBe('suggestion');
    expect(result.items[1].kind).toBe('match');
  });

  it('drops past matches before scoring', async () => {
    const past = pastDate();
    mockGetNearby.mockResolvedValue({
      matches: [
        makeMatch({
          id: 'past-match',
          creatorId: 'c1',
          player_compatibility: 0.9,
          facility_affinity: 0.9,
          date: past.date,
          time: past.time,
        }),
        makeMatch({ id: 'future-match', creatorId: 'c2', player_compatibility: 0.5 }),
      ],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([]);

    const result = await composeJustForYou(defaultInput());
    expect(result.items.length).toBe(1);
    expect((result.items[0].data as Scorable).id).toBe('future-match');
  });

  it('cross-pool dedup: drops suggestions whose opponentId == a candidate match creator', async () => {
    // A match exists by creator "shared-id". A suggestion for the same opp must be dropped.
    mockGetNearby.mockResolvedValue({
      matches: [makeMatch({ id: 'm1', creatorId: 'shared-id', player_compatibility: 0.4 })],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([
      makeSuggestion({ opponentId: 'shared-id', score: 0.9 }), // would otherwise win
      makeSuggestion({ opponentId: 'other', score: 0.5 }),
    ]);

    const result = await composeJustForYou(defaultInput());
    expect(result.items.length).toBe(2);
    const kinds = result.items.map(i => i.kind);
    expect(kinds).toContain('match');
    expect(kinds).toContain('suggestion');
    // The dedup'd suggestion is gone; "other" survives.
    const sug = result.items.find(i => i.kind === 'suggestion');
    expect(sug && (sug.data as SlotSuggestion).opponentId).toBe('other');
  });

  it('today match outranks a far-future match of equal base score (urgency boost)', async () => {
    const today = todayLocal();
    mockGetNearby.mockResolvedValue({
      matches: [
        makeMatch({
          id: 'today',
          creatorId: 'c1',
          player_compatibility: 0.5,
          facility_affinity: 0.5,
          date: today.date,
          time: today.time,
        }),
        makeMatch({
          id: 'future',
          creatorId: 'c2',
          player_compatibility: 0.5,
          facility_affinity: 0.5,
        }),
      ],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([]);

    const result = await composeJustForYou(defaultInput());
    expect((result.items[0].data as Scorable).id).toBe('today');
    expect((result.items[1].data as Scorable).id).toBe('future');
  });

  it('caps output at matchLimit', async () => {
    mockGetNearby.mockResolvedValue({
      matches: Array.from({ length: 8 }, (_, i) =>
        makeMatch({ id: `m${i}`, creatorId: `c${i}`, player_compatibility: 0.5 + i * 0.05 })
      ),
      hasMore: true,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([
      makeSuggestion({ opponentId: 'sx', score: 0.95 }),
      makeSuggestion({ opponentId: 'sy', score: 0.92 }),
    ]);

    const result = await composeJustForYou(defaultInput({ matchLimit: 5 }));
    expect(result.items.length).toBe(5);
    // The two strong suggestions should make it in
    expect(result.items.filter(i => i.kind === 'suggestion').length).toBeGreaterThanOrEqual(2);
  });

  it('derived matches/suggestions arrays mirror items', async () => {
    mockGetNearby.mockResolvedValue({
      matches: [makeMatch({ id: 'm1', creatorId: 'c1', player_compatibility: 0.8 })],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([makeSuggestion({ opponentId: 'o1', score: 0.7 })]);

    const result = await composeJustForYou(defaultInput());
    expect(result.matches.length + result.suggestions.length).toBe(result.items.length);
    expect(result.matches[0].id).toBe('m1');
    expect(result.suggestions[0].opponentId).toBe('o1');
  });

  it('real-action bonus: when match and suggestion have similar bases, the match wins', async () => {
    // Match base ≈ 0.50, suggestion base ≈ 0.52. Without the +0.05 bonus
    // the suggestion would edge ahead; with it, the match wins.
    mockGetNearby.mockResolvedValue({
      matches: [
        makeMatch({
          id: 'close-match',
          creatorId: 'c1',
          player_compatibility: 0.5,
          facility_affinity: 0.5,
        }),
      ],
      hasMore: false,
      nextOffset: null,
    });
    mockGetTopSugg.mockResolvedValue([makeSuggestion({ opponentId: 'o1', score: 0.52 })]);

    const result = await composeJustForYou(defaultInput());
    expect(result.items[0].kind).toBe('match');
  });

  it('aborted signal short-circuits with empty result', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    mockGetNearby.mockResolvedValue({ matches: [], hasMore: false, nextOffset: null });
    mockGetTopSugg.mockResolvedValue([]);

    const result = await composeJustForYou(defaultInput({ signal: ctrl.signal }));
    expect(result.items).toEqual([]);
  });
});
