jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import {
  createReputationEvent,
  createReputationEvents,
  getPlayerReputation,
  getReputationSummary,
  getReputationDisplay,
  getMultiplePlayerReputations,
  recalculateReputation,
  batchRecalculateWithDecay,
  initializePlayerReputation,
  countRecentCancellationEvents,
  getReviewEventType,
  calculateTierLocally,
} from './reputationService';
import {
  MIN_EVENTS_FOR_PUBLIC,
  TIER_CONFIGS,
  BASE_REPUTATION_SCORE,
  DEFAULT_EVENT_IMPACTS,
} from './reputationConfig';
import { supabase } from '../supabase';

const mockFrom = supabase.from as jest.Mock;
const mockRpc = (supabase as unknown as { rpc: jest.Mock }).rpc;

// ---------------------------------------------------------------------------
// Invalidate the module-level config cache between tests by advancing Date.now
// past the 5-minute TTL on every call.
// ---------------------------------------------------------------------------
let fakeNow = 1_000_000_000_000;
const CONFIG_CACHE_TTL = 5 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  // Advance time so the config cache is always expired
  fakeNow += CONFIG_CACHE_TTL + 1;
  jest.spyOn(Date, 'now').mockReturnValue(fakeNow);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Mock helpers - use mockImplementation by table name for clean routing
// ---------------------------------------------------------------------------

/**
 * Route from() calls by table name. Each entry creates a fluent mock chain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockTables(tables: Record<string, any>) {
  mockFrom.mockImplementation((tableName: string) => {
    return tables[tableName] ?? {};
  });
}

/** Config chain that returns empty config (uses defaults) */
function emptyConfigChain() {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: [], error: null }),
  };
}

/** Config chain that returns specified config data */
function configChainWith(data: object[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data, error: null }),
  };
}

/** Insert chain for single-row insert().select().single() */
function insertSingleChain(result: { data?: unknown; error?: unknown }) {
  const chain = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
  return chain;
}

/** Insert chain for batch insert().select() */
function insertBatchChain(result: { data?: unknown; error?: unknown }) {
  const chain = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
  return chain;
}

/** Select chain for .select().eq().single() */
function selectSingleChain(result: { data?: unknown; error?: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
}

/** Select chain for .select().in() */
function selectMultiChain(result: { data?: unknown; error?: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue({ data: result.data ?? [], error: result.error ?? null }),
  };
}

/** Count chain for .select({count}).eq().in().gte() */
function countChain(result: { count?: number | null; error?: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gte: jest.fn().mockResolvedValue({ count: result.count ?? 0, error: result.error ?? null }),
  };
}

/** Upsert chain for .upsert().select().single() */
function upsertChain(result: { data?: unknown; error?: unknown }) {
  return {
    upsert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
}

/** Batch recalc fetch chain for .select().or().limit() */
function batchFetchChain(result: { data?: unknown; error?: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FAKE_EVENT = {
  id: 'evt-1',
  player_id: 'player-1',
  event_type: 'match_completed',
  base_impact: 25,
  match_id: null,
  caused_by_player_id: null,
  metadata: {},
  event_occurred_at: '2026-02-26T00:00:00.000Z',
  created_at: '2026-02-26T00:00:00.000Z',
};

const FAKE_REPUTATION = {
  player_id: 'player-1',
  reputation_score: 85,
  reputation_tier: 'gold',
  total_events: 20,
  positive_events: 15,
  negative_events: 5,
  matches_completed: 12,
  is_public: true,
  last_decay_calculation: null,
  calculated_at: '2026-02-26T00:00:00.000Z',
  created_at: '2026-02-26T00:00:00.000Z',
  updated_at: '2026-02-26T00:00:00.000Z',
};

// =============================================================================
// createReputationEvent
// =============================================================================

describe('createReputationEvent', () => {
  it('creates an event with default impact from DEFAULT_EVENT_IMPACTS', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    const result = await createReputationEvent('player-1', 'match_completed');

    expect(mockFrom).toHaveBeenCalledWith('reputation_event');
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'player-1',
        event_type: 'match_completed',
        base_impact: DEFAULT_EVENT_IMPACTS.match_completed,
      })
    );
    expect(result).toEqual(FAKE_EVENT);
  });

  it('uses customImpact when provided', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvent('player-1', 'match_completed', { customImpact: 99 });

    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ base_impact: 99 }));
  });

  it('uses DB config impact when available', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({
      reputation_config: configChainWith([{ event_type: 'match_completed', default_impact: 30 }]),
      reputation_event: insert,
    });

    await createReputationEvent('player-1', 'match_completed');

    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ base_impact: 30 }));
  });

  it('passes matchId and causedByPlayerId', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvent('player-1', 'review_received_5star', {
      matchId: 'match-42',
      causedByPlayerId: 'player-2',
    });

    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: 'match-42',
        caused_by_player_id: 'player-2',
      })
    );
  });

  it('passes metadata', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvent('player-1', 'match_completed', {
      metadata: { source: 'test' },
    });

    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { source: 'test' } })
    );
  });

  it('uses eventOccurredAt when provided', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });
    const date = new Date('2026-01-15T10:00:00.000Z');

    await createReputationEvent('player-1', 'match_completed', { eventOccurredAt: date });

    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_occurred_at: '2026-01-15T10:00:00.000Z' })
    );
  });

  it('throws on DB insert error', async () => {
    mockTables({
      reputation_config: emptyConfigChain(),
      reputation_event: insertSingleChain({ error: { message: 'insert failed' } }),
    });

    await expect(createReputationEvent('player-1', 'match_completed')).rejects.toThrow(
      'Failed to create reputation event: insert failed'
    );
  });

  it('sets null for optional fields when not provided', async () => {
    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvent('player-1', 'match_completed');

    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: null,
        caused_by_player_id: null,
        metadata: {},
      })
    );
  });

  it('falls back to stale config cache on DB error', async () => {
    const configErr = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
    };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(Date, 'now').mockReturnValue(fakeNow);

    const insert = insertSingleChain({ data: FAKE_EVENT });
    mockTables({ reputation_config: configErr, reputation_event: insert });

    // Should not throw — falls back to defaults
    const result = await createReputationEvent('player-1', 'match_completed');
    expect(result).toEqual(FAKE_EVENT);

    consoleSpy.mockRestore();
  });
});

// =============================================================================
// createReputationEvents (batch)
// =============================================================================

describe('createReputationEvents', () => {
  it('returns empty array for empty input', async () => {
    const result = await createReputationEvents([]);
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('creates multiple events in a single insert', async () => {
    const events = [FAKE_EVENT, { ...FAKE_EVENT, id: 'evt-2', event_type: 'match_on_time' }];
    const insert = insertBatchChain({ data: events });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    const result = await createReputationEvents([
      { playerId: 'player-1', eventType: 'match_completed' },
      { playerId: 'player-1', eventType: 'match_on_time' },
    ]);

    expect(result).toHaveLength(2);
    expect(insert.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'match_completed' }),
        expect.objectContaining({ event_type: 'match_on_time' }),
      ])
    );
  });

  it('fetches config only once for all events', async () => {
    const insert = insertBatchChain({ data: [FAKE_EVENT, FAKE_EVENT] });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvents([
      { playerId: 'p1', eventType: 'match_completed' },
      { playerId: 'p2', eventType: 'match_no_show' },
    ]);

    const configCalls = mockFrom.mock.calls.filter((c: unknown[]) => c[0] === 'reputation_config');
    expect(configCalls).toHaveLength(1);
  });

  it('uses customImpact per event when provided', async () => {
    const insert = insertBatchChain({ data: [FAKE_EVENT] });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvents([
      { playerId: 'p1', eventType: 'match_completed', options: { customImpact: 42 } },
    ]);

    expect(insert.insert).toHaveBeenCalledWith([expect.objectContaining({ base_impact: 42 })]);
  });

  it('falls back to DEFAULT_EVENT_IMPACTS when config has no entry', async () => {
    const insert = insertBatchChain({ data: [FAKE_EVENT] });
    mockTables({ reputation_config: emptyConfigChain(), reputation_event: insert });

    await createReputationEvents([{ playerId: 'p1', eventType: 'match_no_show' }]);

    expect(insert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ base_impact: DEFAULT_EVENT_IMPACTS.match_no_show }),
    ]);
  });

  it('throws on DB error', async () => {
    mockTables({
      reputation_config: emptyConfigChain(),
      reputation_event: insertBatchChain({ error: { message: 'batch insert failed' } }),
    });

    await expect(
      createReputationEvents([{ playerId: 'p1', eventType: 'match_completed' }])
    ).rejects.toThrow('Failed to create reputation events: batch insert failed');
  });
});

// =============================================================================
// getPlayerReputation
// =============================================================================

describe('getPlayerReputation', () => {
  it('returns reputation record when found', async () => {
    mockTables({ player_reputation: selectSingleChain({ data: FAKE_REPUTATION }) });

    const result = await getPlayerReputation('player-1');
    expect(result).toEqual(FAKE_REPUTATION);
    expect(mockFrom).toHaveBeenCalledWith('player_reputation');
  });

  it('returns null when no reputation record exists (PGRST116)', async () => {
    mockTables({
      player_reputation: selectSingleChain({
        error: { code: 'PGRST116', message: 'No rows found' },
      }),
    });

    const result = await getPlayerReputation('new-player');
    expect(result).toBeNull();
  });

  it('throws on non-PGRST116 DB error', async () => {
    mockTables({
      player_reputation: selectSingleChain({
        error: { code: '42P01', message: 'table not found' },
      }),
    });

    await expect(getPlayerReputation('player-1')).rejects.toThrow(
      'Failed to fetch player reputation: table not found'
    );
  });

  it('filters by the correct player_id', async () => {
    const chain = selectSingleChain({ data: FAKE_REPUTATION });
    mockTables({ player_reputation: chain });

    await getPlayerReputation('player-xyz');
    expect(chain.eq).toHaveBeenCalledWith('player_id', 'player-xyz');
  });
});

// =============================================================================
// getReputationSummary
// =============================================================================

describe('getReputationSummary', () => {
  it('returns mapped summary from RPC array result', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          score: 85,
          tier: 'gold',
          matches_completed: 12,
          is_public: true,
          positive_events: 15,
          negative_events: 3,
          total_events: 18,
        },
      ],
      error: null,
    });

    const result = await getReputationSummary('player-1');
    expect(result).toEqual({
      score: 85,
      tier: 'gold',
      matchesCompleted: 12,
      isPublic: true,
      positiveEvents: 15,
      negativeEvents: 3,
      totalEvents: 18,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_reputation_summary', {
      target_player_id: 'player-1',
    });
  });

  it('handles non-array RPC result (single object)', async () => {
    mockRpc.mockResolvedValue({
      data: {
        score: 90,
        tier: 'platinum',
        matches_completed: 50,
        is_public: true,
        positive_events: 40,
        negative_events: 2,
        total_events: 42,
      },
      error: null,
    });

    const result = await getReputationSummary('player-1');
    expect(result.score).toBe(90);
    expect(result.tier).toBe('platinum');
  });

  it('returns defaults for players with no reputation (empty array)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getReputationSummary('new-player');
    expect(result).toEqual({
      score: BASE_REPUTATION_SCORE,
      tier: 'unknown',
      matchesCompleted: 0,
      isPublic: false,
      positiveEvents: 0,
      negativeEvents: 0,
      totalEvents: 0,
    });
  });

  it('returns defaults when RPC returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await getReputationSummary('player-1');
    expect(result.score).toBe(BASE_REPUTATION_SCORE);
    expect(result.tier).toBe('unknown');
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });

    await expect(getReputationSummary('player-1')).rejects.toThrow(
      'Failed to fetch reputation summary: rpc failed'
    );
  });
});

// =============================================================================
// getReputationDisplay
// =============================================================================

describe('getReputationDisplay', () => {
  it('returns display data combining summary and tier config', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          score: 85,
          tier: 'gold',
          matches_completed: 12,
          is_public: true,
          positive_events: 10,
          negative_events: 2,
          total_events: 12,
        },
      ],
      error: null,
    });

    const result = await getReputationDisplay('player-1');
    expect(result).toEqual({
      tier: 'gold',
      score: 85,
      isVisible: true,
      tierLabel: TIER_CONFIGS.gold.label,
      tierColor: TIER_CONFIGS.gold.color,
      tierIcon: TIER_CONFIGS.gold.icon,
    });
  });

  it('returns unknown tier display for new players', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getReputationDisplay('new-player');
    expect(result.tier).toBe('unknown');
    expect(result.isVisible).toBe(false);
    expect(result.tierLabel).toBe(TIER_CONFIGS.unknown.label);
  });
});

// =============================================================================
// getMultiplePlayerReputations
// =============================================================================

describe('getMultiplePlayerReputations', () => {
  it('returns empty map for empty input', async () => {
    const result = await getMultiplePlayerReputations([]);
    expect(result).toEqual(new Map());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns map keyed by player_id', async () => {
    const rep1 = { ...FAKE_REPUTATION, player_id: 'p1' };
    const rep2 = { ...FAKE_REPUTATION, player_id: 'p2', reputation_score: 60 };
    mockTables({ player_reputation: selectMultiChain({ data: [rep1, rep2] }) });

    const result = await getMultiplePlayerReputations(['p1', 'p2']);
    expect(result.size).toBe(2);
    expect(result.get('p1')).toEqual(rep1);
    expect(result.get('p2')).toEqual(rep2);
  });

  it('queries player_reputation with correct player IDs', async () => {
    const chain = selectMultiChain({ data: [] });
    mockTables({ player_reputation: chain });

    await getMultiplePlayerReputations(['p1', 'p2', 'p3']);

    expect(mockFrom).toHaveBeenCalledWith('player_reputation');
    expect(chain.in).toHaveBeenCalledWith('player_id', ['p1', 'p2', 'p3']);
  });

  it('throws on DB error', async () => {
    mockTables({ player_reputation: selectMultiChain({ error: { message: 'query failed' } }) });

    await expect(getMultiplePlayerReputations(['p1'])).rejects.toThrow(
      'Failed to fetch player reputations: query failed'
    );
  });

  it('handles partial results (some players have no reputation)', async () => {
    mockTables({
      player_reputation: selectMultiChain({
        data: [{ ...FAKE_REPUTATION, player_id: 'p1' }],
      }),
    });

    const result = await getMultiplePlayerReputations(['p1', 'p2']);
    expect(result.size).toBe(1);
    expect(result.has('p1')).toBe(true);
    expect(result.has('p2')).toBe(false);
  });
});

// =============================================================================
// recalculateReputation
// =============================================================================

describe('recalculateReputation', () => {
  it('calls RPC with correct parameters (default no decay)', async () => {
    mockRpc.mockResolvedValue({ data: FAKE_REPUTATION, error: null });

    await recalculateReputation('player-1');
    expect(mockRpc).toHaveBeenCalledWith('recalculate_player_reputation', {
      target_player_id: 'player-1',
      apply_decay: false,
      min_events_for_public: MIN_EVENTS_FOR_PUBLIC,
    });
  });

  it('passes applyDecay: true', async () => {
    mockRpc.mockResolvedValue({ data: FAKE_REPUTATION, error: null });

    await recalculateReputation('player-1', { applyDecay: true });
    expect(mockRpc).toHaveBeenCalledWith('recalculate_player_reputation', {
      target_player_id: 'player-1',
      apply_decay: true,
      min_events_for_public: MIN_EVENTS_FOR_PUBLIC,
    });
  });

  it('returns the recalculated reputation', async () => {
    mockRpc.mockResolvedValue({ data: FAKE_REPUTATION, error: null });

    const result = await recalculateReputation('player-1');
    expect(result).toEqual(FAKE_REPUTATION);
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'recalc failed' } });

    await expect(recalculateReputation('player-1')).rejects.toThrow(
      'Failed to recalculate reputation: recalc failed'
    );
  });
});

// =============================================================================
// batchRecalculateWithDecay
// =============================================================================

describe('batchRecalculateWithDecay', () => {
  it('returns { processed: 0, updated: 0 } when no players need recalculation', async () => {
    mockTables({ player_reputation: batchFetchChain({ data: [] }) });

    const result = await batchRecalculateWithDecay();
    expect(result).toEqual({ processed: 0, updated: 0 });
  });

  it('returns { processed: 0, updated: 0 } when data is null', async () => {
    mockTables({ player_reputation: batchFetchChain({ data: null }) });

    const result = await batchRecalculateWithDecay();
    expect(result).toEqual({ processed: 0, updated: 0 });
  });

  it('processes each player and calls recalculate with decay', async () => {
    mockTables({
      player_reputation: batchFetchChain({ data: [{ player_id: 'p1' }, { player_id: 'p2' }] }),
    });
    mockRpc.mockResolvedValue({ data: FAKE_REPUTATION, error: null });

    const result = await batchRecalculateWithDecay();

    expect(result.processed).toBe(2);
    expect(result.updated).toBe(2);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('recalculate_player_reputation', {
      target_player_id: 'p1',
      apply_decay: true,
      min_events_for_public: MIN_EVENTS_FOR_PUBLIC,
    });
    expect(mockRpc).toHaveBeenCalledWith('recalculate_player_reputation', {
      target_player_id: 'p2',
      apply_decay: true,
      min_events_for_public: MIN_EVENTS_FOR_PUBLIC,
    });
  });

  it('respects custom batchSize', async () => {
    const chain = batchFetchChain({ data: [] });
    mockTables({ player_reputation: chain });

    await batchRecalculateWithDecay(50);
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it('uses default batchSize of 100', async () => {
    const chain = batchFetchChain({ data: [] });
    mockTables({ player_reputation: chain });

    await batchRecalculateWithDecay();
    expect(chain.limit).toHaveBeenCalledWith(100);
  });

  it('throws on fetch error', async () => {
    mockTables({
      player_reputation: batchFetchChain({ error: { message: 'fetch failed' } }),
    });

    await expect(batchRecalculateWithDecay()).rejects.toThrow(
      'Failed to fetch players for batch recalculation: fetch failed'
    );
  });

  it('continues processing when individual recalculation fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(Date, 'now').mockReturnValue(fakeNow);

    mockTables({
      player_reputation: batchFetchChain({
        data: [{ player_id: 'p1' }, { player_id: 'p2' }, { player_id: 'p3' }],
      }),
    });
    mockRpc
      .mockResolvedValueOnce({ data: FAKE_REPUTATION, error: null }) // p1 succeeds
      .mockRejectedValueOnce(new Error('timeout')) // p2 fails
      .mockResolvedValueOnce({ data: FAKE_REPUTATION, error: null }); // p3 succeeds

    const result = await batchRecalculateWithDecay();

    expect(result.processed).toBe(3);
    expect(result.updated).toBe(2);
    consoleSpy.mockRestore();
  });

  it('queries players with null or stale last_decay_calculation', async () => {
    const chain = batchFetchChain({ data: [] });
    mockTables({ player_reputation: chain });

    await batchRecalculateWithDecay();

    expect(mockFrom).toHaveBeenCalledWith('player_reputation');
    expect(chain.select).toHaveBeenCalledWith('player_id');
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringContaining('last_decay_calculation.is.null')
    );
    expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('last_decay_calculation.lt.'));
  });
});

// =============================================================================
// initializePlayerReputation
// =============================================================================

describe('initializePlayerReputation', () => {
  it('upserts a default reputation record', async () => {
    const chain = upsertChain({ data: FAKE_REPUTATION });
    mockTables({ player_reputation: chain });

    await initializePlayerReputation('player-1');

    expect(mockFrom).toHaveBeenCalledWith('player_reputation');
    expect(chain.upsert).toHaveBeenCalledWith(
      {
        player_id: 'player-1',
        reputation_score: BASE_REPUTATION_SCORE,
        reputation_tier: 'unknown',
        total_events: 0,
        positive_events: 0,
        negative_events: 0,
        matches_completed: 0,
      },
      { onConflict: 'player_id', ignoreDuplicates: true }
    );
  });

  it('returns the reputation record', async () => {
    mockTables({ player_reputation: upsertChain({ data: FAKE_REPUTATION }) });

    const result = await initializePlayerReputation('player-1');
    expect(result).toEqual(FAKE_REPUTATION);
  });

  it('throws on DB error', async () => {
    mockTables({
      player_reputation: upsertChain({ error: { message: 'upsert failed' } }),
    });

    await expect(initializePlayerReputation('player-1')).rejects.toThrow(
      'Failed to initialize player reputation: upsert failed'
    );
  });

  it('does not overwrite existing record (ignoreDuplicates)', async () => {
    const chain = upsertChain({ data: FAKE_REPUTATION });
    mockTables({ player_reputation: chain });

    await initializePlayerReputation('existing-player');

    const upsertCall = chain.upsert.mock.calls[0];
    expect(upsertCall[1]).toEqual({ onConflict: 'player_id', ignoreDuplicates: true });
  });
});

// =============================================================================
// countRecentCancellationEvents
// =============================================================================

describe('countRecentCancellationEvents', () => {
  it('returns count when events exist', async () => {
    mockTables({ reputation_event: countChain({ count: 3 }) });

    const result = await countRecentCancellationEvents('player-1');
    expect(result).toBe(3);
  });

  it('returns 0 when no matching events', async () => {
    mockTables({ reputation_event: countChain({ count: 0 }) });

    const result = await countRecentCancellationEvents('player-1');
    expect(result).toBe(0);
  });

  it('queries the reputation_event table', async () => {
    mockTables({ reputation_event: countChain({}) });

    await countRecentCancellationEvents('player-1');
    expect(mockFrom).toHaveBeenCalledWith('reputation_event');
  });

  it('filters by match_cancelled_late and match_left_late event types', async () => {
    const chain = countChain({});
    mockTables({ reputation_event: chain });

    await countRecentCancellationEvents('player-1');
    expect(chain.in).toHaveBeenCalledWith('event_type', [
      'match_cancelled_late',
      'match_left_late',
    ]);
  });

  it('uses 30-day default window', async () => {
    const chain = countChain({});
    mockTables({ reputation_event: chain });

    await countRecentCancellationEvents('player-1');

    expect(chain.gte).toHaveBeenCalledWith('event_occurred_at', expect.any(String));
  });

  it('accepts custom days parameter', async () => {
    const chain = countChain({});
    mockTables({ reputation_event: chain });

    await countRecentCancellationEvents('player-1', 7);

    expect(chain.gte).toHaveBeenCalledWith('event_occurred_at', expect.any(String));
  });

  it('returns 0 on DB error (graceful fallback)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(Date, 'now').mockReturnValue(fakeNow);

    mockTables({ reputation_event: countChain({ error: { message: 'connection failed' } }) });

    const result = await countRecentCancellationEvents('player-1');
    expect(result).toBe(0);

    consoleSpy.mockRestore();
  });

  it('returns 0 when count is null', async () => {
    mockTables({ reputation_event: countChain({ count: null }) });

    const result = await countRecentCancellationEvents('player-1');
    expect(result).toBe(0);
  });

  it('filters by the correct player_id', async () => {
    const chain = countChain({});
    mockTables({ reputation_event: chain });

    await countRecentCancellationEvents('player-42');
    expect(chain.eq).toHaveBeenCalledWith('player_id', 'player-42');
  });

  it('uses head:true count query (no row data fetched)', async () => {
    const chain = countChain({});
    mockTables({ reputation_event: chain });

    await countRecentCancellationEvents('player-1');
    expect(chain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
});

// =============================================================================
// getReviewEventType (pure function)
// =============================================================================

describe('getReviewEventType', () => {
  it.each([
    { rating: 1, expected: 'review_received_1star' },
    { rating: 2, expected: 'review_received_2star' },
    { rating: 3, expected: 'review_received_3star' },
    { rating: 4, expected: 'review_received_4star' },
    { rating: 5, expected: 'review_received_5star' },
  ])('maps rating $rating → $expected', ({ rating, expected }) => {
    expect(getReviewEventType(rating)).toBe(expected);
  });

  describe('clamping', () => {
    it('clamps rating below 1 to 1star', () => {
      expect(getReviewEventType(0)).toBe('review_received_1star');
      expect(getReviewEventType(-5)).toBe('review_received_1star');
    });

    it('clamps rating above 5 to 5star', () => {
      expect(getReviewEventType(6)).toBe('review_received_5star');
      expect(getReviewEventType(100)).toBe('review_received_5star');
    });
  });

  describe('rounding', () => {
    it('rounds fractional ratings to nearest integer', () => {
      expect(getReviewEventType(4.4)).toBe('review_received_4star');
      expect(getReviewEventType(4.5)).toBe('review_received_5star');
      expect(getReviewEventType(2.7)).toBe('review_received_3star');
      expect(getReviewEventType(1.2)).toBe('review_received_1star');
    });
  });
});

// =============================================================================
// calculateTierLocally (pure function)
// =============================================================================

describe('calculateTierLocally', () => {
  it('returns unknown tier with isVisible=false when below minimum events', () => {
    const result = calculateTierLocally(85, 4);
    expect(result.tier).toBe('unknown');
    expect(result.isVisible).toBe(false);
    expect(result.tierLabel).toBe(TIER_CONFIGS.unknown.label);
    expect(result.tierColor).toBe(TIER_CONFIGS.unknown.color);
    expect(result.tierIcon).toBe(TIER_CONFIGS.unknown.icon);
  });

  it('returns correct tier with isVisible=true when enough events', () => {
    const result = calculateTierLocally(85, MIN_EVENTS_FOR_PUBLIC);
    expect(result.tier).toBe('gold');
    expect(result.isVisible).toBe(true);
    expect(result.tierLabel).toBe(TIER_CONFIGS.gold.label);
    expect(result.tierColor).toBe(TIER_CONFIGS.gold.color);
    expect(result.tierIcon).toBe(TIER_CONFIGS.gold.icon);
  });

  it.each([
    { score: 95, events: 20, expectedTier: 'platinum' },
    { score: 90, events: 10, expectedTier: 'platinum' },
    { score: 80, events: 15, expectedTier: 'gold' },
    { score: 75, events: 10, expectedTier: 'gold' },
    { score: 65, events: 50, expectedTier: 'silver' },
    { score: 60, events: 10, expectedTier: 'silver' },
    { score: 50, events: 10, expectedTier: 'bronze' },
    { score: 0, events: 10, expectedTier: 'bronze' },
  ] as const)('score=$score, events=$events → $expectedTier', ({ score, events, expectedTier }) => {
    const result = calculateTierLocally(score, events);
    expect(result.tier).toBe(expectedTier);
    expect(result.tierLabel).toBe(TIER_CONFIGS[expectedTier].label);
    expect(result.tierColor).toBe(TIER_CONFIGS[expectedTier].color);
    expect(result.tierIcon).toBe(TIER_CONFIGS[expectedTier].icon);
  });

  it('preserves the input score in the output', () => {
    const result = calculateTierLocally(73.5, 15);
    expect(result.score).toBe(73.5);
  });

  it('returns all required ReputationDisplay fields', () => {
    const result = calculateTierLocally(90, 20);
    expect(result).toEqual({
      tier: 'platinum',
      score: 90,
      isVisible: true,
      tierLabel: expect.any(String),
      tierColor: expect.any(String),
      tierIcon: expect.any(String),
    });
  });
});
