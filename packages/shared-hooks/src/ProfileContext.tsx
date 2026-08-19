/**
 * Profile Context - Global profile state management
 *
 * This context provides a single source of truth for the current user's profile.
 * All components using useProfile() will share the same profile state, ensuring
 * that when one component refetches the profile, all consumers are updated.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { supabase } from '@rallia/shared-services';
import type { Profile } from '@rallia/shared-types';

// =============================================================================
// TYPES
// =============================================================================

export interface ProfileContextType {
  /** Current user's profile data */
  profile: Profile | null;

  /** Loading state */
  loading: boolean;

  /** Error state */
  error: Error | null;

  /** Refetch the profile data */
  refetch: () => Promise<void>;

  /** Refetch profile for a specific user ID */
  refetchForUser: (userId: string) => Promise<void>;
}

// =============================================================================
// CONTEXT
// =============================================================================

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface ProfileProviderProps {
  children: ReactNode;
  /** The authenticated user's ID. Pass from your auth context. */
  userId: string | undefined;
}

export const ProfileProvider: React.FC<ProfileProviderProps> = ({ children, userId }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = useCallback(
    async (targetUserId?: string) => {
      const finalUserId = targetUserId || userId;

      // No userId means not authenticated - clear profile
      if (!finalUserId) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch profile from database using provided userId
        // Use maybeSingle() to gracefully handle case where profile doesn't exist yet
        const { data, error: profileError } = await supabase
          .from('profile')
          .select('*')
          .eq('id', finalUserId)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        // data will be null if no profile exists (new user)
        setProfile(data);
      } catch (err) {
        console.error('Error fetching profile:', err);
        setError(err as Error);
        // Keep the last-known-good profile: nulling it here made a transient
        // fetch error indistinguishable from "new user with no profile row",
        // which routed onboarded players back into the signup wizard.
        // `profile === null && error !== null` now means "unknown", while
        // `profile === null && error === null` means "genuinely no row".
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  // Refetch current user's profile
  const refetch = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  // Refetch profile for a specific user
  const refetchForUser = useCallback(
    async (targetUserId: string) => {
      await fetchProfile(targetUserId);
    },
    [fetchProfile]
  );

  // Fetch when userId changes (including initial mount and sign in/out)
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Memoized so provider re-renders (React Compiler bails on this component
  // because of fetchProfile's try/finally) don't hand every consumer a new
  // identity and cascade re-renders through the tree.
  const contextValue: ProfileContextType = useMemo(
    () => ({
      profile,
      loading,
      error,
      refetch,
      refetchForUser,
    }),
    [profile, loading, error, refetch, refetchForUser]
  );

  return <ProfileContext.Provider value={contextValue}>{children}</ProfileContext.Provider>;
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to access the profile context.
 * Returns the current user's profile data, loading state, error, and refetch function.
 *
 * Note: The ProfileProvider must be given the userId from your auth context.
 * For fetching other users' profiles, use refetchForUser.
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
export const useProfile = (): ProfileContextType => {
  const context = useContext(ProfileContext);

  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }

  return context;
};

export default ProfileContext;
