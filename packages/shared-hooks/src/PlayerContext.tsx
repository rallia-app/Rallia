/**
 * Player Context - Global player state management
 *
 * This context provides a single source of truth for the current user's player data.
 * All components using usePlayer() will share the same player state, ensuring
 * that when one component refetches the player data (e.g., after updating settings),
 * all consumers are updated.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';
import {
  supabase,
  computeBadgeStatus,
  getTierConfig,
  getTierForScore,
} from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';
import type { Player } from '@rallia/shared-types';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default max travel distance in km if not set by user */
const DEFAULT_MAX_TRAVEL_DISTANCE_KM = 50;

// TEMP perf instrumentation (REMOVE after diagnosis). Shared global clock so
// deltas are continuous across files/contexts. Grep `[perf⏱]` to remove.
function perfLog(label: string, extra?: Record<string, unknown>) {
  const g = globalThis as unknown as { __ralliaPerfLast?: number };
  const now = Date.now();
  const since = g.__ralliaPerfLast ? now - g.__ralliaPerfLast : 0;
  g.__ralliaPerfLast = now;
  // eslint-disable-next-line no-console
  console.log(
    `[perf⏱] ${new Date(now).toISOString().slice(11, 23)} +${String(since).padStart(6)}ms  ${label}`,
    extra ?? ''
  );
}

// =============================================================================
// TYPES
// =============================================================================

export interface PrimaryRating {
  // Core fields
  value: number | null;
  label: string;
  badge_status?: 'self_declared' | 'certified' | 'disputed';
  // From player_rating_score
  playerRatingScoreId?: string;
  ratingScoreId?: string;
  isCertified?: boolean;
  certifiedAt?: string | null;
  referralsCount?: number;
  approvedProofsCount?: number;
  peerEvaluationAverage?: number | null;
  peerEvaluationCount?: number;
  // From rating_score
  skillLevel?: string | null;
  scoreDescription?: string | null;
  // From rating_system
  ratingSystemCode?: string | null;
  ratingSystemName?: string | null;
  ratingSystemDescription?: string | null;
  minValue?: number;
  maxValue?: number;
}

export interface SportPreferences {
  playerSportId: string;
  isActive: boolean;
  isPrimary: boolean;
  matchDuration: string | null;
  matchType: string | null;
  playStyle: { id: string; name: string; description: string } | null;
  playAttributes: Array<{ id: string; name: string; description: string; category: string }>;
}

export interface PlayerContextType {
  /** Current user's player data */
  player: Player | null;

  /** Loading state */
  loading: boolean;

  /** Error state */
  error: Error | null;

  /** Refetch the player data */
  refetch: () => Promise<void>;

  /** Max travel distance with fallback to default */
  maxTravelDistanceKm: number;

  /** Primary sport rating (loads instantly with player data) */
  primaryRating: PrimaryRating | null;

  /** All sport ratings keyed by sport_id (loads instantly with player data) */
  sportRatings: Record<string, PrimaryRating>;

  /** All sport preferences keyed by sport_id (loads instantly with player data) */
  sportPreferences: Record<string, SportPreferences>;

  /** Reputation display data (loaded with player data, no extra fetch needed) */
  reputationDisplay: ReputationDisplay | null;

  /** Total reputation events count (for coveted badge calculation) */
  reputationTotalEvents: number;
}

// =============================================================================
// CONTEXT
// =============================================================================

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface PlayerProviderProps {
  children: ReactNode;
  /** The authenticated user's ID. Pass from your auth context. */
  userId: string | undefined;
}

export const PlayerProvider: React.FC<PlayerProviderProps> = ({ children, userId }) => {
  const [player, setPlayer] = useState<Player | null>(null);
  const [primaryRating, setPrimaryRating] = useState<PrimaryRating | null>(null);
  const [sportRatings, setSportRatings] = useState<Record<string, PrimaryRating>>({});
  const [sportPreferences, setSportPreferences] = useState<Record<string, SportPreferences>>({});
  const [reputationDisplay, setReputationDisplay] = useState<ReputationDisplay | null>(null);
  const [reputationTotalEvents, setReputationTotalEvents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPlayer = useCallback(async () => {
    // No userId means not authenticated - clear player
    if (!userId) {
      setPlayer(null);
      setPrimaryRating(null);
      setSportRatings({});
      setSportPreferences({});
      setReputationDisplay(null);
      setReputationTotalEvents(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // TEMP perf: time the whole fetch + each parallel query independently, so
      // we can tell contention/auth-lock (all resolve together, late) from a
      // single slow query (one lags). REMOVE after diagnosis.
      const __t0 = Date.now();
      perfLog('PlayerCtx.fetchPlayer START', { userId });
      const tq = <T,>(label: string, q: PromiseLike<T>): Promise<T> =>
        Promise.resolve(q).then(r => {
          perfLog(`  PlayerCtx q:${label} resolved`, { ms: Date.now() - __t0 });
          return r;
        });

      // Fetch player and primary sport rating in parallel.
      // NOTE: the primary sport_id is derived from `preferencesResult` below
      // (it already selects `is_primary` + `sport_id` for every row), so we do
      // NOT issue a separate primary-sport query — one fewer round-trip in the
      // cold-start burst, result-identical.
      const [playerResult, ratingsResult, preferencesResult, reputationResult] = await Promise.all([
        // Player data
        tq('player', supabase.from('player').select('*').eq('id', userId).single()),

        // All player ratings (expanded for SportProfile cache)
        tq(
          'ratings',
          supabase
            .from('player_rating_score')
            .select(
              `
            id,
            rating_score_id,
            badge_status,
            is_certified,
            certified_at,
            referrals_count,
            approved_proofs_count,
            peer_evaluation_average,
            peer_evaluation_count,
            rating_score:rating_score_id (
              id, label, value, skill_level, description,
              rating_system:rating_system_id (
                code, name, description, min_value, max_value, sport_id
              )
            )
          `
            )
            .eq('player_id', userId)
            .order('is_certified', { ascending: false })
            .order('created_at', { ascending: false })
        ),

        // All player sport preferences with play style and attributes
        tq(
          'preferences',
          supabase
            .from('player_sport')
            .select(
              `
            id,
            sport_id,
            is_active,
            is_primary,
            preferred_match_duration,
            preferred_match_type,
            player_sport_play_style (
              play_style:play_style_id (id, name, description)
            ),
            player_sport_play_attribute (
              play_attribute:play_attribute_id (id, name, description, category)
            )
          `
            )
            .eq('player_id', userId)
        ),

        // Reputation data
        tq(
          'reputation',
          supabase
            .from('player_reputation')
            .select('reputation_score, reputation_tier, total_events, matches_completed, is_public')
            .eq('player_id', userId)
            .maybeSingle()
        ),
      ]);
      perfLog('PlayerCtx.fetchPlayer DONE (all 5 resolved)', { totalMs: Date.now() - __t0 });

      // Handle player result
      if (playerResult.error) {
        // PGRST116 means no rows found - player record doesn't exist yet
        if (playerResult.error.code === 'PGRST116') {
          setPlayer(null);
          setPrimaryRating(null);
          setSportRatings({});
          setSportPreferences({});
          setReputationDisplay(null);
          setReputationTotalEvents(0);
          setLoading(false);
          return;
        }
        throw new Error(playerResult.error.message);
      }

      setPlayer(playerResult.data);

      // Process reputation
      if (reputationResult.data) {
        const rep = reputationResult.data as {
          reputation_score: number;
          reputation_tier: string;
          total_events: number;
          matches_completed: number;
          is_public: boolean;
        };
        const tier = getTierForScore(rep.reputation_score, rep.total_events);
        const tierConfig = getTierConfig(tier);
        setReputationDisplay({
          tier,
          score: rep.reputation_score,
          isVisible: rep.is_public,
          tierLabel: tierConfig.label,
          tierColor: tierConfig.color,
          tierIcon: tierConfig.icon,
        });
        setReputationTotalEvents(rep.total_events);
      } else {
        setReputationDisplay(null);
        setReputationTotalEvents(0);
      }

      // Build sport ratings map from all ratings
      const ratingsMap: Record<string, PrimaryRating> = {};
      if (ratingsResult.data) {
        for (const rating of ratingsResult.data) {
          const ratingScore = rating.rating_score as {
            id?: string;
            label?: string;
            value?: number | null;
            skill_level?: string | null;
            description?: string | null;
            rating_system?: {
              code?: string;
              name?: string;
              description?: string;
              min_value?: number;
              max_value?: number;
              sport_id?: string;
            };
          } | null;
          const ratingSystem = ratingScore?.rating_system;
          const sportId = ratingSystem?.sport_id;
          if (sportId && !ratingsMap[sportId]) {
            const badge_status = computeBadgeStatus({
              rawBadgeStatus: rating.badge_status,
              isCertified: rating.is_certified ?? false,
              referralsCount: rating.referrals_count ?? 0,
              approvedProofsCount: rating.approved_proofs_count ?? 0,
            });
            ratingsMap[sportId] = {
              value: ratingScore?.value ?? null,
              label: ratingScore?.label ?? '',
              badge_status,
              playerRatingScoreId: rating.id,
              ratingScoreId: ratingScore?.id,
              isCertified: rating.is_certified ?? false,
              certifiedAt: rating.certified_at ?? null,
              referralsCount: rating.referrals_count ?? 0,
              approvedProofsCount: rating.approved_proofs_count ?? 0,
              peerEvaluationAverage: rating.peer_evaluation_average ?? null,
              peerEvaluationCount: rating.peer_evaluation_count ?? 0,
              skillLevel: ratingScore?.skill_level ?? null,
              scoreDescription: ratingScore?.description ?? null,
              ratingSystemCode: ratingSystem?.code ?? null,
              ratingSystemName: ratingSystem?.name ?? null,
              ratingSystemDescription: ratingSystem?.description ?? null,
              minValue: ratingSystem?.min_value ?? 0,
              maxValue: ratingSystem?.max_value ?? 10,
            };
          }
        }
      }
      setSportRatings(ratingsMap);

      // Build sport preferences map
      const prefsMap: Record<string, SportPreferences> = {};
      if (preferencesResult.data) {
        for (const ps of preferencesResult.data) {
          const sportId = ps.sport_id as string;
          if (!sportId) continue;

          // Extract play style from junction table
          // PostgREST returns this as a single object when there's one row, or an array when multiple
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const playStyleData = ps.player_sport_play_style as any;
          let playStyle: SportPreferences['playStyle'] = null;
          if (playStyleData) {
            // Could be a single object { play_style: {...} } or an array [{ play_style: {...} }]
            const junction = Array.isArray(playStyleData) ? playStyleData[0] : playStyleData;
            const raw = junction?.play_style;
            playStyle = raw ? (Array.isArray(raw) ? (raw[0] ?? null) : raw) : null;
          }

          // Extract play attributes from junction table (array)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const playAttrJunctions = ps.player_sport_play_attribute as any[];
          const playAttributes: SportPreferences['playAttributes'] = (playAttrJunctions ?? [])
            .map((pa: { play_attribute: unknown }) => {
              const attr = pa.play_attribute;
              return Array.isArray(attr) ? attr[0] : attr;
            })
            .filter((a: unknown): a is SportPreferences['playAttributes'][number] => !!a);

          prefsMap[sportId] = {
            playerSportId: ps.id,
            isActive: ps.is_active ?? false,
            isPrimary: ps.is_primary ?? false,
            matchDuration: ps.preferred_match_duration ?? null,
            matchType: ps.preferred_match_type ?? null,
            playStyle,
            playAttributes,
          };
        }
      }
      setSportPreferences(prefsMap);

      // Handle primary rating result — primary sport_id derived from the
      // preferences rows (the row flagged is_primary) instead of a separate query.
      const primarySportId = (preferencesResult.data ?? []).find(ps => ps.is_primary)?.sport_id as
        | string
        | undefined;
      if (primarySportId && ratingsMap[primarySportId]) {
        setPrimaryRating(ratingsMap[primarySportId]);
      } else {
        setPrimaryRating(null);
      }
    } catch (err) {
      console.error('Error fetching player:', err);
      setError(err as Error);
      setPlayer(null);
      setPrimaryRating(null);
      setSportRatings({});
      setSportPreferences({});
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Refetch player data
  const refetch = useCallback(async () => {
    await fetchPlayer();
  }, [fetchPlayer]);

  // Fetch when userId changes (including initial mount and sign in/out)
  useEffect(() => {
    fetchPlayer();
  }, [fetchPlayer]);

  // Calculate max travel distance with fallback to default
  const maxTravelDistanceKm = useMemo(
    () => player?.max_travel_distance ?? DEFAULT_MAX_TRAVEL_DISTANCE_KM,
    [player?.max_travel_distance]
  );

  const contextValue: PlayerContextType = {
    player,
    loading,
    error,
    refetch,
    maxTravelDistanceKm,
    primaryRating,
    sportRatings,
    sportPreferences,
    reputationDisplay,
    reputationTotalEvents,
  };

  return <PlayerContext.Provider value={contextValue}>{children}</PlayerContext.Provider>;
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the player context.
 * Returns the current user's player data, loading state, error, and refetch function.
 *
 * @example
 * ```tsx
 * const { player, maxTravelDistanceKm, loading, refetch } = usePlayer();
 *
 * if (loading) return <Spinner />;
 *
 * // After updating player settings, call refetch to update all consumers
 * const handleSaveSettings = async () => {
 *   await updatePlayerSettings(...);
 *   await refetch(); // This updates all components using usePlayer()
 * };
 *
 * return <Text>Max travel: {maxTravelDistanceKm} km</Text>;
 * ```
 */
export const usePlayer = (): PlayerContextType => {
  const context = useContext(PlayerContext);

  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }

  return context;
};

export default PlayerContext;
