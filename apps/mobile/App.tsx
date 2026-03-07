/**
 * IMPORTANT: Initialize Supabase with AsyncStorage FIRST
 * This must be the first import that touches @rallia/shared-services
 * to ensure the supabase client is properly configured before any hooks use it.
 */
import './src/lib/supabase';

import { useEffect, useState, useCallback, useRef, type PropsWithChildren } from 'react';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation/AppNavigator';
import { navigationRef } from './src/navigation';
import { linking } from './src/navigation/linking';
import { ActionsBottomSheet } from './src/components/ActionsBottomSheet';
import { FeedbackSheet } from './src/components/FeedbackSheet';
import { SplashOverlay } from './src/components/SplashOverlay';
import {
  ThemeProvider,
  useTheme,
  ProfileProvider,
  PlayerProvider,
  useNotificationRealtime,
  usePendingFeedbackCheck,
  useUpdateLastSeen,
} from '@rallia/shared-hooks';
import { useBadgeCountSync } from '@rallia/shared-hooks/src/useBadgeCountSync';
import { WelcomeTourModal } from './src/components/WelcomeTourModal';
import { TourCompleteModal } from './src/components/TourCompleteModal';
import { ErrorBoundary, ToastProvider, NetworkProvider } from '@rallia/shared-components';
import { Logger } from './src/services/logger';
import {
  AuthProvider,
  useAuth,
  OverlayProvider,
  LocaleProvider,
  useLocale,
  ActionsSheetProvider,
  SportProvider,
  MatchDetailSheetProvider,
  useMatchDetailSheet,
  PlayerInviteSheetProvider,
  FeedbackSheetProvider,
  useFeedbackSheet,
  DeepLinkProvider,
  useDeepLink,
  useOverlay,
  UserLocationProvider,
  useUserHomeLocation,
  LocationModeProvider,
  useTour,
  TourProvider,
} from './src/context';
import { usePushNotifications } from './src/hooks';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SheetProvider } from 'react-native-actions-sheet';
import { Sheets } from './src/context/sheets';
import { useToast } from '@rallia/shared-components';
import { getMatchWithDetails } from '@rallia/shared-services';
import type { MatchDetailData } from './src/context/MatchDetailSheetContext';
import { attemptFirstLaunchAttribution } from './src/utils/referralAttribution';

// Import NativeWind global styles
import './global.css';
import MatchDetailSheet from './src/components/MatchDetailSheet';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for 2 minutes - prevents unnecessary refetches
      staleTime: 1000 * 60 * 2,
      // Don't refetch on window focus by default (use pull-to-refresh instead)
      refetchOnWindowFocus: false,
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
    // Handle custom scheme: rallia://match/[id]
    const customSchemeMatch = url.match(/^rallia:\/\/match\/([a-zA-Z0-9-]+)/);
    if (customSchemeMatch) {
      return customSchemeMatch[1];
    }

    // Handle universal link: https://rallia.app/match/[id]
    const universalLinkMatch = url.match(/^https?:\/\/rallia\.app\/match\/([a-zA-Z0-9-]+)/);
    if (universalLinkMatch) {
      return universalLinkMatch[1];
    }

    return null;
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

  // Handle incoming deep link URL
  const handleDeepLink = useCallback(
    (url: string | null) => {
      if (!url) return;
      const matchId = parseMatchIdFromUrl(url);
      if (matchId) {
        Logger.logNavigation('deep_link_received', { url, matchId });
        setPendingMatchId(matchId);
      }
    },
    [setPendingMatchId]
  );

  // Listen for deep links (both cold start and while app is running)
  useEffect(() => {
    // Handle URL that opened the app (cold start)
    Linking.getInitialURL().then(handleDeepLink);

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
            <SportProvider userId={userId}>{children}</SportProvider>
          </PlayerProvider>
        </ProfileProvider>
      </LocationModeProvider>
    </UserLocationProvider>
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
  const { isSplashComplete } = useOverlay();

  useEffect(() => {
    if (!pendingMatchId || !isSplashComplete) return;

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
  }, [pendingMatchId, isSplashComplete, openSheet, clearPendingDeepLink]);

  return null;
}

function AppContent() {
  const { theme } = useTheme();
  const { setSplashComplete, isSplashComplete, permissionsHandled } = useOverlay();
  const { showCompletionModal, dismissCompletionModal, lastCompletedTourId } = useTour();

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer ref={navigationRef} linking={linking}>
        <SheetProvider>
          <Sheets />
          <AppNavigator />
        </SheetProvider>
        {/* Match Detail Bottom Sheet - shows when match card is pressed */}
        <MatchDetailSheet />
        {/* Actions Bottom Sheet - renders above navigation */}
        <ActionsBottomSheet />
        {/* Feedback Bottom Sheet - shows when providing post-match feedback */}
        <FeedbackSheet />
      </NavigationContainer>

      {/* Deep Link Handler - opens match detail sheet when a deep link is received */}
      <DeepLinkHandler />
      {/* Pending Feedback Handler - auto-opens FeedbackSheet on app launch if needed */}
      <PendingFeedbackHandler />
      {/* Session Expiry Handler - shows toast when session expires */}
      <SessionExpiryHandler />

      {/* Welcome Tour Modal - shows for new users after splash/permissions */}
      <WelcomeTourModal splashComplete={isSplashComplete} permissionsHandled={permissionsHandled} />
      {/* Tour Completion Modal - shows after completing main navigation tour */}
      <TourCompleteModal
        visible={showCompletionModal}
        onDismiss={dismissCompletionModal}
        tourId={lastCompletedTourId || undefined}
      />
      {/* Splash overlay - renders on top of everything */}
      <SplashOverlay onAnimationComplete={() => setSplashComplete(true)} />
    </>
  );
}

export default function App() {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // Log unhandled errors with full context
    Logger.error('Unhandled app error', error, {
      componentStack: errorInfo.componentStack,
    });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary onError={handleError}>
        <SafeAreaProvider>
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
                                  <PlayerInviteSheetProvider>
                                    <FeedbackSheetProvider>
                                      <StripeProvider
                                        publishableKey={
                                          process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
                                        }
                                        merchantIdentifier="merchant.com.rallia"
                                      >
                                        <BottomSheetModalProvider>
                                          <AppContent />
                                        </BottomSheetModalProvider>
                                      </StripeProvider>
                                    </FeedbackSheetProvider>
                                  </PlayerInviteSheetProvider>
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
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
