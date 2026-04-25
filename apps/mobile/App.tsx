/**
 * IMPORTANT: Initialize Supabase with AsyncStorage FIRST
 * This must be the first import that touches @rallia/shared-services
 * to ensure the supabase client is properly configured before any hooks use it.
 */
import './src/lib/supabase';
import { initRevenueCat } from './src/lib/revenuecat';
import * as Sentry from '@sentry/react-native';
import { isRunningInExpoGo } from 'expo';
import Mapbox from '@rnmapbox/maps';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');
if (!isRunningInExpoGo()) {
  initRevenueCat();
}

// Set up Sentry navigation integration (must be created before Sentry.init)
const sentryNavigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: !isRunningInExpoGo(),
});

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__,
  tracesSampleRate: 0.2,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  integrations: [
    sentryNavigationIntegration,
    ...(!__DEV__ ? [Sentry.mobileReplayIntegration()] : []),
  ],
  enableNativeFramesTracking: !__DEV__ && !isRunningInExpoGo(),
  sendDefaultPii: true,
});

// Wire up the shared logger's SentryTransport so Logger.error() calls also go to Sentry
import { SentryTransport } from '@rallia/shared-services';
SentryTransport.configure(Sentry);

// Global handler for unhandled JS errors outside the React tree
// (e.g. setTimeout callbacks, event listeners, native module errors)
declare const ErrorUtils: {
  getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
};

const previousGlobalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  // Import Logger lazily to avoid circular dependency at module init
  const { Logger: L } = require('./src/services/logger');
  L.error('Unhandled JS error (global)', error, { isFatal });
  // Also send directly to Sentry for fatal errors
  if (isFatal) {
    Sentry.captureException(error, { level: 'fatal', extra: { isFatal } });
  }
  previousGlobalHandler(error, isFatal);
});

import { useEffect, useMemo, useState, useCallback, useRef, type PropsWithChildren } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';

// Keep the native splash visible until the app is ready, then cross-fade it out.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 400 });

// Set the native root view background color immediately so it's visible
// behind the React tree (e.g. area above the Dynamic Island).
SystemUI.setBackgroundColorAsync('#fafafa');
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation';
import { linking } from './src/navigation/linking';
import {
  ThemeProvider,
  useTheme,
  ProfileProvider,
  PlayerProvider,
  useProfile,
  usePlayer,
  useNotificationRealtime,
  usePendingFeedbackCheck,
  useUpdateLastSeen,
  useReferral,
  ProfileCompletenessProvider,
} from '@rallia/shared-hooks';
import { useBadgeCountSync } from '@rallia/shared-hooks/src/useBadgeCountSync';
// TEMPORARILY DISABLED: User walkthrough deactivated
// import { WelcomeTourModal } from './src/components/WelcomeTourModal';
// import { TourCompleteModal } from './src/components/TourCompleteModal';
import { ErrorBoundary, ToastProvider, NetworkProvider } from '@rallia/shared-components';
import type { ErrorBoundaryTranslations } from '@rallia/shared-components';
import { getLocales } from 'expo-localization';
import * as Application from 'expo-application';
import { Logger } from './src/services/logger';
import { appOpened, deepLinkOpened } from './src/services/analytics';
import {
  AuthProvider,
  useAuth,
  OverlayProvider,
  LocaleProvider,
  useLocale,
  ActionsSheetProvider,
  PendingExternalBookingProvider,
  SportProvider,
  useSport,
  MatchDetailSheetProvider,
  useMatchDetailSheet,
  PlayerInviteSheetProvider,
  FeedbackSheetProvider,
  useFeedbackSheet,
  FeedbackReportSheetProvider,
  useFeedbackReportSheet,
  DeepLinkProvider,
  useDeepLink,
  useOverlay,
  UserLocationProvider,
  useUserHomeLocation,
  LocationModeProvider,
  SubscriptionProvider,
  // useTour, // TEMPORARILY DISABLED: User walkthrough deactivated
  TourProvider,
} from './src/context';
import { usePushNotifications } from './src/hooks';
import { PostHogProvider, posthogClient } from './src/providers/PostHogProvider';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SheetManager, SheetProvider } from 'react-native-actions-sheet';
import { Sheets } from './src/context/sheets';
import { useToast } from '@rallia/shared-components';
import { getMatchWithDetails } from '@rallia/shared-services';
import type { MatchDetailData } from './src/context/MatchDetailSheetContext';
import { attemptFirstLaunchAttribution } from './src/utils/referralAttribution';
import {
  shouldShowReferralInvite,
  updateLastPromptTimestamp,
} from './src/utils/referralInviteFrequency';

// Import NativeWind global styles
// import './global.css';

// Connect React Query's focusManager to React Native's AppState.
// When the app returns from background, stale queries automatically refetch.
focusManager.setEventListener(handleFocus => {
  const subscription = AppState.addEventListener('change', state => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for 2 minutes - prevents unnecessary refetches
      staleTime: 1000 * 60 * 2,
      // Refetch stale queries when app comes back from background
      // or when navigating back to a screen (via focusManager integration)
      refetchOnWindowFocus: true,
      // Don't refetch on mount if data is fresh
      refetchOnMount: 'always',
      // Keep unused data in cache for 5 minutes
      gcTime: 1000 * 60 * 5,
      // Retry failed requests once
      retry: 1,
    },
  },
});

/**
 * Parse match ID from deep link URL.
 * Supports:
 * - rallia://match/[id]
 * - https://rallia.app/match/[id]
 */
function parseMatchIdFromUrl(url: string): string | null {
  try {
    const customSchemeMatch = url.match(/^rallia:\/\/match\/([a-zA-Z0-9-]+)/);
    if (customSchemeMatch) return customSchemeMatch[1];
    const universalLinkMatch = url.match(/^https?:\/\/rallia\.app\/match\/([a-zA-Z0-9-]+)/);
    if (universalLinkMatch) return universalLinkMatch[1];
    return null;
  } catch {
    return null;
  }
}

const UTM_STORAGE_KEY = '@rallia/utm-params';

interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
}

function parseUtmParams(url: string): UtmParams | null {
  try {
    // Works for both https:// universal links and rallia:// custom scheme
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return null;
    const query = url.slice(queryIndex + 1);
    const params: UtmParams = {};
    for (const part of query.split('&')) {
      const [key, value] = part.split('=');
      if (!key || !value) continue;
      const decoded = decodeURIComponent(value.replace(/\+/g, ' '));
      if (key === 'utm_source') params.utm_source = decoded;
      else if (key === 'utm_medium') params.utm_medium = decoded;
      else if (key === 'utm_campaign') params.utm_campaign = decoded;
      else if (key === 'utm_content') params.utm_content = decoded;
    }
    return Object.keys(params).length > 0 ? params : null;
  } catch {
    return null;
  }
}

/**
 * AuthenticatedProviders - Wraps providers that need userId from auth context.
 * This component sits inside AuthProvider and passes userId to ProfileProvider and PlayerProvider.
 */
function AuthenticatedProviders({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { syncLocaleToDatabase, isReady: isLocaleReady } = useLocale();
  const { setPendingMatchId } = useDeepLink();
  const { isSplashComplete } = useOverlay();
  const userId = user?.id;

  // Track user activity app-wide by updating last_seen_at
  // This updates immediately on mount and every 2 minutes while the app is active
  useUpdateLastSeen(userId);

  // Register super properties and identify user when authenticated
  useEffect(() => {
    posthogClient?.register({
      platform: 'mobile',
      os_type: Platform.OS,
      app_version: Application.nativeApplicationVersion ?? null,
    });
  }, []);

  useEffect(() => {
    if (user) {
      posthogClient?.identify(user.id, { email: user.email ?? null });
    }
  }, [user]);

  // Handle incoming deep link URL
  const handleDeepLink = useCallback(
    (url: string | null, isColdStart = false) => {
      if (!url) return;
      const utmParams = parseUtmParams(url);

      // On cold start, persist UTM params so they survive until post-auth attribution
      if (isColdStart && utmParams) {
        AsyncStorage.getItem(UTM_STORAGE_KEY).then(existing => {
          if (!existing) {
            AsyncStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utmParams)).catch(() => {});
          }
        });
      }

      const matchId = parseMatchIdFromUrl(url);
      const inviteCode = url.match(/\/invite\/([A-Za-z0-9]+)/)?.[1];

      if (matchId) {
        Logger.logNavigation('deep_link_received', { url, matchId });
        deepLinkOpened({ link_type: 'match', ...utmParams });
        setPendingMatchId(matchId);
      } else if (inviteCode) {
        deepLinkOpened({ link_type: 'invite', referral_code: inviteCode, ...utmParams });
      } else if (utmParams) {
        deepLinkOpened({ link_type: 'utm', ...utmParams });
      }
    },
    [setPendingMatchId]
  );

  // After authentication, set UTM params as PostHog person properties (once per install)
  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(UTM_STORAGE_KEY).then(raw => {
      if (!raw) return;
      try {
        const utmParams: UtmParams = JSON.parse(raw);
        posthogClient?.setPersonProperties({ ...utmParams });
        AsyncStorage.removeItem(UTM_STORAGE_KEY);
      } catch {
        // ignore parse errors for malformed UTM storage
      }
    });
  }, [userId]);

  // Listen for deep links (both cold start and while app is running)
  useEffect(() => {
    // Handle URL that opened the app (cold start)
    Linking.getInitialURL().then(url => handleDeepLink(url, true));

    // Handle URLs while app is running
    const subscription = Linking.addEventListener('url', event => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);

  // Register push notifications when user is authenticated
  // This will save the Expo push token to the player table
  // Pass the deep link handler for match notifications
  // Wait for splash to complete before handling cold start notifications
  usePushNotifications(userId, true, {
    onMatchNotificationTapped: setPendingMatchId,
    isSplashComplete,
  });

  // Subscribe to realtime notification updates
  // This keeps the notification badge in sync with the database
  useNotificationRealtime(userId);

  // Keep app icon badge count synced with unread notification count
  useBadgeCountSync(userId);

  // Sync locale to database when user logs in or locale becomes ready
  // This ensures server-side notifications use the correct locale
  useEffect(() => {
    if (userId && isLocaleReady) {
      syncLocaleToDatabase(userId);
    }
  }, [userId, isLocaleReady, syncLocaleToDatabase]);

  // Attempt automatic referral attribution on first launch
  // Android: Parse referral_code from Play Install Referrer
  // iOS: Match device fingerprint against web invite page visits
  useEffect(() => {
    if (userId) {
      attemptFirstLaunchAttribution(userId).catch(() => {});
    }
  }, [userId]);

  return (
    <UserLocationProvider>
      <LocationModeProvider>
        <HomeLocationSync userId={userId} />
        <ProfileProvider userId={userId}>
          <PlayerProvider userId={userId}>
            <SportProvider userId={userId}>
              <SubscriptionProvider>
                <ProfileCompletenessBridge>{children}</ProfileCompletenessBridge>
              </SubscriptionProvider>
            </SportProvider>
          </PlayerProvider>
        </ProfileProvider>
      </LocationModeProvider>
    </UserLocationProvider>
  );
}

/**
 * Bridges Profile, Player, and Sport contexts into the ProfileCompletenessProvider.
 * Must be rendered inside all three providers.
 */
function ProfileCompletenessBridge({ children }: PropsWithChildren) {
  const { profile } = useProfile();
  const { player, sportRatings, sportPreferences } = usePlayer();
  const { selectedSport } = useSport();

  return (
    <ProfileCompletenessProvider
      profile={profile}
      player={player}
      sportRatings={sportRatings}
      sportPreferences={sportPreferences}
      selectedSportId={selectedSport?.id ?? null}
      selectedSportName={selectedSport?.name ?? null}
    >
      {children}
    </ProfileCompletenessProvider>
  );
}

/**
 * HomeLocationSync - Syncs home location to database when user is authenticated.
 * Must be inside UserLocationProvider.
 */
function HomeLocationSync({ userId }: { userId: string | undefined }) {
  const { hasHomeLocation, syncToDatabase } = useUserHomeLocation();
  const [hasSynced, setHasSynced] = useState(false);

  // Sync home location to database when user is first authenticated
  useEffect(() => {
    if (userId && hasHomeLocation && !hasSynced) {
      syncToDatabase(userId).then(success => {
        if (success) {
          setHasSynced(true);
        }
      });
    }
  }, [userId, hasHomeLocation, hasSynced, syncToDatabase]);

  return null;
}

/**
 * SessionExpiryHandler - Shows toast when session expires unexpectedly.
 * Monitors the sessionExpired flag from AuthContext and notifies the user.
 * Must be rendered inside both AuthProvider and ToastProvider.
 */
function SessionExpiryHandler() {
  const { sessionExpired, clearSessionExpired } = useAuth();
  const { isSplashComplete } = useOverlay();
  const toast = useToast();
  const hasShownToastRef = useRef(false);

  useEffect(() => {
    // Only show toast once after splash is complete and session has expired
    if (sessionExpired && isSplashComplete && !hasShownToastRef.current) {
      hasShownToastRef.current = true;

      // Show toast after a brief delay to ensure UI is ready
      const timer = setTimeout(() => {
        Logger.info('Session expired - showing notification to user');
        toast.warning('Your session has expired. Please sign in again.');
        clearSessionExpired();
      }, 500);

      return () => clearTimeout(timer);
    }

    // Reset the flag when session expired flag is cleared
    if (!sessionExpired) {
      hasShownToastRef.current = false;
    }
  }, [sessionExpired, isSplashComplete, clearSessionExpired, toast]);

  return null;
}

/**
 * AccountSuspendedHandler - Shows toast when account is suspended by an admin.
 * Monitors the accountSuspended flag from AuthContext and notifies the user.
 * Must be rendered inside both AuthProvider and ToastProvider.
 */
function AccountSuspendedHandler() {
  const { accountSuspended, clearAccountSuspended } = useAuth();
  const { isSplashComplete } = useOverlay();
  const toast = useToast();
  const hasShownToastRef = useRef(false);

  useEffect(() => {
    if (accountSuspended && isSplashComplete && !hasShownToastRef.current) {
      hasShownToastRef.current = true;

      const timer = setTimeout(() => {
        Logger.info('Account suspended - showing notification to user');
        toast.error(
          'Your account has been suspended. Please contact support for more information.'
        );
        clearAccountSuspended();
      }, 500);

      return () => clearTimeout(timer);
    }

    if (!accountSuspended) {
      hasShownToastRef.current = false;
    }
  }, [accountSuspended, isSplashComplete, clearAccountSuspended, toast]);

  return null;
}

/**
 * PendingFeedbackHandler - Opens FeedbackSheet for pending feedback on app launch.
 * Checks for matches in the 48h feedback window where user hasn't completed feedback.
 */
function PendingFeedbackHandler() {
  const { user } = useAuth();
  const { isSplashComplete, isSportSelectionComplete } = useOverlay();
  const { openSheet } = useFeedbackSheet();

  // Check for pending feedback when splash and sport selection are complete
  usePendingFeedbackCheck({
    userId: user?.id,
    enabled: isSplashComplete && isSportSelectionComplete && !!user?.id,
    onMatchFound: data => {
      Logger.logNavigation('pending_feedback_found', {
        matchId: data.matchId,
        opponentsCount: data.opponents.length,
      });
      // Small delay to ensure the UI is ready
      setTimeout(() => {
        openSheet(data.matchId, data.reviewerId, data.participantId, data.opponents);
      }, 500);
    },
  });

  return null;
}

/**
 * DeepLinkHandler - Reacts to pending deep link match IDs and opens the match detail sheet.
 * Must be inside both DeepLinkProvider and MatchDetailSheetProvider.
 */
function DeepLinkHandler() {
  const { pendingMatchId, clearPendingDeepLink } = useDeepLink();
  const { openSheet } = useMatchDetailSheet();
  const { isSplashComplete, isSportSelectionComplete } = useOverlay();

  useEffect(() => {
    if (!pendingMatchId || !isSplashComplete || !isSportSelectionComplete) return;

    let cancelled = false;

    getMatchWithDetails(pendingMatchId).then(match => {
      if (cancelled) return;
      clearPendingDeepLink();
      if (match) {
        Logger.logUserAction('deep_link_match_opened', { matchId: pendingMatchId });
        openSheet(match as MatchDetailData);
      } else {
        Logger.warn('Deep link match not found', { matchId: pendingMatchId });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pendingMatchId, isSplashComplete, isSportSelectionComplete, openSheet, clearPendingDeepLink]);

  return null;
}

function ReferralInviteHandler() {
  const { user } = useAuth();
  const { isSplashComplete, isSportSelectionComplete, permissionsHandled } = useOverlay();
  const { feedbackData } = useFeedbackSheet();
  const { stats, statsLoading } = useReferral(user?.id);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    if (!user?.id || !isSplashComplete || !isSportSelectionComplete || !permissionsHandled) return;
    // Don't show if the feedback sheet is already visible
    if (feedbackData) return;
    // Wait for stats to load before deciding
    if (statsLoading) return;
    // Don't prompt users who already have successful referrals
    if (stats && stats.total_converted > 0) return;

    hasCheckedRef.current = true;

    (async () => {
      const shouldShow = await shouldShowReferralInvite();
      if (!shouldShow) return;

      await updateLastPromptTimestamp();
      setTimeout(() => {
        SheetManager.show('referral-invite');
      }, 1000);
    })();
  }, [
    user?.id,
    isSplashComplete,
    isSportSelectionComplete,
    permissionsHandled,
    feedbackData,
    stats,
    statsLoading,
  ]);

  return null;
}

/**
 * useOTAUpdate - Check for OTA updates while the splash screen is visible.
 * If an update is found, download it and reload before the user sees the app.
 * Returns whether the check is still in progress (to hold the splash open).
 */
function useOTAUpdate() {
  const [isChecking, setIsChecking] = useState(!__DEV__);

  useEffect(() => {
    if (__DEV__) return;

    let cancelled = false;

    (async () => {
      try {
        const { isAvailable } = await Updates.checkForUpdateAsync();
        if (cancelled) return;

        if (isAvailable) {
          await Updates.fetchUpdateAsync();
          if (!cancelled) {
            // Reload immediately — splash is still visible so the restart is seamless
            await Updates.reloadAsync();
          }
        }
      } catch (e) {
        Logger.warn('OTA update check failed', { error: e });
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return isChecking;
}

function AppContent() {
  const { theme } = useTheme();
  const { setSplashComplete, isSplashComplete, permissionsHandled } = useOverlay();
  const isCheckingUpdate = useOTAUpdate();
  const hasHiddenSplashRef = useRef(false);

  // Hide the native splash (cross-fade via setOptions above) once OTA check is done.
  // Gate setSplashComplete on this so downstream handlers keep their current ordering.
  useEffect(() => {
    if (isCheckingUpdate || hasHiddenSplashRef.current) return;
    hasHiddenSplashRef.current = true;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setSplashComplete(true));
  }, [isCheckingUpdate, setSplashComplete]);
  // TEMPORARILY DISABLED: User walkthrough deactivated
  // const { showCompletionModal, dismissCompletionModal, lastCompletedTourId } = useTour();

  // Track app opened event on mount
  useEffect(() => {
    appOpened({ cold_start: true });
  }, []);

  // Build a React Navigation theme so the screen container background
  // (including behind the status bar / Dynamic Island) uses the correct color.
  const navigationTheme = useMemo(() => {
    const base = theme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: theme === 'dark' ? '#0a0a0a' : '#fafafa',
      },
    };
  }, [theme]);

  // Register the navigation container with Sentry for screen tracking
  useEffect(() => {
    if (navigationRef.current) {
      sentryNavigationIntegration.registerNavigationContainer(navigationRef);
    }
  }, []);

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer
        ref={navigationRef}
        linking={linking}
        theme={navigationTheme}
        onStateChange={() => {
          // Notify React Query of navigation state changes so stale queries
          // refetch when the user navigates back to a screen.
          // Fresh queries (within staleTime) are not affected.
          focusManager.setFocused(true);

          // Track screen views in PostHog
          const currentRoute = navigationRef.current?.getCurrentRoute();
          if (currentRoute?.name) {
            posthogClient?.screen(currentRoute.name);
          }
        }}
      >
        <SheetProvider>
          <Sheets />
          <AppNavigator />
        </SheetProvider>
      </NavigationContainer>

      {/* Deep Link Handler - opens match detail sheet when a deep link is received */}
      <DeepLinkHandler />
      {/* Pending Feedback Handler - auto-opens FeedbackSheet on app launch if needed */}
      <PendingFeedbackHandler />
      {/* Session Expiry Handler - shows toast when session expires */}
      <SessionExpiryHandler />
      <AccountSuspendedHandler />
      {/* Referral Invite Handler - periodically prompts users to invite friends */}
      <ReferralInviteHandler />

      {/* TEMPORARILY DISABLED: User walkthrough deactivated
      <WelcomeTourModal splashComplete={isSplashComplete} permissionsHandled={permissionsHandled} />
      <TourCompleteModal
        visible={showCompletionModal}
        onDismiss={dismissCompletionModal}
        tourId={lastCompletedTourId || undefined}
      />
      */}
    </>
  );
}

// Detect device language for ErrorBoundary (rendered above LocaleProvider)
const deviceLanguage = getLocales()[0]?.languageCode;
const errorBoundaryTranslations: ErrorBoundaryTranslations | undefined =
  deviceLanguage === 'fr'
    ? {
        title: 'Oups ! Une erreur est survenue',
        description:
          "Nous nous excusons pour le désagrément. L'application a rencontré une erreur inattendue.",
        tryAgain: 'Réessayer',
        errorDetailsTitle: "Détails de l'erreur (développement uniquement)",
        errorMessage: "Message d'erreur :",
        stackTrace: "Trace d'appels :",
        componentStack: 'Pile des composants :',
      }
    : undefined;

function App() {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // Log unhandled errors with full context
    Logger.error('Unhandled app error', error, {
      componentStack: errorInfo.componentStack,
    });
    // Also capture in Sentry with component stack context
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#fafafa' }}>
      <ErrorBoundary onError={handleError} translations={errorBoundaryTranslations}>
        <SafeAreaProvider>
          <PostHogProvider>
            <QueryClientProvider client={queryClient}>
              <LocaleProvider>
                <ThemeProvider>
                  <TourProvider>
                    <NetworkProvider>
                      <ToastProvider>
                        <DeepLinkProvider>
                          <OverlayProvider>
                            <AuthProvider>
                              <AuthenticatedProviders>
                                <ActionsSheetProvider>
                                  <MatchDetailSheetProvider>
                                    <PendingExternalBookingProvider>
                                      <PlayerInviteSheetProvider>
                                        <FeedbackSheetProvider>
                                          <FeedbackReportSheetProvider>
                                            <StripeProvider
                                              publishableKey={
                                                process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
                                              }
                                              merchantIdentifier="merchant.com.rallia"
                                            >
                                              <AppContent />
                                            </StripeProvider>
                                          </FeedbackReportSheetProvider>
                                        </FeedbackSheetProvider>
                                      </PlayerInviteSheetProvider>
                                    </PendingExternalBookingProvider>
                                  </MatchDetailSheetProvider>
                                </ActionsSheetProvider>
                              </AuthenticatedProviders>
                            </AuthProvider>
                          </OverlayProvider>
                        </DeepLinkProvider>
                      </ToastProvider>
                    </NetworkProvider>
                  </TourProvider>
                </ThemeProvider>
              </LocaleProvider>
            </QueryClientProvider>
          </PostHogProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
