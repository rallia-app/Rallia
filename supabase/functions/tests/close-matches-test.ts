import { assertEquals } from 'jsr:@std/assert';
import {
  isMutualCancellation,
  getNoShowPlayerIds,
  aggregateFeedback,
  getStarRatingEventType,
  determineReputationEventTypes,
  type MatchParticipant,
  type MatchFeedback,
  type AggregatedFeedback,
} from '../close-matches/closure-logic.ts';

// =============================================================================
// HELPERS
// =============================================================================

function makeParticipant(
  overrides: Partial<MatchParticipant> & { player_id: string }
): MatchParticipant {
  return {
    id: overrides.id ?? `part-${overrides.player_id}`,
    player_id: overrides.player_id,
    match_outcome: overrides.match_outcome ?? null,
    feedback_completed: overrides.feedback_completed ?? false,
  };
}

function makeFeedback(
  overrides: Partial<MatchFeedback> & { reviewer_id: string; opponent_id: string }
): MatchFeedback {
  return {
    id: overrides.id ?? `fb-${overrides.reviewer_id}-${overrides.opponent_id}`,
    reviewer_id: overrides.reviewer_id,
    opponent_id: overrides.opponent_id,
    showed_up: overrides.showed_up ?? true,
    was_late: overrides.was_late ?? null,
    star_rating: overrides.star_rating ?? null,
  };
}

// =============================================================================
// isMutualCancellation
// =============================================================================

Deno.test('isMutualCancellation - 2/2 mutual_cancel → true', () => {
  const participants = [
    makeParticipant({ player_id: 'a', match_outcome: 'mutual_cancel' }),
    makeParticipant({ player_id: 'b', match_outcome: 'mutual_cancel' }),
  ];
  assertEquals(isMutualCancellation(participants), true);
});

Deno.test('isMutualCancellation - 2/3 mutual_cancel → true (majority)', () => {
  const participants = [
    makeParticipant({ player_id: 'a', match_outcome: 'mutual_cancel' }),
    makeParticipant({ player_id: 'b', match_outcome: 'mutual_cancel' }),
    makeParticipant({ player_id: 'c', match_outcome: 'played' }),
  ];
  assertEquals(isMutualCancellation(participants), true);
});

Deno.test('isMutualCancellation - 1/2 → false (tie, not strict majority)', () => {
  const participants = [
    makeParticipant({ player_id: 'a', match_outcome: 'mutual_cancel' }),
    makeParticipant({ player_id: 'b', match_outcome: 'played' }),
  ];
  assertEquals(isMutualCancellation(participants), false);
});

Deno.test('isMutualCancellation - 0/2 → false', () => {
  const participants = [
    makeParticipant({ player_id: 'a', match_outcome: 'played' }),
    makeParticipant({ player_id: 'b', match_outcome: 'played' }),
  ];
  assertEquals(isMutualCancellation(participants), false);
});

Deno.test('isMutualCancellation - empty array → false', () => {
  assertEquals(isMutualCancellation([]), false);
});

Deno.test('isMutualCancellation - single participant with mutual_cancel → true', () => {
  const participants = [makeParticipant({ player_id: 'a', match_outcome: 'mutual_cancel' })];
  assertEquals(isMutualCancellation(participants), true);
});

Deno.test('isMutualCancellation - single participant without mutual_cancel → false', () => {
  const participants = [makeParticipant({ player_id: 'a', match_outcome: 'played' })];
  assertEquals(isMutualCancellation(participants), false);
});

Deno.test('isMutualCancellation - mixed outcomes (played, opponent_no_show, null)', () => {
  const participants = [
    makeParticipant({ player_id: 'a', match_outcome: 'played' }),
    makeParticipant({ player_id: 'b', match_outcome: 'opponent_no_show' }),
    makeParticipant({ player_id: 'c', match_outcome: null }),
  ];
  assertEquals(isMutualCancellation(participants), false);
});

Deno.test('isMutualCancellation - exact 50% split (2/4) → false', () => {
  const participants = [
    makeParticipant({ player_id: 'a', match_outcome: 'mutual_cancel' }),
    makeParticipant({ player_id: 'b', match_outcome: 'mutual_cancel' }),
    makeParticipant({ player_id: 'c', match_outcome: 'played' }),
    makeParticipant({ player_id: 'd', match_outcome: 'played' }),
  ];
  assertEquals(isMutualCancellation(participants), false);
});

// =============================================================================
// getNoShowPlayerIds
// =============================================================================

Deno.test('getNoShowPlayerIds - clear majority no-show → in set', () => {
  const participants = [
    makeParticipant({ player_id: 'a' }),
    makeParticipant({ player_id: 'b' }),
    makeParticipant({ player_id: 'c' }),
  ];
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: false }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
  ];
  const result = getNoShowPlayerIds(feedback, participants);
  assertEquals(result.has('a'), true);
  assertEquals(result.size, 1);
});

Deno.test('getNoShowPlayerIds - clear majority showed → not in set', () => {
  const participants = [
    makeParticipant({ player_id: 'a' }),
    makeParticipant({ player_id: 'b' }),
    makeParticipant({ player_id: 'c' }),
  ];
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true }),
  ];
  const result = getNoShowPlayerIds(feedback, participants);
  assertEquals(result.has('a'), false);
});

Deno.test('getNoShowPlayerIds - tie (1 vs 1) → not in set (benefit of doubt)', () => {
  const participants = [
    makeParticipant({ player_id: 'a' }),
    makeParticipant({ player_id: 'b' }),
    makeParticipant({ player_id: 'c' }),
  ];
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
  ];
  const result = getNoShowPlayerIds(feedback, participants);
  assertEquals(result.has('a'), false);
});

Deno.test('getNoShowPlayerIds - no feedback about player → not in set', () => {
  const participants = [makeParticipant({ player_id: 'a' }), makeParticipant({ player_id: 'b' })];
  const feedback: MatchFeedback[] = [];
  const result = getNoShowPlayerIds(feedback, participants);
  assertEquals(result.size, 0);
});

Deno.test('getNoShowPlayerIds - empty inputs → empty set', () => {
  assertEquals(getNoShowPlayerIds([], []).size, 0);
});

Deno.test('getNoShowPlayerIds - multiple players, mixed results', () => {
  const participants = [
    makeParticipant({ player_id: 'a' }),
    makeParticipant({ player_id: 'b' }),
    makeParticipant({ player_id: 'c' }),
  ];
  const feedback = [
    // a is no-show (2 say no)
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: false }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
    // b showed up
    makeFeedback({ reviewer_id: 'a', opponent_id: 'b', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'b', showed_up: true }),
    // c showed up
    makeFeedback({ reviewer_id: 'a', opponent_id: 'c', showed_up: true }),
    makeFeedback({ reviewer_id: 'b', opponent_id: 'c', showed_up: true }),
  ];
  const result = getNoShowPlayerIds(feedback, participants);
  assertEquals(result.has('a'), true);
  assertEquals(result.has('b'), false);
  assertEquals(result.has('c'), false);
  assertEquals(result.size, 1);
});

Deno.test('getNoShowPlayerIds - singles match (1 reviewer)', () => {
  const participants = [makeParticipant({ player_id: 'a' }), makeParticipant({ player_id: 'b' })];
  const feedback = [makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: false })];
  const result = getNoShowPlayerIds(feedback, participants);
  assertEquals(result.has('a'), true);
});

Deno.test('getNoShowPlayerIds - feedback about unknown opponent_id is ignored', () => {
  // Feedback references opponent 'x' who is not in participants list
  const participants = [makeParticipant({ player_id: 'a' }), makeParticipant({ player_id: 'b' })];
  const feedback = [
    makeFeedback({ reviewer_id: 'a', opponent_id: 'x', showed_up: false }),
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
  ];
  const result = getNoShowPlayerIds(feedback, participants);
  // 'x' not in participants, so not evaluated; 'a' showed up
  assertEquals(result.size, 0);
});

// =============================================================================
// aggregateFeedback
// =============================================================================

Deno.test('aggregateFeedback - no feedback at all → null/0', () => {
  const result = aggregateFeedback('a', [], new Set());
  assertEquals(result, { showedUp: null, wasLate: null, starRating: null, feedbackCount: 0 });
});

Deno.test('aggregateFeedback - all reviewers are no-shows → null/0', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 5 }),
  ];
  const noShowIds = new Set(['b']);
  const result = aggregateFeedback('a', feedback, noShowIds);
  assertEquals(result, { showedUp: null, wasLate: null, starRating: null, feedbackCount: 0 });
});

Deno.test('aggregateFeedback - showedUp majority 2/3 true', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: false }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.showedUp, true);
});

Deno.test('aggregateFeedback - showedUp 3/3 true', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.showedUp, true);
});

Deno.test('aggregateFeedback - showedUp 2/3 false → no-show', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: false }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.showedUp, false);
});

Deno.test('aggregateFeedback - showedUp 1/1 true', () => {
  const feedback = [makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true })];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.showedUp, true);
});

Deno.test('aggregateFeedback - showedUp 1/1 false', () => {
  const feedback = [makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: false })];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.showedUp, false);
});

Deno.test('aggregateFeedback - showedUp tie (1/2 split) → true (benefit of doubt)', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.showedUp, true);
});

Deno.test('aggregateFeedback - no-show exclusion changes outcome', () => {
  // Without exclusion: 1 showed_up=true, 2 showed_up=false → no-show
  // With exclusion of one false reviewer: 1 true, 1 false → tie → benefit of doubt → true
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: false }),
  ];
  // Without exclusion
  const resultWithout = aggregateFeedback('a', feedback, new Set());
  assertEquals(resultWithout.showedUp, false);

  // With d excluded as no-show reviewer
  const resultWith = aggregateFeedback('a', feedback, new Set(['d']));
  assertEquals(resultWith.showedUp, true);
});

Deno.test(
  'aggregateFeedback - early return on no-show: wasLate and starRating must be null',
  () => {
    const feedback = [
      makeFeedback({
        reviewer_id: 'b',
        opponent_id: 'a',
        showed_up: false,
        was_late: true,
        star_rating: 1,
      }),
    ];
    const result = aggregateFeedback('a', feedback, new Set());
    assertEquals(result.showedUp, false);
    assertEquals(result.wasLate, null);
    assertEquals(result.starRating, null);
    assertEquals(result.feedbackCount, 1);
  }
);

Deno.test('aggregateFeedback - wasLate majority: true wins', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, was_late: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, was_late: true }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true, was_late: false }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.wasLate, true);
});

Deno.test('aggregateFeedback - wasLate majority: false wins', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, was_late: false }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, was_late: false }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true, was_late: true }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.wasLate, false);
});

Deno.test('aggregateFeedback - wasLate tie → false (benefit of doubt)', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, was_late: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, was_late: false }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.wasLate, false);
});

Deno.test('aggregateFeedback - wasLate with nulls: null values filtered before counting', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, was_late: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, was_late: null }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true, was_late: null }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  // Only one non-null was_late=true → lateCount=1 > onTimeCount=0
  assertEquals(result.wasLate, true);
});

Deno.test('aggregateFeedback - wasLate all nulls → false (0-vs-0 tie-breaker)', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, was_late: null }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, was_late: null }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  // lateFeedback is empty (both null), lateCount=0, onTimeCount=0
  // The 0-vs-0 tie-breaker fires: wasLate = false (benefit of doubt)
  assertEquals(result.wasLate, false);
});

Deno.test('aggregateFeedback - starRating averaging: [4,5] → 5', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 4 }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, star_rating: 5 }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  // avg = 4.5, rounded = 5
  assertEquals(result.starRating, 5);
});

Deno.test('aggregateFeedback - starRating averaging: [3,4] → 4', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 3 }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, star_rating: 4 }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  // avg = 3.5, rounded = 4
  assertEquals(result.starRating, 4);
});

Deno.test('aggregateFeedback - starRating averaging: [1,2,3] → 2', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 1 }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, star_rating: 2 }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true, star_rating: 3 }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  // avg = 2.0, rounded = 2
  assertEquals(result.starRating, 2);
});

Deno.test('aggregateFeedback - starRating averaging: [1,5] → 3', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 1 }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, star_rating: 5 }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  // avg = 3.0, rounded = 3
  assertEquals(result.starRating, 3);
});

Deno.test('aggregateFeedback - starRating nulls: only non-null averaged', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 4 }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, star_rating: null }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.starRating, 4);
});

Deno.test('aggregateFeedback - starRating all null → null', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: null }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true, star_rating: null }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.starRating, null);
});

Deno.test('aggregateFeedback - starRating clamping: result always 1-5', () => {
  // Single rating of 5 → 5 (already in range)
  const feedback5 = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 5 }),
  ];
  assertEquals(aggregateFeedback('a', feedback5, new Set()).starRating, 5);

  // Single rating of 1 → 1 (already in range)
  const feedback1 = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 1 }),
  ];
  assertEquals(aggregateFeedback('a', feedback1, new Set()).starRating, 1);
});

Deno.test('aggregateFeedback - feedbackCount equals valid (non-no-show) feedback entries', () => {
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: true }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: true }),
  ];
  // d is a no-show reviewer
  const result = aggregateFeedback('a', feedback, new Set(['d']));
  assertEquals(result.feedbackCount, 2);
});

Deno.test('aggregateFeedback - complex doubles: 4-player scenario with no-show exclusion', () => {
  // Doubles: players a, b, c, d
  // Player d is a no-show (their reviews should be excluded)
  // Feedback about player a from b, c, d
  const feedback = [
    makeFeedback({
      reviewer_id: 'b',
      opponent_id: 'a',
      showed_up: true,
      was_late: false,
      star_rating: 5,
    }),
    makeFeedback({
      reviewer_id: 'c',
      opponent_id: 'a',
      showed_up: true,
      was_late: true,
      star_rating: 4,
    }),
    makeFeedback({
      reviewer_id: 'd',
      opponent_id: 'a',
      showed_up: false,
      was_late: null,
      star_rating: 1,
    }),
  ];
  const noShowIds = new Set(['d']);
  const result = aggregateFeedback('a', feedback, noShowIds);

  // d's feedback excluded, so only b and c count
  assertEquals(result.feedbackCount, 2);
  assertEquals(result.showedUp, true); // 2/2 say showed
  assertEquals(result.wasLate, false); // tie (1 late, 1 on-time) → benefit of doubt → false
  assertEquals(result.starRating, 5); // avg(5,4) = 4.5, rounded = 5
});

Deno.test('aggregateFeedback - feedback about other opponents is ignored', () => {
  // Mix of feedback about player 'a' and player 'x' — only 'a' should be aggregated
  const feedback = [
    makeFeedback({ reviewer_id: 'b', opponent_id: 'a', showed_up: true, star_rating: 5 }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'x', showed_up: false, star_rating: 1 }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'x', showed_up: false, star_rating: 1 }),
  ];
  const result = aggregateFeedback('a', feedback, new Set());
  assertEquals(result.feedbackCount, 1); // only b's feedback about 'a'
  assertEquals(result.showedUp, true);
  assertEquals(result.starRating, 5);
});

Deno.test('aggregateFeedback - outcome-changing exclusion: no-show removal flips majority', () => {
  // 3 reviewers: b says showed, c says no-show, d says no-show
  // Without exclusion: 1 vs 2 → no-show
  // Exclude d (no-show reviewer): 1 vs 1 → tie → benefit of doubt → showed
  const feedback = [
    makeFeedback({
      reviewer_id: 'b',
      opponent_id: 'a',
      showed_up: true,
      was_late: false,
      star_rating: 4,
    }),
    makeFeedback({ reviewer_id: 'c', opponent_id: 'a', showed_up: false }),
    makeFeedback({ reviewer_id: 'd', opponent_id: 'a', showed_up: false }),
  ];

  const withoutExclusion = aggregateFeedback('a', feedback, new Set());
  assertEquals(withoutExclusion.showedUp, false);
  assertEquals(withoutExclusion.wasLate, null); // early return on no-show
  assertEquals(withoutExclusion.starRating, null);

  const withExclusion = aggregateFeedback('a', feedback, new Set(['d']));
  assertEquals(withExclusion.showedUp, true); // tie → benefit of doubt
  assertEquals(withExclusion.wasLate, false); // only b's was_late=false counts (c has no was_late since showed_up=false)
  assertEquals(withExclusion.starRating, 4); // only b's rating counts
});

// =============================================================================
// getStarRatingEventType
// =============================================================================

Deno.test('getStarRatingEventType - 1 → 1star', () => {
  assertEquals(getStarRatingEventType(1), 'review_received_1star');
});

Deno.test('getStarRatingEventType - 2 → 2star', () => {
  assertEquals(getStarRatingEventType(2), 'review_received_2star');
});

Deno.test('getStarRatingEventType - 3 → 3star', () => {
  assertEquals(getStarRatingEventType(3), 'review_received_3star');
});

Deno.test('getStarRatingEventType - 4 → 4star', () => {
  assertEquals(getStarRatingEventType(4), 'review_received_4star');
});

Deno.test('getStarRatingEventType - 5 → 5star', () => {
  assertEquals(getStarRatingEventType(5), 'review_received_5star');
});

Deno.test('getStarRatingEventType - 0 (default) → 1star', () => {
  assertEquals(getStarRatingEventType(0), 'review_received_1star');
});

Deno.test('getStarRatingEventType - -1 (default) → 1star', () => {
  assertEquals(getStarRatingEventType(-1), 'review_received_1star');
});

Deno.test('getStarRatingEventType - 6 (default) → 1star', () => {
  assertEquals(getStarRatingEventType(6), 'review_received_1star');
});

// =============================================================================
// determineReputationEventTypes
// =============================================================================

Deno.test('determineReputationEventTypes - feedbackCount=0 → []', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: null,
    wasLate: null,
    starRating: null,
    feedbackCount: 0,
  };
  assertEquals(determineReputationEventTypes(aggregated), []);
});

Deno.test('determineReputationEventTypes - showedUp + on_time + 5star', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: true,
    wasLate: false,
    starRating: 5,
    feedbackCount: 2,
  };
  const result = determineReputationEventTypes(aggregated);
  assertEquals(result.length, 3);
  assertEquals(result[0], 'match_completed');
  assertEquals(result[1], 'match_on_time');
  assertEquals(result[2], 'review_received_5star');
});

Deno.test('determineReputationEventTypes - showedUp + late + 3star', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: true,
    wasLate: true,
    starRating: 3,
    feedbackCount: 2,
  };
  const result = determineReputationEventTypes(aggregated);
  assertEquals(result.length, 3);
  assertEquals(result[0], 'match_completed');
  assertEquals(result[1], 'match_late');
  assertEquals(result[2], 'review_received_3star');
});

Deno.test('determineReputationEventTypes - showedUp + null punctuality + rating', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: true,
    wasLate: null,
    starRating: 4,
    feedbackCount: 1,
  };
  const result = determineReputationEventTypes(aggregated);
  assertEquals(result.length, 2);
  assertEquals(result[0], 'match_completed');
  assertEquals(result[1], 'review_received_4star');
});

Deno.test('determineReputationEventTypes - showedUp + on_time + null rating', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: true,
    wasLate: false,
    starRating: null,
    feedbackCount: 1,
  };
  const result = determineReputationEventTypes(aggregated);
  assertEquals(result.length, 2);
  assertEquals(result[0], 'match_completed');
  assertEquals(result[1], 'match_on_time');
});

Deno.test('determineReputationEventTypes - showedUp only (null punctuality and rating)', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: true,
    wasLate: null,
    starRating: null,
    feedbackCount: 1,
  };
  const result = determineReputationEventTypes(aggregated);
  assertEquals(result.length, 1);
  assertEquals(result[0], 'match_completed');
});

Deno.test('determineReputationEventTypes - no-show → [match_no_show]', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: false,
    wasLate: null,
    starRating: null,
    feedbackCount: 2,
  };
  const result = determineReputationEventTypes(aggregated);
  assertEquals(result.length, 1);
  assertEquals(result[0], 'match_no_show');
});

Deno.test(
  'determineReputationEventTypes - showedUp + late + null rating → [completed, late]',
  () => {
    const aggregated: AggregatedFeedback = {
      showedUp: true,
      wasLate: true,
      starRating: null,
      feedbackCount: 1,
    };
    const result = determineReputationEventTypes(aggregated);
    assertEquals(result.length, 2);
    assertEquals(result[0], 'match_completed');
    assertEquals(result[1], 'match_late');
  }
);

Deno.test('determineReputationEventTypes - showedUp=null with feedbackCount>0 → []', () => {
  const aggregated: AggregatedFeedback = {
    showedUp: null,
    wasLate: null,
    starRating: null,
    feedbackCount: 1,
  };
  assertEquals(determineReputationEventTypes(aggregated), []);
});

Deno.test('determineReputationEventTypes - all 5 star ratings produce correct event types', () => {
  for (let star = 1; star <= 5; star++) {
    const aggregated: AggregatedFeedback = {
      showedUp: true,
      wasLate: false,
      starRating: star,
      feedbackCount: 1,
    };
    const result = determineReputationEventTypes(aggregated);
    assertEquals(result[2], `review_received_${star}star`);
  }
});
