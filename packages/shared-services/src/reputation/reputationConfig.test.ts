import {
  getTierForScore,
  getTierConfig,
  getDefaultImpact,
  formatScore,
  isGoodReputation,
  MIN_EVENTS_FOR_PUBLIC,
  BASE_REPUTATION_SCORE,
  MAX_REPUTATION_SCORE,
  MIN_REPUTATION_SCORE,
  DEFAULT_DECAY_HALF_LIFE_DAYS,
  TIER_CONFIGS,
  TIER_COLORS,
  DEFAULT_EVENT_IMPACTS,
} from './reputationConfig';
import type { ReputationEventType, ReputationTier } from './reputationTypes';

// =============================================================================
// getTierForScore
// =============================================================================

describe('getTierForScore', () => {
  describe('returns "unknown" when below minimum events', () => {
    it.each([0, 1, 5, 9])('totalEvents=%i → unknown', events => {
      expect(getTierForScore(100, events)).toBe('unknown');
      expect(getTierForScore(50, events)).toBe('unknown');
      expect(getTierForScore(0, events)).toBe('unknown');
    });
  });

  describe('returns correct tier at threshold (totalEvents >= 10)', () => {
    const sufficient = MIN_EVENTS_FOR_PUBLIC;

    it.each([
      { score: 100, expected: 'platinum' },
      { score: 95, expected: 'platinum' },
      { score: 90, expected: 'platinum' },
      { score: 89, expected: 'gold' },
      { score: 80, expected: 'gold' },
      { score: 75, expected: 'gold' },
      { score: 74, expected: 'silver' },
      { score: 65, expected: 'silver' },
      { score: 60, expected: 'silver' },
      { score: 59, expected: 'bronze' },
      { score: 30, expected: 'bronze' },
      { score: 0, expected: 'bronze' },
    ])('score=$score → $expected', ({ score, expected }) => {
      expect(getTierForScore(score, sufficient)).toBe(expected);
    });
  });

  it('transitions from unknown to correct tier at exactly MIN_EVENTS_FOR_PUBLIC', () => {
    expect(getTierForScore(85, MIN_EVENTS_FOR_PUBLIC - 1)).toBe('unknown');
    expect(getTierForScore(85, MIN_EVENTS_FOR_PUBLIC)).toBe('gold');
  });
});

// =============================================================================
// getTierConfig
// =============================================================================

describe('getTierConfig', () => {
  const tiers: ReputationTier[] = ['unknown', 'bronze', 'silver', 'gold', 'platinum'];

  it.each(tiers)('returns config for tier "%s"', tier => {
    const config = getTierConfig(tier);
    expect(config).toBe(TIER_CONFIGS[tier]);
    expect(config).toHaveProperty('label');
    expect(config).toHaveProperty('color');
    expect(config).toHaveProperty('backgroundColor');
    expect(config).toHaveProperty('icon');
    expect(config).toHaveProperty('minScore');
    expect(config).toHaveProperty('maxScore');
  });

  it('returns distinct labels for each tier', () => {
    const labels = tiers.map(t => getTierConfig(t).label);
    expect(new Set(labels).size).toBe(tiers.length);
  });
});

// =============================================================================
// getDefaultImpact
// =============================================================================

describe('getDefaultImpact', () => {
  it('returns correct impact for known event types', () => {
    expect(getDefaultImpact('match_completed')).toBe(DEFAULT_EVENT_IMPACTS.match_completed);
    expect(getDefaultImpact('match_no_show')).toBe(-50);
    expect(getDefaultImpact('match_cancelled_early')).toBe(0);
    expect(getDefaultImpact('match_cancelled_late')).toBe(-35);
    expect(getDefaultImpact('match_left_late')).toBe(-22);
    expect(getDefaultImpact('review_received_5star')).toBe(
      DEFAULT_EVENT_IMPACTS.review_received_5star
    );
    expect(getDefaultImpact('review_received_1star')).toBe(-10);
  });

  it('returns matching value from DEFAULT_EVENT_IMPACTS for every event type', () => {
    for (const [eventType, impact] of Object.entries(DEFAULT_EVENT_IMPACTS)) {
      expect(getDefaultImpact(eventType as ReputationEventType)).toBe(impact);
    }
  });
});

// =============================================================================
// formatScore
// =============================================================================

describe('formatScore', () => {
  it.each([
    { input: 100, expected: '100%' },
    { input: 0, expected: '0%' },
    { input: 75.4, expected: '75%' },
    { input: 75.5, expected: '76%' },
    { input: 89.9, expected: '90%' },
    { input: 50.1, expected: '50%' },
  ])('formatScore($input) → "$expected"', ({ input, expected }) => {
    expect(formatScore(input)).toBe(expected);
  });
});

// =============================================================================
// isGoodReputation
// =============================================================================

describe('isGoodReputation', () => {
  describe('gives benefit of the doubt to new players (< MIN_EVENTS_FOR_PUBLIC)', () => {
    it.each([0, 1, 5, 9])('returns true for totalEvents=%i regardless of score', events => {
      expect(isGoodReputation(100, events)).toBe(true);
      expect(isGoodReputation(50, events)).toBe(true);
      expect(isGoodReputation(0, events)).toBe(true);
    });
  });

  describe('checks score threshold once enough events', () => {
    const sufficient = MIN_EVENTS_FOR_PUBLIC;

    it('returns true when score >= 60', () => {
      expect(isGoodReputation(60, sufficient)).toBe(true);
      expect(isGoodReputation(75, sufficient)).toBe(true);
      expect(isGoodReputation(100, sufficient)).toBe(true);
    });

    it('returns false when score < 60', () => {
      expect(isGoodReputation(59, sufficient)).toBe(false);
      expect(isGoodReputation(30, sufficient)).toBe(false);
      expect(isGoodReputation(0, sufficient)).toBe(false);
    });

    it('boundary: exactly 60 is good', () => {
      expect(isGoodReputation(60, sufficient)).toBe(true);
      expect(isGoodReputation(59.99, sufficient)).toBe(false);
    });
  });

  it('transitions at exactly MIN_EVENTS_FOR_PUBLIC', () => {
    expect(isGoodReputation(50, MIN_EVENTS_FOR_PUBLIC - 1)).toBe(true); // benefit of doubt
    expect(isGoodReputation(50, MIN_EVENTS_FOR_PUBLIC)).toBe(false); // now checked
  });
});

// =============================================================================
// System Constants
// =============================================================================

describe('system constants', () => {
  it('BASE_REPUTATION_SCORE is within valid range', () => {
    expect(BASE_REPUTATION_SCORE).toBeGreaterThanOrEqual(MIN_REPUTATION_SCORE);
    expect(BASE_REPUTATION_SCORE).toBeLessThanOrEqual(MAX_REPUTATION_SCORE);
  });

  it('MIN_REPUTATION_SCORE < MAX_REPUTATION_SCORE', () => {
    expect(MIN_REPUTATION_SCORE).toBeLessThan(MAX_REPUTATION_SCORE);
  });

  it('MIN_EVENTS_FOR_PUBLIC is a positive integer', () => {
    expect(MIN_EVENTS_FOR_PUBLIC).toBeGreaterThan(0);
    expect(Number.isInteger(MIN_EVENTS_FOR_PUBLIC)).toBe(true);
  });

  it('DEFAULT_DECAY_HALF_LIFE_DAYS is a positive number', () => {
    expect(DEFAULT_DECAY_HALF_LIFE_DAYS).toBeGreaterThan(0);
  });
});

// =============================================================================
// TIER_CONFIGS consistency
// =============================================================================

describe('TIER_CONFIGS', () => {
  const scoredTiers: ReputationTier[] = ['bronze', 'silver', 'gold', 'platinum'];

  it('scored tiers cover the full 0–100 range without gaps', () => {
    // Bronze starts at 0, platinum ends at 100
    expect(TIER_CONFIGS.bronze.minScore).toBe(0);
    expect(TIER_CONFIGS.platinum.maxScore).toBe(100);

    // Each tier's maxScore + 1 = next tier's minScore
    for (let i = 0; i < scoredTiers.length - 1; i++) {
      const current = TIER_CONFIGS[scoredTiers[i]];
      const next = TIER_CONFIGS[scoredTiers[i + 1]];
      expect(current.maxScore + 1).toBe(next.minScore);
    }
  });

  it('each tier minScore <= maxScore', () => {
    for (const tier of scoredTiers) {
      expect(TIER_CONFIGS[tier].minScore).toBeLessThanOrEqual(TIER_CONFIGS[tier].maxScore);
    }
  });

  it('unknown tier spans full range (any score possible for new players)', () => {
    expect(TIER_CONFIGS.unknown.minScore).toBe(0);
    expect(TIER_CONFIGS.unknown.maxScore).toBe(100);
  });

  it('tier thresholds align with getTierForScore logic', () => {
    const sufficient = MIN_EVENTS_FOR_PUBLIC;
    // bronze: 0–59
    expect(getTierForScore(TIER_CONFIGS.bronze.minScore, sufficient)).toBe('bronze');
    expect(getTierForScore(TIER_CONFIGS.bronze.maxScore, sufficient)).toBe('bronze');
    // silver: 60–74
    expect(getTierForScore(TIER_CONFIGS.silver.minScore, sufficient)).toBe('silver');
    expect(getTierForScore(TIER_CONFIGS.silver.maxScore, sufficient)).toBe('silver');
    // gold: 75–89
    expect(getTierForScore(TIER_CONFIGS.gold.minScore, sufficient)).toBe('gold');
    expect(getTierForScore(TIER_CONFIGS.gold.maxScore, sufficient)).toBe('gold');
    // platinum: 90–100
    expect(getTierForScore(TIER_CONFIGS.platinum.minScore, sufficient)).toBe('platinum');
    expect(getTierForScore(TIER_CONFIGS.platinum.maxScore, sufficient)).toBe('platinum');
  });
});

// =============================================================================
// TIER_COLORS
// =============================================================================

describe('TIER_COLORS', () => {
  const allTiers: ReputationTier[] = ['unknown', 'bronze', 'silver', 'gold', 'platinum'];

  it('every tier has primary, background, and text colors', () => {
    for (const tier of allTiers) {
      expect(TIER_COLORS[tier]).toHaveProperty('primary');
      expect(TIER_COLORS[tier]).toHaveProperty('background');
      expect(TIER_COLORS[tier]).toHaveProperty('text');
    }
  });

  it('all color values are valid hex strings', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const tier of allTiers) {
      expect(TIER_COLORS[tier].primary).toMatch(hexPattern);
      expect(TIER_COLORS[tier].background).toMatch(hexPattern);
      expect(TIER_COLORS[tier].text).toMatch(hexPattern);
    }
  });

  it('TIER_CONFIGS color matches TIER_COLORS primary', () => {
    for (const tier of allTiers) {
      expect(TIER_CONFIGS[tier].color).toBe(TIER_COLORS[tier].primary);
    }
  });

  it('TIER_CONFIGS backgroundColor matches TIER_COLORS background', () => {
    for (const tier of allTiers) {
      expect(TIER_CONFIGS[tier].backgroundColor).toBe(TIER_COLORS[tier].background);
    }
  });
});

// =============================================================================
// DEFAULT_EVENT_IMPACTS consistency
// =============================================================================

describe('DEFAULT_EVENT_IMPACTS', () => {
  it('match_no_show is the harshest penalty', () => {
    for (const [, impact] of Object.entries(DEFAULT_EVENT_IMPACTS)) {
      expect(impact).toBeGreaterThanOrEqual(DEFAULT_EVENT_IMPACTS.match_no_show);
    }
  });

  it('match_completed is the largest positive match event', () => {
    expect(DEFAULT_EVENT_IMPACTS.match_completed).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_IMPACTS.match_completed).toBeGreaterThan(
      DEFAULT_EVENT_IMPACTS.match_on_time
    );
  });

  it('cancelled_early has no penalty', () => {
    expect(DEFAULT_EVENT_IMPACTS.match_cancelled_early).toBe(0);
  });

  it('negative events have negative impacts', () => {
    expect(DEFAULT_EVENT_IMPACTS.match_no_show).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.match_late).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.match_cancelled_late).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.match_left_late).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.report_upheld).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.warning_issued).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.review_received_1star).toBeLessThan(0);
    expect(DEFAULT_EVENT_IMPACTS.review_received_2star).toBeLessThan(0);
  });

  it('positive events have non-negative impacts', () => {
    expect(DEFAULT_EVENT_IMPACTS.match_completed).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_IMPACTS.match_on_time).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_IMPACTS.review_received_5star).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_IMPACTS.review_received_4star).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_IMPACTS.feedback_submitted).toBeGreaterThan(0);
    expect(DEFAULT_EVENT_IMPACTS.report_dismissed).toBeGreaterThan(0);
  });

  it('review impacts decrease monotonically from 5 to 1 star', () => {
    expect(DEFAULT_EVENT_IMPACTS.review_received_5star).toBeGreaterThan(
      DEFAULT_EVENT_IMPACTS.review_received_4star
    );
    expect(DEFAULT_EVENT_IMPACTS.review_received_4star).toBeGreaterThan(
      DEFAULT_EVENT_IMPACTS.review_received_3star
    );
    expect(DEFAULT_EVENT_IMPACTS.review_received_3star).toBeGreaterThan(
      DEFAULT_EVENT_IMPACTS.review_received_2star
    );
    expect(DEFAULT_EVENT_IMPACTS.review_received_2star).toBeGreaterThan(
      DEFAULT_EVENT_IMPACTS.review_received_1star
    );
  });

  it('3-star review is neutral', () => {
    expect(DEFAULT_EVENT_IMPACTS.review_received_3star).toBe(0);
  });
});
