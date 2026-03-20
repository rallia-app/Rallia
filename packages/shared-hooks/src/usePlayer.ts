/**
 * usePlayer Hook
 * Custom hook for fetching and managing the current user's player data.
 * Uses PlayerContext to provide a single source of truth for player state.
 *
 * Note: The PlayerProvider must be given the userId from your auth context.
 *
 * @example
 * ```tsx
 * const { player, primaryRating, maxTravelDistanceKm, loading, refetch } = usePlayer();
 *
 * if (loading) return <Spinner />;
 *
 * return <Text>Max travel: {maxTravelDistanceKm} km</Text>;
 * ```
 */

// Re-export from PlayerContext for backward compatibility
export { usePlayer, PlayerProvider } from './PlayerContext';
export type { PlayerContextType, PrimaryRating, SportPreferences } from './PlayerContext';
