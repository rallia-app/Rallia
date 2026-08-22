/**
 * Profile Completeness Context
 *
 * Provides a single source of truth for profile completeness data.
 * Fetches async data (availability, proofs, favorites) once on mount,
 * then recomputes when profile/player/sport contexts change.
 * Consumers call useProfileCompleteness() with no args.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { supabase } from '@rallia/shared-services';
import type { Profile, Player } from '@rallia/shared-types';
import type { PrimaryRating, SportPreferences } from './PlayerContext';
import { useOnboardingGaps } from './useOnboardingGaps';
import { usePlayerSports } from './usePlayerSports';
import { buildOnboardingGapItems, type GapSportInfo } from './onboardingGapItems';

// =============================================================================
// TYPES
// =============================================================================

export type BaseCompletenessItemKey =
  | 'profile_picture'
  | 'home_address'
  | 'skill_rating'
  | 'rating_proof'
  | 'favorite_courts'
  | 'availability'
  | 'bio'
  | 'phone'
  | 'display_name'
  | 'play_style';

/** Onboarding-minimum gap rows (see onboardingGapItems.ts). */
export type OnboardingGapItemKey =
  | 'onboarding_sport'
  | `onboarding_rating:${string}`
  | `onboarding_favorites:${string}`
  | 'onboarding_postal_code';

export type CompletenessItemKey = BaseCompletenessItemKey | OnboardingGapItemKey;

export type CompletenessTier =
  | 'getting_started'
  | 'growing'
  | 'strong'
  | 'almost_there'
  | 'complete';

export type CompletenessActionType = 'image_picker' | 'sheet' | 'navigate' | 'sport_setup';

export interface CompletenessItem {
  key: CompletenessItemKey;
  labelKey: string;
  /** Interpolation values for labelKey (e.g. sport name). */
  labelParams?: Record<string, string | number>;
  weight: number;
  completed: boolean;
  applicable: boolean;
  actionType: CompletenessActionType;
  actionSheet?: string;
  actionNavigate?: string;
  actionPayload?: Record<string, unknown>;
}

export interface ProfileCompletenessResult {
  percentage: number;
  tier: CompletenessTier;
  items: CompletenessItem[];
  applicableItems: CompletenessItem[];
  nextAction: CompletenessItem | null;
  isComplete: boolean;
  loading: boolean;
  /** True while get_onboarding_gaps() reports a missing invariant piece. */
  hasOnboardingGaps: boolean;
  /** Refetch async data (availability, proofs, favorites) and the onboarding gaps */
  refetch: () => Promise<void>;
  /** Cheap: only re-asks get_onboarding_gaps() */
  refetchOnboardingGaps: () => Promise<unknown>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const BASE_WEIGHTS: Record<BaseCompletenessItemKey, number> = {
  profile_picture: 15,
  home_address: 15,
  skill_rating: 10,
  rating_proof: 10,
  favorite_courts: 10,
  availability: 10,
  bio: 10,
  phone: 10,
  display_name: 5,
  play_style: 5,
};

// Hourly schema: each "slot" is one cell from the 7×17 weekly grid (one
// hour). The legacy 3-block floor translated to ≈3–9 hours; 6 hours is a
// loose-but-meaningful floor under the new model. Matches the onboarding
// MIN_SELECTIONS used in the availability picker.
const MIN_AVAILABILITY_SLOTS = 6;
const MIN_FAVORITE_FACILITIES_PER_SPORT = 2;

// =============================================================================
// HELPERS
// =============================================================================

function getTier(percentage: number): CompletenessTier {
  if (percentage >= 100) return 'complete';
  if (percentage >= 90) return 'almost_there';
  if (percentage >= 70) return 'strong';
  if (percentage >= 40) return 'growing';
  return 'getting_started';
}

// =============================================================================
// CONTEXT
// =============================================================================

const ProfileCompletenessContext = createContext<ProfileCompletenessResult | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface ProfileCompletenessProviderProps {
  children: ReactNode;
  profile: Profile | null;
  player: Player | null;
  sportRatings: Record<string, PrimaryRating>;
  sportPreferences: Record<string, SportPreferences>;
  /** Currently selected sport ID */
  selectedSportId: string | null;
  /** Currently selected sport name */
  selectedSportName: string | null;
}

export const ProfileCompletenessProvider: React.FC<ProfileCompletenessProviderProps> = ({
  children,
  profile,
  player,
  sportRatings,
  sportPreferences,
  selectedSportId,
  selectedSportName,
}) => {
  const [availabilityCount, setAvailabilityCount] = useState<number | null>(null);
  const [proofCount, setProofCount] = useState<number | null>(null);
  const [favoritesCount, setFavoritesCount] = useState<number | null>(null);

  const playerId = player?.id ?? null;

  // Repair path for players already marked onboarded with invariant pieces missing
  const onboardingGaps = useOnboardingGaps({
    playerId: profile?.id ?? null,
    onboardingCompleted: profile?.onboarding_completed ?? false,
  });
  const { playerSports } = usePlayerSports(playerId ?? undefined);
  const gapSportsById = useMemo(() => {
    const map: Record<string, GapSportInfo> = {};
    for (const ps of playerSports ?? []) {
      const sport = Array.isArray(ps.sport) ? ps.sport[0] : ps.sport;
      if (sport) map[ps.sport_id] = sport;
    }
    return map;
  }, [playerSports]);

  // Selected sport's rating (for navigation payloads)
  const selectedRating = selectedSportId ? sportRatings[selectedSportId] : null;
  const selectedPrsId = selectedRating?.playerRatingScoreId ?? null;

  const fetchAsyncData = useCallback(async () => {
    if (!playerId) {
      // Cold start: keep counts as null so `loading` stays true until the real
      // player/profile load and counts are fetched. Seeding with 0 here would
      // briefly compute isComplete=false against placeholder data, causing the
      // banner/ring to flash on screen and then disappear once the real counts
      // come in.
      return;
    }

    try {
      // 1. Availability count (not sport-specific)
      const availabilityQuery = supabase
        .from('player_availability')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', playerId)
        .eq('is_active', true);

      // 2. Proof count for the selected sport — any proof uploaded for any rating
      //    in this sport counts, regardless of rating level or approval status.
      //    Chain: rating_proof → player_rating_score → rating_score → rating_system.sport_id
      //    Use explicit FK hints (:rating_score_id, :rating_system_id) to avoid
      //    ambiguous relation errors that cause the query to silently return null.
      let proofPromise: Promise<number>;
      if (selectedSportId) {
        proofPromise = (async () => {
          // Get all player_rating_score IDs for this player in this sport
          const prsResult = await supabase
            .from('player_rating_score')
            .select(
              'id, rating_score:rating_score_id!inner(rating_system:rating_system_id!inner(sport_id))'
            )
            .eq('player_id', playerId)
            .eq('rating_score.rating_system.sport_id', selectedSportId);

          if (prsResult.error || !prsResult.data || prsResult.data.length === 0) return 0;

          const prsIds = prsResult.data.map((r: { id: string }) => r.id);

          const proofResult = await supabase
            .from('rating_proof')
            .select('id', { count: 'exact', head: true })
            .in('player_rating_score_id', prsIds)
            .eq('is_active', true);

          return proofResult.count ?? 0;
        })();
      } else {
        proofPromise = Promise.resolve(0);
      }

      // 3. Favorite facilities count for the selected sport
      const favoritesQuery = selectedSportId
        ? supabase
            .from('player_favorite_facility')
            .select('id', { count: 'exact', head: true })
            .eq('player_id', playerId)
            .eq('sport_id', selectedSportId)
        : null;

      const [availabilityResult, proofCountResult, favoritesResult] = await Promise.all([
        availabilityQuery,
        proofPromise,
        favoritesQuery,
      ]);

      setAvailabilityCount(availabilityResult.count ?? 0);
      setProofCount(proofCountResult);
      setFavoritesCount(favoritesResult?.count ?? 0);
    } catch {
      setAvailabilityCount(0);
      setProofCount(0);
      setFavoritesCount(0);
    }
  }, [playerId, selectedSportId]);

  // When selectedSportId changes, refetch in the background but keep the
  // previous counts visible until the new ones arrive. Resetting to null
  // would briefly flip `loading` back to true and cause consumers (e.g. the
  // Home ProfileCompletionBanner) to flicker out and back in. The slightly
  // stale percentage during the ~100ms refetch window is far less jarring
  // than a disappearing banner.
  useEffect(() => {
    fetchAsyncData();
  }, [fetchAsyncData]);

  const refetchGaps = onboardingGaps.refetch;
  const refetchAll = useCallback(async () => {
    await Promise.all([fetchAsyncData(), refetchGaps()]);
  }, [fetchAsyncData, refetchGaps]);

  const gaps = onboardingGaps.gaps;
  const gapsLoading = onboardingGaps.isLoading;
  const hasGaps = onboardingGaps.hasGaps;

  const value = useMemo((): ProfileCompletenessResult => {
    if (!profile || !player) {
      return {
        percentage: 0,
        tier: 'getting_started',
        items: [],
        applicableItems: [],
        nextAction: null,
        isComplete: false,
        loading: true,
        hasOnboardingGaps: false,
        refetch: refetchAll,
        refetchOnboardingGaps: refetchGaps,
      };
    }

    // Async data not yet loaded — return loading state
    if (
      availabilityCount === null ||
      proofCount === null ||
      favoritesCount === null ||
      gapsLoading
    ) {
      return {
        percentage: 0,
        tier: 'getting_started',
        items: [],
        applicableItems: [],
        nextAction: null,
        isComplete: false,
        loading: true,
        hasOnboardingGaps: false,
        refetch: refetchAll,
        refetchOnboardingGaps: refetchGaps,
      };
    }

    // Gap rows replace the base row that covers the same fix for the selected sport
    const gapItems = buildOnboardingGapItems(gaps, gapSportsById);
    const selectedSportUnrated =
      !!selectedSportId && gaps.unratedSportIds.includes(selectedSportId);
    const selectedSportUnderFavorited =
      !!selectedSportId && gaps.underFavoritedSportIds.includes(selectedSportId);

    // Sport-specific checks for the selected sport
    const hasSport = !!selectedSportId;
    const hasRating = hasSport && sportRatings[selectedSportId]?.value != null;
    const sportNameLower = (selectedSportName ?? 'tennis').toLowerCase();
    const ratingSheetName = sportNameLower === 'pickleball' ? 'pickleball-rating' : 'tennis-rating';
    const playStyleSheetName =
      sportNameLower === 'pickleball' ? 'pickleball-preferences' : 'tennis-preferences';

    const selectedPrefs = selectedSportId ? sportPreferences[selectedSportId] : null;
    const hasPlayStyle = !!(selectedPrefs?.isActive && selectedPrefs.playStyle);

    const allItems: CompletenessItem[] = [
      {
        key: 'profile_picture',
        labelKey: 'profileCompletion.items.profilePicture',
        weight: BASE_WEIGHTS.profile_picture,
        completed: !!profile.profile_picture_url,
        applicable: true,
        actionType: 'image_picker',
      },
      {
        key: 'home_address',
        labelKey: 'profileCompletion.items.homeAddress',
        weight: BASE_WEIGHTS.home_address,
        completed:
          !!player.address &&
          !!player.city &&
          !!player.province &&
          !!player.postal_code &&
          player.latitude != null,
        applicable: !gaps.postalCode,
        actionType: 'sheet',
        actionSheet: 'player-location',
      },
      {
        key: 'skill_rating',
        labelKey: 'profileCompletion.items.skillRating',
        weight: BASE_WEIGHTS.skill_rating,
        completed: hasRating,
        applicable: hasSport && !selectedSportUnrated,
        actionType: 'navigate',
        actionNavigate: 'SportProfile',
        actionPayload: selectedSportId
          ? { sportId: selectedSportId, sportName: selectedSportName ?? '' }
          : undefined,
      },
      {
        key: 'rating_proof',
        labelKey: 'profileCompletion.items.ratingProof',
        weight: BASE_WEIGHTS.rating_proof,
        completed: hasRating && proofCount >= 1,
        applicable: hasRating,
        actionType: 'navigate',
        actionNavigate: 'RatingProofs',
        actionPayload: selectedPrsId
          ? {
              playerRatingScoreId: selectedPrsId,
              sportName: selectedSportName ?? '',
              ratingValue: selectedRating?.value ?? 0,
              isOwnProfile: true,
              openSheet: 'add',
            }
          : undefined,
      },
      {
        key: 'favorite_courts',
        labelKey: 'profileCompletion.items.favoriteCourts',
        weight: BASE_WEIGHTS.favorite_courts,
        completed: favoritesCount >= MIN_FAVORITE_FACILITIES_PER_SPORT,
        applicable: hasSport && !selectedSportUnderFavorited,
        actionType: 'navigate',
        actionNavigate: 'SportProfile',
        actionPayload: selectedSportId
          ? {
              sportId: selectedSportId,
              sportName: selectedSportName ?? '',
              openSheet: 'favorite-facilities',
            }
          : undefined,
      },
      {
        key: 'availability',
        labelKey: 'profileCompletion.items.availability',
        weight: BASE_WEIGHTS.availability,
        completed: availabilityCount >= MIN_AVAILABILITY_SLOTS,
        applicable: true,
        actionType: 'sheet',
        actionSheet: 'player-availabilities',
      },
      {
        key: 'bio',
        labelKey: 'profileCompletion.items.bio',
        weight: BASE_WEIGHTS.bio,
        completed: !!profile.bio && profile.bio.length > 0,
        applicable: true,
        actionType: 'sheet',
        actionSheet: 'player-information',
      },
      {
        key: 'phone',
        labelKey: 'profileCompletion.items.phone',
        weight: BASE_WEIGHTS.phone,
        completed: !!profile.phone,
        applicable: true,
        actionType: 'sheet',
        actionSheet: 'personal-information',
      },
      {
        key: 'display_name',
        labelKey: 'profileCompletion.items.displayName',
        weight: BASE_WEIGHTS.display_name,
        completed: !!profile.display_name,
        applicable: true,
        actionType: 'sheet',
        actionSheet: 'personal-information',
      },
      {
        key: 'play_style',
        labelKey: 'profileCompletion.items.playStyle',
        weight: BASE_WEIGHTS.play_style,
        completed: hasPlayStyle,
        applicable: hasSport,
        actionType: 'navigate',
        actionNavigate: 'SportProfile',
        actionPayload: selectedSportId
          ? {
              sportId: selectedSportId,
              sportName: selectedSportName ?? '',
              openSheet: 'preferences',
            }
          : undefined,
      },
    ];

    const items = [...gapItems, ...allItems];
    const applicableItems = items.filter(item => item.applicable);
    const totalApplicableWeight = applicableItems.reduce((sum, item) => sum + item.weight, 0);
    const weightMultiplier = totalApplicableWeight > 0 ? 100 / totalApplicableWeight : 1;

    const earnedWeight = applicableItems
      .filter(item => item.completed)
      .reduce((sum, item) => sum + item.weight, 0);
    const percentage = Math.round(earnedWeight * weightMultiplier);

    // Gaps come first in spec order; the rest falls back to heaviest-first
    const nextAction =
      gapItems[0] ??
      applicableItems.filter(item => !item.completed).sort((a, b) => b.weight - a.weight)[0] ??
      null;

    return {
      percentage,
      tier: getTier(percentage),
      items,
      applicableItems,
      nextAction,
      isComplete: percentage >= 100 && gapItems.length === 0,
      loading: false,
      hasOnboardingGaps: hasGaps,
      refetch: refetchAll,
      refetchOnboardingGaps: refetchGaps,
    };
  }, [
    profile,
    player,
    sportRatings,
    sportPreferences,
    selectedSportId,
    selectedSportName,
    availabilityCount,
    proofCount,
    favoritesCount,
    gaps,
    gapsLoading,
    hasGaps,
    gapSportsById,
    refetchAll,
    refetchGaps,
  ]);

  return React.createElement(ProfileCompletenessContext.Provider, { value }, children);
};

// =============================================================================
// CONSUMER HOOK
// =============================================================================

export function useProfileCompleteness(): ProfileCompletenessResult {
  const context = useContext(ProfileCompletenessContext);
  if (!context) {
    throw new Error('useProfileCompleteness must be used within a ProfileCompletenessProvider');
  }
  return context;
}
