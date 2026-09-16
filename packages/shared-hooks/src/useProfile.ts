/**
 * Custom hook for fetching and managing user profile data
 * Uses ProfileContext to provide a single source of truth for profile state
 *
 * Note: The ProfileProvider must be given the userId from your auth context.
 * For other users' profiles, use refetchForUser.
 *
 * @returns Object containing profile data, loading state, error, and refetch function
 *
 * @example
 * ```tsx
 * const { profile, loading, error, refetch } = useProfile();
 *
 * if (loading) return <Spinner />;
 * if (error) return <ErrorMessage message={error.message} />;
 *
 * return <Text>{profile?.first_name} {profile?.last_name}</Text>;
 * ```
 */

// Re-export from ProfileContext for backward compatibility
export { useProfile, ProfileProvider } from './ProfileContext';
export type { ProfileContextType, ProfileStatus } from './ProfileContext';
