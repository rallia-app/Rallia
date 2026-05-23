/**
 * JustForYouPrefetch
 *
 * No-render component that warms the React Query cache for the Home screen's
 * "Just for you" carousel as soon as the inputs it needs are available. Sits
 * inside AuthenticatedProviders (so Player/Sport/UserLocation context is in
 * scope) but mounts before Home — overlapping the heavy `get_just_for_you`
 * RPC with the splash animation rather than serializing them.
 *
 * Pairs with the AsyncStorage persister: returning users get cached cards
 * instantly on splash fade; fresh installs / busted caches get the prefetch
 * racing the splash, which dramatically shortens skeleton time.
 *
 * Inputs must match Home.tsx's `useJustForYou` call exactly — same
 * playerId / sportId / rounded lat-lng / maxDistanceKm / scoring prefs —
 * otherwise the prefetched entry sits under a different key than the one
 * Home reads, and the win is wasted. The shared `justForYouQueryOptions`
 * factory in `@rallia/shared-hooks` owns that contract.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  justForYouQueryOptions,
  usePlayer,
  usePlayerSports,
  useRatingScoresForSport,
  useFavoriteFacilities,
  type MatchScoringPreferences,
} from '@rallia/shared-hooks';
import { useAuth } from '../context';
import { useSport } from '../context';
import { useEffectiveLocation } from '../hooks';

const MATCH_LIMIT = 5;

export function JustForYouPrefetch() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { player, maxTravelDistanceKm } = usePlayer();
  const { selectedSport } = useSport();
  const { location } = useEffectiveLocation();
  const { playerSports } = usePlayerSports(session?.user?.id);
  const { ratingScores, playerRatingScoreId } = useRatingScoresForSport(
    selectedSport?.name,
    selectedSport?.id,
    session?.user?.id
  );
  const { favorites } = useFavoriteFacilities(session?.user?.id ?? null, selectedSport?.id);

  const playerRatingValue = useMemo(() => {
    if (!playerRatingScoreId) return null;
    return ratingScores.find(rs => rs.id === playerRatingScoreId)?.value ?? null;
  }, [ratingScores, playerRatingScoreId]);

  const currentPlayerSport = useMemo(
    () => playerSports.find(ps => ps.sport_id === selectedSport?.id),
    [playerSports, selectedSport?.id]
  );

  const favoriteFacilityIds = useMemo(() => favorites.map(f => f.facilityId), [favorites]);

  const scoringPreferences = useMemo<MatchScoringPreferences>(
    () => ({
      playerGender: player?.gender,
      playerRatingValue,
      preferredMatchDuration: currentPlayerSport?.preferred_match_duration,
      preferredMatchType: currentPlayerSport?.preferred_match_type,
      favoriteFacilityIds,
      maxTravelDistanceKm,
    }),
    [
      player?.gender,
      playerRatingValue,
      currentPlayerSport?.preferred_match_duration,
      currentPlayerSport?.preferred_match_type,
      favoriteFacilityIds,
      maxTravelDistanceKm,
    ]
  );

  const excludeUserIds = useMemo(
    () => (session?.user?.id ? [session.user.id] : []),
    [session?.user?.id]
  );

  // Fire prefetch exactly once per cold start, when all inputs are ready.
  // Ref-guarded so re-renders (sport switch, location update) don't trigger
  // a fresh prefetch — Home's normal hook owns lifecycle from that point.
  const hasPrefetchedRef = useRef(false);
  useEffect(() => {
    if (hasPrefetchedRef.current) return;
    if (!session?.user?.id) return; // Anon path uses composer; skip prefetch — less win, more risk of key drift.
    if (!selectedSport?.id || !location || maxTravelDistanceKm === undefined) return;

    const options = justForYouQueryOptions({
      playerId: player?.id ?? session.user.id,
      sportId: selectedSport.id,
      sportName: selectedSport.name,
      latitude: location.latitude,
      longitude: location.longitude,
      maxDistanceKm: maxTravelDistanceKm,
      userGender: player?.gender,
      scoringPreferences,
      excludeUserIds,
      matchLimit: MATCH_LIMIT,
    });

    hasPrefetchedRef.current = true;
    queryClient
      .prefetchQuery({
        queryKey: options.queryKey,
        queryFn: options.queryFn,
        staleTime: options.staleTime,
      })
      .catch(() => {
        // Fire-and-forget — if the prefetch fails Home's hook will retry
        // when it mounts and surface the error to the user there.
      });
  }, [
    queryClient,
    session?.user?.id,
    player?.id,
    player?.gender,
    selectedSport?.id,
    selectedSport?.name,
    location,
    maxTravelDistanceKm,
    scoringPreferences,
    excludeUserIds,
  ]);

  return null;
}
