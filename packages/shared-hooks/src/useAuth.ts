import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase as sharedSupabase } from '@rallia/shared-services';
import type { Session, AuthError, Provider, SupabaseClient } from '@supabase/supabase-js';
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';

/**
 * True only for errors that definitively mean the session is dead (user
 * deleted, JWT rejected). Network failures, 5xx and 429 arrive as
 * AuthRetryableFetchError and must never destroy a valid session.
 */
function isDefinitiveAuthError(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && [401, 403, 404].includes(error.status);
}

/** Supported OAuth providers */
export type OAuthProvider = 'google' | 'apple' | 'facebook' | 'azure';

/** Result type for auth operations */
export type AuthResult = {
  success: boolean;
  error?: AuthError | Error;
};

/** Options for OAuth sign-in */
export type OAuthSignInOptions = {
  /** The redirect URL after OAuth authentication (platform-specific) */
  redirectTo?: string;
  /** Additional scopes to request from the provider */
  scopes?: string;
  /** Skip the browser redirect (useful for mobile with native auth) */
  skipBrowserRedirect?: boolean;
};

/** Options for email OTP sign-in */
export type EmailOtpOptions = {
  /** The redirect URL for magic link emails (platform-specific) */
  emailRedirectTo?: string;
  /** Whether to create a new user if one doesn't exist */
  shouldCreateUser?: boolean;
  /** Data merged into user metadata / available in email template as .Data (e.g. locale for i18n) */
  data?: Record<string, unknown>;
};

/** Options for the useAuth hook */
export type UseAuthOptions = {
  /**
   * Custom Supabase client to use instead of the shared service client.
   * Use this in Next.js apps to pass the SSR-aware browser client for proper cookie handling.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: SupabaseClient<any, any, any>;
};

/**
 * Custom hook for managing authentication state
 * Handles session management, auth state changes, and sign-in flows
 * Compatible with both Next.js (web) and Expo (mobile)
 *
 * @param options - Optional configuration including custom Supabase client
 */
export const useAuth = (options?: UseAuthOptions) => {
  // Use custom client if provided, otherwise fall back to shared service client
  const supabase = useMemo(() => options?.client ?? sharedSupabase, [options?.client]);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isSubscribed = true;

    /**
     * Fetch and validate the initial session
     * Following Supabase's recommended pattern from the docs:
     * https://supabase.com/docs/guides/auth/quickstarts/with-expo-react-native-social-auth
     */
    const fetchSession = async () => {
      try {
        const {
          data: { session: initialSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error('Error fetching session:', error);
        }

        if (initialSession && isSubscribed) {
          // Validate the session by checking the user still exists server-side.
          // Only a DEFINITIVE rejection may clear it: getUser() also returns
          // errors for plain network failures, and treating those as "user
          // deleted" silently destroyed valid sessions on flaky cold starts.
          let sessionIsDead = false;
          try {
            const {
              data: { user },
              error: userError,
            } = await supabase.auth.getUser();
            if (userError && isDefinitiveAuthError(userError)) {
              sessionIsDead = true;
            } else if (userError || !user) {
              console.warn('Could not validate session (transient error), keeping it');
            }
          } catch {
            console.warn('Session validation threw, keeping session');
          }

          if (sessionIsDead) {
            // Session exists but user was deleted - clear the invalid session
            console.warn(
              '⚠️ Invalid session detected (user deleted from database). Clearing session...'
            );
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore signOut errors
            }
            if (isSubscribed) {
              setSession(null);
            }
          } else {
            // Valid session (or unverifiable: keep it, auth refresh will settle it)
            if (isSubscribed) {
              setSession(initialSession);
            }
          }
        } else if (isSubscribed) {
          setSession(null);
        }
      } catch (error) {
        console.error('Error initializing session:', error);
        if (isSubscribed) {
          setSession(null);
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    };

    // Fetch initial session
    fetchSession();

    // Subscribe to auth state changes for subsequent updates
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Update session on any auth state change
      // The subscription handles sign-in, sign-out, token refresh, etc.
      setSession(newSession);
    });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  /**
   * Sign in with an OAuth provider (Google, Apple, or Facebook)
   * @param provider - The OAuth provider to use
   * @param options - Configuration options for the OAuth flow
   * @returns Promise resolving to success status and optional error
   */
  const signInWithProvider = useCallback(
    async (provider: OAuthProvider, options?: OAuthSignInOptions): Promise<AuthResult> => {
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: provider as Provider,
          options: {
            redirectTo: options?.redirectTo,
            scopes: options?.scopes,
            skipBrowserRedirect: options?.skipBrowserRedirect,
          },
        });

        if (error) {
          console.error(`OAuth sign-in error (${provider}):`, error);
          return { success: false, error };
        }

        return { success: true };
      } catch (error) {
        console.error(`Unexpected OAuth sign-in error (${provider}):`, error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
        };
      }
    },
    [supabase]
  );

  /**
   * Send an OTP code to the user's email
   * @param email - The user's email address
   * @param options - Configuration options for the OTP email
   * @returns Promise resolving to success status and optional error
   */
  const signInWithEmail = useCallback(
    async (email: string, options?: EmailOtpOptions): Promise<AuthResult> => {
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: options?.emailRedirectTo,
            shouldCreateUser: options?.shouldCreateUser ?? true,
            data: options?.data,
          },
        });

        if (error) {
          console.error('Email OTP send error:', error);
          return { success: false, error };
        }

        return { success: true };
      } catch (error) {
        console.error('Unexpected email OTP send error:', error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
        };
      }
    },
    [supabase]
  );

  /**
   * Verify an OTP code sent to the user's email
   * @param email - The user's email address
   * @param token - The 6-digit OTP code
   * @returns Promise resolving to success status and optional error
   */
  const verifyOtp = useCallback(
    async (email: string, token: string): Promise<AuthResult> => {
      try {
        const { error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: 'email',
        });

        if (error) {
          console.error('OTP verification error:', error);
          return { success: false, error };
        }

        return { success: true };
      } catch (error) {
        console.error('Unexpected OTP verification error:', error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
        };
      }
    },
    [supabase]
  );

  /**
   * Sign out the current user
   * @returns Promise resolving to success status and optional error
   */
  const signOut = useCallback(async (): Promise<AuthResult> => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        return { success: false, error };
      }
      return { success: true };
    } catch (error) {
      console.error('Unexpected sign out error:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }, [supabase]);

  return {
    // State
    session,
    loading,
    isAuthenticated: !!session,
    user: session?.user ?? null,

    // Auth methods
    signInWithProvider,
    signInWithEmail,
    verifyOtp,
    signOut,
  };
};
