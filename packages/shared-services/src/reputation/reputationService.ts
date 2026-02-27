/**
 * Reputation Service
 *
 * Handles player reputation management including:
 * - Creating reputation events
 * - Recalculating reputation scores
 * - Fetching reputation data
 */

import { supabase } from '../supabase';
import type {
  ReputationEventType,
  ReputationEvent,
  PlayerReputation,
  ReputationConfig,
  ReputationSummary,
  ReputationDisplay,
  CreateReputationEventOptions,
  RecalculateReputationOptions,
  BatchRecalculateResult,
} from './reputationTypes';
import {
  DEFAULT_EVENT_IMPACTS,
  getTierConfig,
  getTierForScore,
  MIN_EVENTS_FOR_PUBLIC,
  BASE_REPUTATION_SCORE,
} from './reputationConfig';

// =============================================================================
// CONFIGURATION CACHE
// =============================================================================

let configCache: Map<ReputationEventType, ReputationConfig> | null = null;
let configCacheTime: number = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and cache reputation configuration from database
 */
async function getReputationConfig(): Promise<Map<ReputationEventType, ReputationConfig>> {
  const now = Date.now();

  // Return cached config if still valid
  if (configCache && now - configCacheTime < CONFIG_CACHE_TTL) {
    return configCache;
  }

  const { data, error } = await supabase
    .from('reputation_config')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('[reputationService] Failed to fetch config:', error);
    // Fall back to stale cache if available, otherwise empty map (will use defaults)
    return configCache ?? new Map();
  }

  configCache = new Map((data as ReputationConfig[]).map(config => [config.event_type, config]));
  configCacheTime = now;

  return configCache;
}

/**
 * Get the impact value for an event type
 */
async function getImpactForEvent(eventType: ReputationEventType): Promise<number> {
  const config = await getReputationConfig();
  const eventConfig = config.get(eventType);

  if (eventConfig) {
    return eventConfig.default_impact;
  }

  // Fallback to hardcoded defaults
  return DEFAULT_EVENT_IMPACTS[eventType] ?? 0;
}

// =============================================================================
// EVENT CREATION
// =============================================================================

/**
 * Create a reputation event for a player.
 *
 * This logs an immutable record of an action affecting reputation.
 * The player_reputation table will be automatically updated via database trigger.
 *
 * @param playerId - The player this event affects
 * @param eventType - The type of event
 * @param options - Additional event context
 * @returns The created reputation event
 *
 * @example
 * ```ts
 * // Log match completion
 * await createReputationEvent(playerId, 'match_completed', {
 *   matchId: match.id,
 * });
 *
 * // Log a 5-star review
 * await createReputationEvent(playerId, 'review_received_5star', {
 *   causedByPlayerId: reviewerId,
 *   metadata: { reviewId: review.id },
 * });
 * ```
 */
export async function createReputationEvent(
  playerId: string,
  eventType: ReputationEventType,
  options: CreateReputationEventOptions = {}
): Promise<ReputationEvent> {
  const { matchId, causedByPlayerId, metadata = {}, eventOccurredAt, customImpact } = options;

  // Get impact from config or use custom/default
  const impact = customImpact ?? (await getImpactForEvent(eventType));

  const { data, error } = await supabase
    .from('reputation_event')
    .insert({
      player_id: playerId,
      event_type: eventType,
      base_impact: impact,
      match_id: matchId ?? null,
      caused_by_player_id: causedByPlayerId ?? null,
      metadata,
      event_occurred_at: eventOccurredAt?.toISOString() ?? new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create reputation event: ${error.message}`);
  }

  return data as ReputationEvent;
}

/**
 * Create multiple reputation events in a single transaction.
 * Useful for match completion which may trigger multiple events.
 *
 * @param events - Array of events to create
 */
export async function createReputationEvents(
  events: Array<{
    playerId: string;
    eventType: ReputationEventType;
    options?: CreateReputationEventOptions;
  }>
): Promise<ReputationEvent[]> {
  if (events.length === 0) return [];

  // Fetch config once for all events
  const config = await getReputationConfig();

  const eventInserts = events.map(({ playerId, eventType, options = {} }) => {
    const eventConfig = config.get(eventType);
    const impact =
      options.customImpact ?? eventConfig?.default_impact ?? DEFAULT_EVENT_IMPACTS[eventType] ?? 0;

    return {
      player_id: playerId,
      event_type: eventType,
      base_impact: impact,
      match_id: options.matchId ?? null,
      caused_by_player_id: options.causedByPlayerId ?? null,
      metadata: options.metadata ?? {},
      event_occurred_at: options.eventOccurredAt?.toISOString() ?? new Date().toISOString(),
    };
  });

  const { data, error } = await supabase.from('reputation_event').insert(eventInserts).select();

  if (error) {
    throw new Error(`Failed to create reputation events: ${error.message}`);
  }

  return data as ReputationEvent[];
}

// =============================================================================
// REPUTATION QUERIES
// =============================================================================

/**
 * Get a player's reputation data.
 * Returns null if the player has no reputation record yet.
 *
 * @param playerId - The player ID
 */
export async function getPlayerReputation(playerId: string): Promise<PlayerReputation | null> {
  const { data, error } = await supabase
    .from('player_reputation')
    .select('*')
    .eq('player_id', playerId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - player has no reputation yet
      return null;
    }
    throw new Error(`Failed to fetch player reputation: ${error.message}`);
  }

  return data as PlayerReputation;
}

/**
 * Get reputation summary using the database RPC function.
 * This is a privacy-safe way to get aggregated reputation data.
 *
 * @param playerId - The player ID
 */
export async function getReputationSummary(playerId: string): Promise<ReputationSummary> {
  const { data, error } = await supabase.rpc('get_reputation_summary', {
    target_player_id: playerId,
  });

  if (error) {
    throw new Error(`Failed to fetch reputation summary: ${error.message}`);
  }

  // RPC returns an array, take first row
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    // Return default values for players without reputation
    return {
      score: BASE_REPUTATION_SCORE,
      tier: 'unknown',
      matchesCompleted: 0,
      isPublic: false,
      positiveEvents: 0,
      negativeEvents: 0,
      totalEvents: 0,
    };
  }

  return {
    score: row.score,
    tier: row.tier,
    matchesCompleted: row.matches_completed,
    isPublic: row.is_public,
    positiveEvents: row.positive_events,
    negativeEvents: row.negative_events,
    totalEvents: row.total_events,
  };
}

/**
 * Get reputation display data for UI components.
 *
 * @param playerId - The player ID
 */
export async function getReputationDisplay(playerId: string): Promise<ReputationDisplay> {
  const summary = await getReputationSummary(playerId);
  const tierConfig = getTierConfig(summary.tier);

  return {
    tier: summary.tier,
    score: summary.score,
    isVisible: summary.isPublic,
    tierLabel: tierConfig.label,
    tierColor: tierConfig.color,
    tierIcon: tierConfig.icon,
  };
}

/**
 * Get reputation data for multiple players at once.
 * Useful for displaying reputation badges in lists.
 *
 * @param playerIds - Array of player IDs
 */
export async function getMultiplePlayerReputations(
  playerIds: string[]
): Promise<Map<string, PlayerReputation>> {
  if (playerIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('player_reputation')
    .select('*')
    .in('player_id', playerIds);

  if (error) {
    throw new Error(`Failed to fetch player reputations: ${error.message}`);
  }

  return new Map((data as PlayerReputation[]).map(rep => [rep.player_id, rep]));
}

// =============================================================================
// REPUTATION RECALCULATION
// =============================================================================

/**
 * Manually trigger reputation recalculation for a player.
 * This is normally handled by a database trigger on event insert.
 *
 * @param playerId - The player ID
 * @param options - Recalculation options
 */
export async function recalculateReputation(
  playerId: string,
  options: RecalculateReputationOptions = {}
): Promise<PlayerReputation> {
  const { applyDecay = false } = options;

  const { data, error } = await supabase.rpc('recalculate_player_reputation', {
    target_player_id: playerId,
    apply_decay: applyDecay,
    min_events_for_public: MIN_EVENTS_FOR_PUBLIC,
  });

  if (error) {
    throw new Error(`Failed to recalculate reputation: ${error.message}`);
  }

  return data as PlayerReputation;
}

/**
 * Batch recalculate reputations with decay.
 * This should be called by a scheduled job (e.g., daily).
 *
 * @param batchSize - Number of players to process per batch
 */
export async function batchRecalculateWithDecay(batchSize = 100): Promise<BatchRecalculateResult> {
  // Get players who need decay recalculation
  // (those who haven't been recalculated in the last day or have null last_decay_calculation)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: players, error: fetchError } = await supabase
    .from('player_reputation')
    .select('player_id')
    .or(`last_decay_calculation.is.null,last_decay_calculation.lt.${oneDayAgo.toISOString()}`)
    .limit(batchSize);

  if (fetchError) {
    throw new Error(`Failed to fetch players for batch recalculation: ${fetchError.message}`);
  }

  if (!players || players.length === 0) {
    return { processed: 0, updated: 0 };
  }

  let updated = 0;

  // Process each player
  for (const player of players) {
    try {
      await recalculateReputation(player.player_id, { applyDecay: true });
      updated++;
    } catch (err) {
      console.error(`[reputationService] Failed to recalculate for ${player.player_id}:`, err);
    }
  }

  return {
    processed: players.length,
    updated,
  };
}

// =============================================================================
// CANCELLATION HISTORY
// =============================================================================

/**
 * Count recent late cancellation/leave events for a player.
 * Used by cancelMatch() and leaveMatch() to feed the history modifier.
 *
 * @param playerId - The player to check
 * @param days - Look-back window in days (default 30)
 * @returns Number of match_cancelled_late or match_left_late events in the window
 */
export async function countRecentCancellationEvents(
  playerId: string,
  days: number = 30
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { count, error } = await supabase
    .from('reputation_event')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .in('event_type', ['match_cancelled_late', 'match_left_late'])
    .gte('event_occurred_at', since.toISOString());

  if (error) {
    console.error('[reputationService] Failed to count recent cancellation events:', error);
    return 0;
  }

  return count ?? 0;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Initialize reputation for a new player.
 * Creates a default reputation record if one doesn't exist.
 *
 * @param playerId - The player ID
 */
export async function initializePlayerReputation(playerId: string): Promise<PlayerReputation> {
  const { data, error } = await supabase
    .from('player_reputation')
    .upsert(
      {
        player_id: playerId,
        reputation_score: BASE_REPUTATION_SCORE,
        reputation_tier: 'unknown',
        total_events: 0,
        positive_events: 0,
        negative_events: 0,
        matches_completed: 0,
      },
      { onConflict: 'player_id', ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to initialize player reputation: ${error.message}`);
  }

  return data as PlayerReputation;
}

/**
 * Get the review star event type for a given rating.
 *
 * @param rating - Rating from 1-5
 */
export function getReviewEventType(rating: number): ReputationEventType {
  const clampedRating = Math.max(1, Math.min(5, Math.round(rating)));
  return `review_received_${clampedRating}star` as ReputationEventType;
}

/**
 * Calculate local tier without database call.
 * Useful for optimistic UI updates.
 */
export function calculateTierLocally(score: number, totalEvents: number): ReputationDisplay {
  const tier = getTierForScore(score, totalEvents);
  const tierConfig = getTierConfig(tier);

  return {
    tier,
    score,
    isVisible: totalEvents >= MIN_EVENTS_FOR_PUBLIC,
    tierLabel: tierConfig.label,
    tierColor: tierConfig.color,
    tierIcon: tierConfig.icon,
  };
}
