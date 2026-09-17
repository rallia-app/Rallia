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
import { supabase, getUsableSession } from '@rallia/shared-services';
import type { Profile } from '@rallia/shared-types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Where the current user's profile stands, as ONE answer instead of three
 * fields to cross-read:
 * - guest: no signed-in user
 * - loading: a fetch for this user has not settled yet
 * - unavailable: the fetch failed (network, dead session) and there is no
 *   last-known-good profile to fall back on. Onboarding status is UNKNOWN;
 *   callers must not treat this as "new user".
 * - missing: the fetch settled cleanly with no row, i.e. a brand-new user
 * - ready: a profile is loaded (kept across later fetch errors)
 */
export type ProfileStatus = 'guest' | 'loading' | 'unavailable' | 'missing' | 'ready';

export interface ProfileContextType {
  /** Current user's profile data */
  profile: Profile | null;

  /** Resolution state of the current user's profile */
  status: ProfileStatus;

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
  // The user whose fetch last settled, so a freshly signed-in user reads as
  // 'loading' until their own fetch answers, never as 'missing'.
  const [settledUserId, setSettledUserId] = useState<string | undefined>(undefined);

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

        // supabase-js silently sends the anon key when the session cannot be
        // refreshed; under RLS that reads as "no row", which would classify
        // a veteran as a brand-new user. Surface it as an error instead.
        const session = await getUsableSession();
        if (!session) {
          throw new Error('No usable session for profile fetch');
        }

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
        if (finalUserId === userId) setSettledUserId(userId);
        setLoading(false);
      }
    },
    [userId]
  );

  const status = useMemo<ProfileStatus>(() => {
    if (!userId) return 'guest';
    if (profile && profile.id === userId) return 'ready';
    if (loading || settledUserId !== userId) return 'loading';
    if (error) return 'unavailable';
    return 'missing';
  }, [userId, profile, loading, settledUserId, error]);

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
      status,
      loading,
      error,
      refetch,
      refetchForUser,
    }),
    [profile, status, loading, error, refetch, refetchForUser]
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
