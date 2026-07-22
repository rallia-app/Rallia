/**
 * Player Service
 * Handles player search and related operations.
 */

import type { DayEnum } from '@rallia/shared-types';
import { supabase } from '../supabase';

// =============================================================================
// HOME LOCATION TYPES
// =============================================================================

export interface HomeLocation {
  /** Normalized postal code */
  postalCode: string;
  /** Country code: 'CA' or 'US' */
  country: 'CA' | 'US';
  /** Latitude of postal code centroid */
  latitude: number;
  /** Longitude of postal code centroid */
  longitude: number;
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Filter types for player search
 */
export type GenderFilter = 'all' | 'male' | 'female' | 'other';
/**
 * Hour-range filter for `search_players_nearby`. The RPC takes optional
 * `p_min_hour` / `p_max_hour` SMALLINT params (0..23). `null` on either
 * bound means open-ended; both null = no hour-range filter at all.
 */
export interface HourRangeFilter {
  minHour: number | null;
  maxHour: number | null;
}
export type DayFilter =
  | 'all'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';
export type PlayStyleFilter =
  | 'all'
  | 'counterpuncher'
  | 'aggressive_baseliner'
  | 'serve_and_volley'
  | 'all_court';
export type SkillLevelFilter = 'all' | string; // '1.0', '1.5', etc.
export type DistanceFilter = 'all' | number; // 5, 10, 15, etc.
export type SortByFilter =
  | 'distance'
  | 'name_asc'
  | 'name_desc'
  | 'rating_high'
  | 'rating_low'
  | 'recently_active';

export type ReputationFilter = 'all' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface PlayerFilters {
  favorites?: boolean;
  blocked?: boolean;
  gender?: GenderFilter;
  skillLevel?: SkillLevelFilter; // kept for backward compat, no longer set by UI
  rating?: string[]; // rating score IDs (multi-select)
  reputation?: ReputationFilter; // reputation tier filter
  certifiedOnly?: boolean; // show only certified players
  maxDistance?: DistanceFilter;
  /** Hour range filter (06..22). Both `minHour`/`maxHour` null = no filter. */
  hourRange?: HourRangeFilter;
  day?: DayFilter;
  playStyle?: PlayStyleFilter;
  sortBy?: SortByFilter;
}

/**
 * Player search result with profile and sport-specific rating
 */
export interface PlayerSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  profile_picture_url: string | null;
  city: string | null;
  /** Player's gender */
  gender: string | null;
  /** Sport-specific rating (null if player has no rating for this sport) */
  rating: {
    label: string;
    value: number | null;
    /** Whether the player is certified at this rating level */
    is_certified: boolean;
    /** Badge status: self_declared, certified, or disputed */
    badge_status: 'self_declared' | 'certified' | 'disputed';
  } | null;
  /** Player's latitude (from home location) */
  latitude: number | null;
  /** Player's longitude (from home location) */
  longitude: number | null;
  /** Distance in meters from the searching user's location (null if location not provided) */
  distance_meters: number | null;
  /** Reputation tier (null if no reputation record) */
  reputation_tier: string | null;
  /** Reputation score 0-100 (null if no reputation record) */
  reputation_score: number | null;
  /** Whether reputation is public (enough matches played) */
  reputation_is_public: boolean;
  /** Last seen timestamp for online status */
  last_seen_at: string | null;
}

export type AvailabilityDay = DayEnum;

/**
 * Paginated response for player search
 */
export interface PlayersPage {
  players: PlayerSearchResult[];
  hasMore: boolean;
  nextOffset: number | null;
  totalCount: number;
}

/**
 * Parameters for searching players
 */
export interface SearchPlayersParams {
  /** Sport ID to filter players by (required - only shows active players in this sport) */
  sportId: string;
  /** Current user ID to exclude from results (optional - for guest users) */
  currentUserId?: string;
  /** Search query for name matching */
  searchQuery?: string;
  /** Pagination offset */
  offset?: number;
  /** Number of results per page */
  limit?: number;
  /** Player IDs to exclude (e.g., already invited players) */
  excludePlayerIds?: string[];
  /** Filters to apply */
  filters?: PlayerFilters;
  /** Favorite player IDs (to filter by favorites) */
  favoritePlayerIds?: string[];
  /** Blocked player IDs (to filter by blocked or exclude blocked) */
  blockedPlayerIds?: string[];
  /** User's current latitude (for distance calculation) */
  latitude?: number;
  /** User's current longitude (for distance calculation) */
  longitude?: number;
}

// =============================================================================
// BADGE STATUS COMPUTATION
// =============================================================================

export type BadgeStatus = 'self_declared' | 'certified' | 'disputed';

/**
 * Compute the effective badge status from raw rating data.
 * A player is certified if any of these conditions hold:
 * - The stored badge_status is 'certified'
 * - The is_certified flag is true
 * - They have 3+ referrals/references
 * - They have 1+ approved proofs at their current rating level
 *
 * @param params - Raw rating certification data
 * @returns The computed badge status
 */
export function computeBadgeStatus(params: {
  rawBadgeStatus?: string | null;
  isCertified?: boolean;
  referralsCount?: number;
  approvedProofsCount?: number;
}): BadgeStatus {
  if (params.rawBadgeStatus === 'disputed') return 'disputed';
  if (
    params.rawBadgeStatus === 'certified' ||
    params.isCertified ||
    (params.referralsCount ?? 0) >= 3 ||
    (params.approvedProofsCount ?? 0) >= 1
  ) {
    return 'certified';
  }
  return 'self_declared';
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Search for players active in a specific sport.
 *
 * Delegates to the `search_players_nearby` Postgres RPC so filtering,
 * sorting, pagination, and distance computation happen server-side.
 * This keeps infinite-scroll pages stable: later pages never reorder
 * rows that are already visible.
 */
export async function searchPlayersForSport(params: SearchPlayersParams): Promise<PlayersPage> {
  const {
    sportId,
    currentUserId,
    searchQuery,
    offset = 0,
    limit = 20,
    excludePlayerIds = [],
    filters = {},
    favoritePlayerIds = [],
    blockedPlayerIds = [],
    latitude,
    longitude,
  } = params;

  // Map UI filter values to RPC parameters.
  const minSkillValue =
    filters.skillLevel && filters.skillLevel !== 'all' ? Number(filters.skillLevel) : null;

  const minTravelDistanceKm =
    filters.maxDistance && filters.maxDistance !== 'all'
      ? typeof filters.maxDistance === 'number'
        ? filters.maxDistance
        : parseInt(String(filters.maxDistance), 10)
      : null;

  // Hour range → RPC's optional p_min_hour / p_max_hour. Null means
  // open-ended on that bound; both null = no hour-range filter.
  const minHour = filters.hourRange?.minHour ?? null;
  const maxHour = filters.hourRange?.maxHour ?? null;

  const day = filters.day && filters.day !== 'all' ? filters.day : null;

  const playStyle = filters.playStyle && filters.playStyle !== 'all' ? filters.playStyle : null;

  const gender = filters.gender && filters.gender !== 'all' ? filters.gender : null;

  // New filter mappings
  const ratingScoreIds = filters.rating && filters.rating.length > 0 ? filters.rating : null;

  const reputationTier =
    filters.reputation && filters.reputation !== 'all' ? filters.reputation : null;

  const certifiedOnly = !!filters.certifiedOnly;

  // Favorites toggle ON with empty favorites list → short-circuit to empty result
  // (the RPC would return all players otherwise since the filter wouldn't apply).
  if (filters.favorites && favoritePlayerIds.length === 0) {
    return { players: [], hasMore: false, nextOffset: null, totalCount: 0 };
  }
  // Blocked toggle ON with empty blocked list → same.
  if (filters.blocked && blockedPlayerIds.length === 0) {
    return { players: [], hasMore: false, nextOffset: null, totalCount: 0 };
  }

  const { data, error } = await supabase.rpc('search_players_nearby', {
    p_sport_id: sportId,
    p_current_user_id: currentUserId ?? null,
    p_search_query: searchQuery && searchQuery.trim().length > 0 ? searchQuery.trim() : null,
    p_latitude: latitude ?? null,
    p_longitude: longitude ?? null,
    p_gender: gender,
    p_min_skill_value: minSkillValue,
    p_min_travel_distance_km:
      !minTravelDistanceKm || isNaN(minTravelDistanceKm) ? null : minTravelDistanceKm,
    // p_availability is a deprecated no-op on the RPC; kept null to satisfy
    // the signature. Hour filtering now flows through p_min_hour/p_max_hour.
    p_availability: null,
    p_day: day,
    p_play_style: playStyle,
    p_favorite_player_ids: favoritePlayerIds.length > 0 ? favoritePlayerIds : null,
    p_blocked_player_ids: blockedPlayerIds.length > 0 ? blockedPlayerIds : null,
    p_favorites_only: !!filters.favorites,
    p_blocked_only: !!filters.blocked,
    p_exclude_player_ids: excludePlayerIds.length > 0 ? excludePlayerIds : null,
    p_sort_by: filters.sortBy ?? 'distance',
    p_limit: limit,
    p_offset: offset,
    p_rating_score_ids: ratingScoreIds,
    p_reputation_tier: reputationTier,
    p_certified_only: certifiedOnly,
    p_min_hour: minHour,
    p_max_hour: maxHour,
  });

  if (error) {
    throw new Error(`Failed to search players: ${error.message}`);
  }

  type RpcRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    profile_picture_url: string | null;
    city: string | null;
    gender: string | null;
    rating_label: string | null;
    rating_value: number | null;
    rating_is_certified: boolean | null;
    rating_badge_status: string | null;
    latitude: number | null;
    longitude: number | null;
    distance_meters: number | null;
    total_count: number | string;
    reputation_tier: string | null;
    reputation_score: number | null;
    reputation_is_public: boolean | null;
    last_seen_at: string | null;
  };

  const rows = (data ?? []) as RpcRow[];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const players: PlayerSearchResult[] = rows.map(row => ({
    id: row.id,
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    display_name: row.display_name,
    profile_picture_url: row.profile_picture_url,
    city: row.city,
    gender: row.gender,
    rating: row.rating_label
      ? {
          label: row.rating_label,
          value: row.rating_value,
          is_certified: row.rating_is_certified ?? false,
          badge_status: (row.rating_badge_status ?? 'self_declared') as BadgeStatus,
        }
      : null,
    latitude: row.latitude,
    longitude: row.longitude,
    distance_meters: row.distance_meters,
    reputation_tier: row.reputation_tier ?? null,
    reputation_score: row.reputation_score ?? null,
    reputation_is_public: row.reputation_is_public ?? false,
    last_seen_at: row.last_seen_at ?? null,
  }));

  const hasMore = offset + rows.length < totalCount;

  return {
    players,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    totalCount,
  };
}

// =============================================================================
// HOME LOCATION SYNC
// =============================================================================

/**
 * Sync home location to the player table.
 * Called after user authentication to persist postal code location.
 *
 * @param playerId - The player's user ID
 * @param location - The home location data from pre-onboarding
 * @returns Success status
 */
export async function syncHomeLocation(
  playerId: string,
  location: HomeLocation
): Promise<{ success: boolean; error?: string; transient?: boolean }> {
  try {
    const { error } = await supabase
      .from('player')
      .update({
        postal_code: location.postalCode,
        country: location.country,
        latitude: location.latitude,
        longitude: location.longitude,
      })
      .eq('id', playerId);

    if (error) {
      // 57014 = statement_timeout. The sync is redundant most of the time
      // (caller now compares values before calling), so a transient timeout
      // shouldn't surface as a scary console error. The next sign-in will
      // retry if anything actually drifted.
      const isStatementTimeout = error.code === '57014';
      if (isStatementTimeout) {
        console.debug('[PlayerService] Home location sync timed out (will retry next sign-in)');
      } else {
        console.error('[PlayerService] Failed to sync home location:', error);
      }
      return { success: false, error: error.message, transient: isStatementTimeout };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PlayerService] Error syncing home location:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Get player's home location from the database.
 *
 * @param playerId - The player's user ID
 * @returns The home location or null if not set
 */
export async function getHomeLocation(playerId: string): Promise<HomeLocation | null> {
  try {
    const { data, error } = await supabase
      .from('player')
      .select('postal_code, country, latitude, longitude')
      .eq('id', playerId)
      .single();

    if (error || !data) {
      return null;
    }

    if (!data.postal_code || !data.country || !data.latitude || !data.longitude) {
      return null;
    }

    return {
      postalCode: data.postal_code,
      country: data.country as 'CA' | 'US',
      latitude: data.latitude,
      longitude: data.longitude,
    };
  } catch (error) {
    console.error('[PlayerService] Error fetching home location:', error);
    return null;
  }
}

// =============================================================================
// RATING & REPUTATION ENRICHMENT
// =============================================================================

/** Sport-scoped rating plus reputation for one player, as carried on
 *  PlayerSearchResult rows. */
export type PlayerRatingReputation = {
  rating: PlayerSearchResult['rating'];
  reputation_tier: string | null;
  reputation_score: number | null;
  reputation_is_public: boolean;
};

/**
 * Batch-fetch rating + reputation for a set of players in one sport, keyed by
 * player id. Rating reads through player_sport.active_rating_score_id — the
 * canonical rating read path. Returns a Record (not a Map) so react-query
 * persistence round-trips it cleanly as JSON.
 */
export async function getPlayersRatingReputation(
  playerIds: string[],
  sportId: string
): Promise<Record<string, PlayerRatingReputation>> {
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return {};

  const [repRes, ratingRes] = await Promise.all([
    supabase
      .from('player_reputation')
      .select('player_id, reputation_tier, reputation_score, is_public')
      .in('player_id', ids),
    supabase
      .from('player_sport')
      .select(
        'player_id, player_rating_score!active_rating_score_id ( is_certified, badge_status, rating_score!rating_score_id ( label, value ) )'
      )
      .in('player_id', ids)
      .eq('sport_id', sportId),
  ]);
  if (repRes.error) throw new Error(repRes.error.message);
  if (ratingRes.error) throw new Error(ratingRes.error.message);

  type RatingRow = {
    player_id: string;
    player_rating_score: {
      is_certified: boolean | null;
      badge_status: 'self_declared' | 'certified' | 'disputed' | null;
      rating_score: { label: string | null; value: number | null } | null;
    } | null;
  };
  const ratingByPlayer = new Map<string, PlayerSearchResult['rating']>();
  for (const row of (ratingRes.data ?? []) as unknown as RatingRow[]) {
    const prs = row.player_rating_score;
    const rs = prs?.rating_score;
    if (!prs || !rs?.label) continue;
    ratingByPlayer.set(row.player_id, {
      label: rs.label,
      value: rs.value,
      is_certified: prs.is_certified ?? false,
      badge_status: prs.badge_status ?? 'self_declared',
    });
  }
  const repById = new Map((repRes.data ?? []).map(r => [r.player_id, r]));

  const byId: Record<string, PlayerRatingReputation> = {};
  for (const id of ids) {
    const rep = repById.get(id);
    byId[id] = {
      rating: ratingByPlayer.get(id) ?? null,
      reputation_tier: rep?.reputation_tier ?? null,
      reputation_score: rep?.reputation_score ?? null,
      reputation_is_public: rep?.is_public ?? false,
    };
  }
  return byId;
}
