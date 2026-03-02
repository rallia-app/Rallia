/**
 * AuthContext - Centralized authentication state management
 *
 * Following Supabase's recommended pattern for React Native:
 * https://supabase.com/docs/guides/auth/quickstarts/with-expo-react-native-social-auth
 *
 * Features:
 * - Single source of truth for auth state across the app
 * - AppState listener for proper token refresh handling
 * - Session validation to detect deleted users
 * - Session expiry detection with callback
 * - Retry logic with exponential backoff for network resilience
 * - Proper cleanup on unmount
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  PropsWithChildren,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { usePostHog } from 'posthog-react-native';
import { supabase } from '../lib/supabase';
import type { Session, AuthError, Provider, User } from '@supabase/supabase-js';
import { Logger } from '@rallia/shared-services';

/** Supported OAuth providers */
export type OAuthProvider = 'google' | 'apple' | 'facebook' | 'azure';

/** Result type for auth operations */
export type AuthResult = {
  success: boolean;
  error?: AuthError | Error;
  /** User returned from successful auth operations (verifyOtp) */
  user?: User;
};

/** Options for OAuth sign-in */
export type OAuthSignInOptions = {
  redirectTo?: string;
  scopes?: string;
  skipBrowserRedirect?: boolean;
};

/** Options for email OTP sign-in */
export type EmailOtpOptions = {
  emailRedirectTo?: string;
  shouldCreateUser?: boolean;
  /** Data merged into user metadata / available in email template as .Data (e.g. locale for i18n) */
  data?: Record<string, unknown>;
};

// =============================================================================
// RETRY LOGIC WITH EXPONENTIAL BACKOFF
// =============================================================================

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Check if an error is a network/transient error that should be retried
 */
function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  const errorMessage =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  const retryablePatterns = [
    'network request failed',
    'failed to fetch',
    'networkerror',
    'timeout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'aborted',
    'connection refused',
    'no internet',
    'offline',
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Execute an async function with retry logic and exponential backoff
 */
async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt or non-retryable errors
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      Logger.debug(`Auth operation failed, retrying in ${Math.round(delay)}ms`, {
        attempt: attempt + 1,
        maxRetries,
        error: error instanceof Error ? error.message : String(error),
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/** Auth context value type */
export type AuthContextType = {
  // State
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
  user: Session['user'] | null;
  /** Whether the session expired (user was previously logged in) */
  sessionExpired: boolean;
  /** Clear the session expired flag */
  clearSessionExpired: () => void;

  // Auth methods
  signInWithProvider: (
    provider: OAuthProvider,
    options?: OAuthSignInOptions
  ) => Promise<AuthResult>;
  signInWithEmail: (email: string, options?: EmailOtpOptions) => Promise<AuthResult>;
  verifyOtp: (email: string, token: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
};

// Create context with undefined default (will throw if used outside provider)
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider - Wraps the app and provides auth state via context
 *
 * This should be placed near the top of the component tree, after
 * any providers it depends on (like QueryClientProvider).
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const posthog = usePostHog();

  // Track previous session to detect expiry
  const previousSessionRef = useRef<Session | null>(null);

  /**
   * Clear the session expired flag (after user acknowledges or re-authenticates)
   */
  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  useEffect(() => {
    let isSubscribed = true;

    /**
     * Fetch and validate the initial session
     */
    const fetchSession = async () => {
      try {
        const {
          data: { session: initialSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          Logger.error('Error fetching session', error);
        }

        if (initialSession && isSubscribed) {
          // Validate session by checking if user still exists in database
          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();

          if (userError || !user) {
            Logger.warn(
              'Invalid session detected (user deleted from database). Clearing session...'
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
            if (isSubscribed) {
              setSession(initialSession);
              previousSessionRef.current = initialSession;
            }
          }
        } else if (isSubscribed) {
          setSession(null);
        }
      } catch (error) {
        Logger.error('Error initializing session', error as Error);
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

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      Logger.debug('Auth state change', { event });

      // Detect session expiry: user was logged in but session is now null
      // and it wasn't a manual sign out
      if (event === 'SIGNED_OUT' && previousSessionRef.current !== null && newSession === null) {
        // Check if this was due to token expiry (not manual sign out)
        // Manual sign out sets previousSessionRef to null before the event
        Logger.warn('Session expired - user was signed out');
        setSessionExpired(true);
      }

      // Track token refresh
      if (event === 'TOKEN_REFRESHED') {
        Logger.debug('Auth token refreshed successfully');
      }

      setSession(newSession);
      previousSessionRef.current = newSession;
    });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * AppState listener for token refresh handling
   *
   * Supabase Auth automatically refreshes tokens, but in React Native
   * we need to manually start/stop this based on app foreground state.
   * This prevents unnecessary network requests when the app is in background
   * and ensures tokens are refreshed when the app becomes active.
   */
  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        // App came to foreground - start auto refresh
        supabase.auth.startAutoRefresh();
      } else {
        // App went to background - stop auto refresh
        supabase.auth.stopAutoRefresh();
      }
    };

    // Subscribe to app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Start auto refresh initially if app is active
    if (AppState.currentState === 'active') {
      supabase.auth.startAutoRefresh();
    }

    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  /**
   * Sign in with an OAuth provider (Google, Apple, or Facebook)
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
    []
  );

  /**
   * Send an OTP code to the user's email
   * Includes retry logic for network resilience
   */
  const signInWithEmail = useCallback(
    async (email: string, options?: EmailOtpOptions): Promise<AuthResult> => {
      try {
        const { error } = await withRetry(
          () =>
            supabase.auth.signInWithOtp({
              email,
              options: {
                emailRedirectTo: options?.emailRedirectTo,
                shouldCreateUser: options?.shouldCreateUser ?? true,
                data: options?.data,
              },
            }),
          { maxRetries: 2 }
        );

        if (error) {
          Logger.error('Email OTP send error', error);
          return { success: false, error };
        }

        return { success: true };
      } catch (error) {
        Logger.error('Unexpected email OTP send error', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
        };
      }
    },
    []
  );

  /**
   * Verify an OTP code sent to the user's email
   * Returns the authenticated user on success
   * Includes retry logic for network resilience
   */
  const verifyOtp = useCallback(async (email: string, token: string): Promise<AuthResult> => {
    try {
      const { data, error } = await withRetry(
        () =>
          supabase.auth.verifyOtp({
            email,
            token,
            type: 'email',
          }),
        { maxRetries: 2 }
      );

      if (error) {
        return { success: false, error };
      }

      // Return the user from successful verification
      return {
        success: true,
        user: data.user ?? undefined,
      };
    } catch (error) {
      Logger.error('Unexpected OTP verification error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }, []);

  /**
   * Sign out the current user
   */
  const signOut = useCallback(async (): Promise<AuthResult> => {
    try {
      // Clear previous session ref first to prevent expiry detection
      previousSessionRef.current = null;
      // Clear any existing session expired flag
      setSessionExpired(false);

      // Reset PostHog identity so next session starts anonymous
      posthog?.reset();

      const { error } = await supabase.auth.signOut();
      if (error) {
        Logger.error('Error signing out', error);
        return { success: false, error };
      }
      return { success: true };
    } catch (error) {
      Logger.error('Unexpected sign out error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }, [posthog]);

  const value: AuthContextType = {
    // State
    session,
    loading,
    isAuthenticated: !!session,
    user: session?.user ?? null,
    sessionExpired,
    clearSessionExpired,

    // Auth methods
    signInWithProvider,
    signInWithEmail,
    verifyOtp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth hook - Access auth state and methods from any component
 *
 * Must be used within an AuthProvider.
 *
 * @example
 * ```tsx
 * const { session, loading, signOut } = useAuth();
 *
 * if (loading) return <Spinner />;
 * if (!session) return <LoginScreen />;
 * return <HomeScreen user={session.user} />;
 * ```
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
