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
  useMemo,
  useRef,
  PropsWithChildren,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import type { Session, AuthError, Provider, User } from '@supabase/supabase-js';
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { Logger, unregisterPushToken } from '@rallia/shared-services';

import { supabase } from '#/lib/supabase';
import { posthogClient } from '#/providers/PostHogProvider';
import { clearMetaUser } from '#/lib/meta';
import * as Analytics from '#/services/analytics';

// =============================================================================
// DEMO ACCOUNT FOR APP STORE REVIEW
// =============================================================================
const DEMO_ACCOUNT_EMAIL = 'demo@rallia.ca';
const DEMO_ACCOUNT_OTP = '000000';
const DEMO_ACCOUNT_PASSWORD = process.env.EXPO_PUBLIC_DEMO_ACCOUNT_PASSWORD;

function isDemoAccount(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
}

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

/**
 * True only for errors that definitively mean the session is dead (user
 * deleted, JWT rejected). Network failures, 5xx and 429 arrive as
 * AuthRetryableFetchError and must never destroy a valid session.
 */
function isDefinitiveAuthError(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && [401, 403, 404].includes(error.status);
}

// =============================================================================
// SESSION-END INSTRUMENTATION
// =============================================================================

// Last signed-in user marker. Present at a cold start with no session =
// the session vanished from storage without any code path ending it.
const LAST_KNOWN_USER_KEY = '@rallia/last-known-user-id';

let lastMarkedUserId: string | null = null;

/** Persist the last-known user (deduped) so vanished sessions are detectable. */
function markSessionAlive(userId: string): void {
  if (lastMarkedUserId === userId) return;
  lastMarkedUserId = userId;
  AsyncStorage.setItem(
    LAST_KNOWN_USER_KEY,
    JSON.stringify({ userId, at: new Date().toISOString() })
  ).catch(() => {});
}

/**
 * Record WHY a session ended (Sentry breadcrumb via Logger + PostHog event)
 * and clear the marker so the end is only reported once.
 */
function recordSessionEnd(
  reason: Analytics.SessionEndReason,
  details?: { trigger?: string; error_name?: string; error_status?: number; last_seen_at?: string }
): void {
  Logger.warn('Session ended', { reason, ...details });
  Analytics.sessionEnded({ reason, ...details });
  lastMarkedUserId = null;
  AsyncStorage.removeItem(LAST_KNOWN_USER_KEY).catch(() => {});
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
  /** Whether the account was suspended by an admin */
  accountSuspended: boolean;
  /** Clear the account suspended flag */
  clearAccountSuspended: () => void;

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
  const [accountSuspended, setAccountSuspended] = useState(false);

  const queryClient = useQueryClient();

  // Track previous session to detect expiry
  const previousSessionRef = useRef<Session | null>(null);

  /**
   * Clear the session expired flag (after user acknowledges or re-authenticates)
   */
  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  /**
   * Clear the account suspended flag (after user acknowledges)
   */
  const clearAccountSuspended = useCallback(() => {
    setAccountSuspended(false);
  }, []);

  /**
   * Check if the user's account is suspended and sign them out if so.
   * Returns true if account is suspended (caller should abort further processing).
   */
  const checkAccountSuspended = useCallback(async (userId: string): Promise<boolean> => {
    try {
      const { data: profile } = await supabase
        .from('profile')
        .select('account_status')
        .eq('id', userId)
        .single();

      if (profile?.account_status === 'suspended') {
        recordSessionEnd('account_suspended', { trigger: 'suspend_check' });
        previousSessionRef.current = null; // Prevent sessionExpired from triggering
        setAccountSuspended(true);
        await unregisterPushToken(userId).catch(error => {
          Logger.error('Failed to clear push token on suspended sign-out', error as Error);
        });
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore sign-out errors
        }
        setSession(null);
        return true;
      }
    } catch (error) {
      Logger.error('Error checking account status', error as Error);
    }
    return false;
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
          // Validate the session by checking the user still exists server-side.
          // Only a DEFINITIVE rejection may clear it: getUser() also returns
          // errors for plain network failures, and treating those as "user
          // deleted" silently destroyed valid sessions on flaky cold starts.
          // On transient errors we keep the session; a truly dead one surfaces
          // as SIGNED_OUT (with the expiry toast) on the next token refresh.
          let sessionIsDead = false;
          let deadError: AuthError | null = null;
          try {
            const {
              data: { user },
              error: userError,
            } = await supabase.auth.getUser();

            if (userError && isDefinitiveAuthError(userError)) {
              sessionIsDead = true;
              deadError = userError;
            } else if (userError || !user) {
              Logger.warn('Could not validate session (transient error), keeping it', {
                error: userError?.message,
              });
            }
          } catch (validationError) {
            Logger.warn('Session validation threw, keeping session', {
              error:
                validationError instanceof Error
                  ? validationError.message
                  : String(validationError),
            });
          }

          if (sessionIsDead) {
            recordSessionEnd('invalid_session', {
              trigger: 'cold_start',
              error_name: deadError?.name,
              error_status: deadError?.status,
            });
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore signOut errors
            }
            if (isSubscribed) {
              setSession(null);
            }
          } else if (isSubscribed) {
            // Set the session immediately so the app starts loading; run the
            // suspended-account check in the background (it signs the user out
            // and clears the session if suspended). Awaiting it here serialized
            // ~6s into the cold-start request burst.
            markSessionAlive(initialSession.user.id);
            setSession(initialSession);
            previousSessionRef.current = initialSession;
            void checkAccountSuspended(initialSession.user.id);
          }
        } else if (isSubscribed) {
          // No session in storage. A marker left by a previous launch means it
          // vanished without any code path recording an end: the storage-loss
          // mechanism this instrumentation exists to catch.
          try {
            const marker = await AsyncStorage.getItem(LAST_KNOWN_USER_KEY);
            if (marker) {
              const parsed = JSON.parse(marker) as { userId?: string; at?: string };
              recordSessionEnd('session_missing_at_launch', {
                trigger: 'cold_start',
                error_name: error?.name,
                last_seen_at: parsed.at,
              });
            }
          } catch {
            // Marker read is best-effort
          }
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
        recordSessionEnd('unexpected_signed_out', { trigger: 'auth_listener' });
        setSessionExpired(true);
      }

      // Track token refresh
      if (event === 'TOKEN_REFRESHED') {
        Logger.debug('Auth token refreshed successfully');
      }

      // Check account status on sign-in and token refresh
      // For OAuth sign-in, this is the only interception point
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession?.user?.id) {
        // Set the session immediately, then verify suspension in the background
        // (checkAccountSuspended signs out + clears the session if suspended,
        // and nulls previousSessionRef first so it won't trip sessionExpired).
        // Avoids gating the whole post-sign-in load on the suspend-check call.
        //
        // Same-user refreshes keep the previous state identity: publishing the
        // fresh session object re-rendered the entire authenticated tree every
        // hour for a token rotation no consumer can observe (nothing reads
        // token fields from this context — the supabase client holds its own).
        // The ref below still gets the fresh session, and USER_UPDATED events
        // fall through to the unconditional setSession.
        markSessionAlive(newSession.user.id);
        previousSessionRef.current = newSession;
        setSession(prev => (prev && prev.user.id === newSession.user.id ? prev : newSession));
        void checkAccountSuspended(newSession.user.id);
        return;
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
          provider: provider,
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
      // Demo account for App Store review — skip sending OTP
      if (isDemoAccount(email)) {
        Logger.debug('Demo account detected, skipping OTP send');
        return { success: true };
      }

      // Check if account is suspended before sending OTP
      try {
        const { data: profile } = await supabase
          .from('profile')
          .select('account_status')
          .eq('email', email.trim().toLowerCase())
          .maybeSingle();

        if (profile?.account_status === 'suspended') {
          Logger.warn('Suspended account attempted sign-in', { email });
          return { success: false, error: new Error('ACCOUNT_SUSPENDED') };
        }
      } catch (error) {
        // Don't block sign-in if the check fails (e.g. new user with no profile yet)
        Logger.debug('Could not check account status before OTP', { error });
      }

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
    // Demo account for App Store review — use password auth instead of OTP
    if (isDemoAccount(email) && token === DEMO_ACCOUNT_OTP) {
      if (!DEMO_ACCOUNT_PASSWORD) {
        Logger.error(
          'Demo account password not configured',
          new Error('Missing EXPO_PUBLIC_DEMO_ACCOUNT_PASSWORD')
        );
        return { success: false, error: new Error('Demo account not configured') };
      }

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: DEMO_ACCOUNT_EMAIL,
          password: DEMO_ACCOUNT_PASSWORD,
        });

        if (error) {
          Logger.error('Demo account sign-in error', error);
          return { success: false, error };
        }

        return { success: true, user: data.user ?? undefined };
      } catch (error) {
        Logger.error('Unexpected demo account sign-in error', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error('Unknown error'),
        };
      }
    }

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
      // Capture user id before clearing the ref so we can unregister the
      // push token while the Supabase session JWT is still valid.
      const userId = previousSessionRef.current?.user?.id;
      // Clear previous session ref first to prevent expiry detection
      previousSessionRef.current = null;
      // Clear any existing session expired flag
      setSessionExpired(false);

      // Abort in-flight queries so screens that key on session/player id
      // (e.g. useJustForYou, useTopSuggestions) don't re-fire in anon mode
      // against heavier RPCs the moment the session goes null.
      await queryClient.cancelQueries();

      if (userId) {
        await unregisterPushToken(userId).catch(error => {
          Logger.error('Failed to clear push token on sign-out', error as Error);
        });
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        Logger.error('Error signing out', error);
        return { success: false, error };
      }
      recordSessionEnd('user_initiated');
      // Drop cached data tied to the previous user so it can't bleed into
      // the next session and so no auth-keyed query refetches as anon.
      queryClient.clear();
      posthogClient?.reset();
      // Drop Meta SDK user-id binding so subsequent events aren't attributed
      // to the signed-out user. Note: the SDK has no public API to clear
      // previously-set advanced-matching fields (email, etc.); those persist
      // for the install lifetime until overwritten by the next setMetaUserData
      // on a new sign-in.
      clearMetaUser();
      return { success: true };
    } catch (error) {
      Logger.error('Unexpected sign out error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }, [queryClient]);

  // Memoized so provider re-renders (React Compiler bails on this component
  // because of signOut's try/finally) don't hand every consumer a new
  // identity and cascade re-renders through the tree.
  const value: AuthContextType = useMemo(
    () => ({
      // State
      session,
      loading,
      isAuthenticated: !!session,
      user: session?.user ?? null,
      sessionExpired,
      clearSessionExpired,
      accountSuspended,
      clearAccountSuspended,

      // Auth methods
      signInWithProvider,
      signInWithEmail,
      verifyOtp,
      signOut,
    }),
    [
      session,
      loading,
      sessionExpired,
      clearSessionExpired,
      accountSuspended,
      clearAccountSuspended,
      signInWithProvider,
      signInWithEmail,
      verifyOtp,
      signOut,
    ]
  );

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
