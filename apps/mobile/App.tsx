/**
 * IMPORTANT: Initialize Supabase with AsyncStorage FIRST
 * This must be the first import that touches @rallia/shared-services
 * to ensure the supabase client is properly configured before any hooks use it.
 */
import './src/lib/supabase';
import { initRevenueCat } from './src/lib/revenuecat';
import { initMeta, syncMetaTrackingFromExistingATT } from './src/lib/meta';

import * as Sentry from '@sentry/react-native';
import { isRunningInExpoGo } from 'expo';
import Mapbox from '@rnmapbox/maps';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');
if (!isRunningInExpoGo()) {
  initRevenueCat();
  // Init Meta SDK with tracking OFF — it stays gated until the user passes
  // ATT in TrackingPermissionStep. If ATT is already granted from a prior
  // session, syncMetaTrackingFromExistingATT flips tracking back on without
  // re-prompting.
  initMeta();
  void syncMetaTrackingFromExistingATT();
}

// Set up Sentry navigation integration (must be created before Sentry.init)
const sentryNavigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: !isRunningInExpoGo(),
});

// Transient connectivity (timeouts, suspended-runtime fetch failures, Supabase
// auth retries) is not an actionable bug — drop it at the global chokepoint so
// auto-instrumented captures don't create issues. Logger-routed copies are
// already filtered to a breadcrumb in SentryTransport.
const TRANSIENT_NETWORK_ERROR = /Network request (failed|timed out)/i;
function dropTransientNetworkNoise(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const hasNetworkNoise = event.exception?.values?.some(
    v =>
      v.type === 'NetworkTimeoutError' ||
      v.type === 'AuthRetryableFetchError' ||
      (typeof v.value === 'string' && TRANSIENT_NETWORK_ERROR.test(v.value))
  );
  return hasNetworkNoise ? null : event;
}

if (!__DEV__ && !process.env.EXPO_PUBLIC_SENTRY_DSN) {
  console.warn('[Sentry] EXPO_PUBLIC_SENTRY_DSN is missing — events will not be reported.');
}

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__,
  environment: process.env.EXPO_PUBLIC_APP_ENV,
  tracesSampleRate: 0.2,
  // Relative to tracesSampleRate: ~6% of navigations get a Hermes flamegraph.
  profilesSampleRate: 0.3,
  // No session replay: its buffer-mode capture caused app-wide jank in prod.
  integrations: [sentryNavigationIntegration],
  enableNativeFramesTracking: !__DEV__ && !isRunningInExpoGo(),
  sendDefaultPii: true,
  beforeSend: dropTransientNetworkNoise,
});

// Wire up the shared logger's SentryTransport so Logger.error() calls also go to Sentry
import { SentryTransport } from '@rallia/shared-services';
import { AppState as RNAppState } from 'react-native';
SentryTransport.configure(Sentry, {
  getAppState: () => RNAppState.currentState,
});

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
import { AppState, Linking, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { neutral } from '@rallia/design-system';
import { useFonts } from 'expo-font';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from '@expo-google-fonts/poppins';
import {
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
} from '@expo-google-fonts/barlow-semi-condensed';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

// Theme v2 faces — the names here are what shared-components' Text resolves
// (Poppins = display, Barlow Semi Condensed = stat numerals, Inter = body).
const APP_FONTS = {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};

// Keep the native splash visible until the app is ready, then cross-fade it out.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 400 });

// Set the native root view background color immediately so it's visible
// behind the React tree (e.g. area above the Dynamic Island).
SystemUI.setBackgroundColorAsync(neutral[50]).catch(() => {}); // rejects if the Android activity is already gone
import { focusManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
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
  ProfileCompletenessProvider,
  tournamentKeys,
} from '@rallia/shared-hooks';
import { useBadgeCountSync } from '@rallia/shared-hooks/src/useBadgeCountSync';
import { ErrorBoundary, ToastProvider, NetworkProvider, useToast } from '@rallia/shared-components';
import type { ErrorBoundaryTranslations } from '@rallia/shared-components';
import { getLocales } from 'expo-localization';
import * as Application from 'expo-application';

import { parseUtmParams, successHaptic, type UtmParams } from '@rallia/shared-utils';
import { PostHogProvider, posthogClient } from './src/providers/PostHogProvider';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SheetManager, SheetProvider } from 'react-native-actions-sheet';
import { Sheets } from './src/context/sheets';
import { getMatchWithDetails, supabase } from '@rallia/shared-services';
import { usePushNotifications, useTranslation, type TranslationKey } from './src/hooks';
import { useAppVersionGate } from './src/hooks/useAppVersionGate';
import { usePolicyConsentGate } from './src/hooks/usePolicyConsentGate';
import { useApplyUpdateOnResume } from './src/hooks/useApplyUpdateOnResume';
import { UpdateRequiredScreen } from './src/components/UpdateRequiredScreen';
import { PolicyReconsentScreen } from './src/components/PolicyReconsentScreen';
import { serializeQueryCache, deserializeQueryCache } from './src/lib/queryPersister';
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
  useTour,
  TourProvider,
} from './src/context';
import { appOpened, deepLinkOpened } from './src/services/analytics';
import { runWhenIdle } from './src/utils/runWhenIdle';
import { fetchDeferredAppLink, setMetaUserId, setMetaUserData } from './src/lib/meta';
import { Logger } from './src/services/logger';
import { JustForYouPrefetch } from './src/components/JustForYouPrefetch';
import { TourCompleteModal } from './src/components/TourCompleteModal';
import { WelcomeTourModal } from './src/components/WelcomeTourModal';
import { WeeklyCheckInAutoOpener } from './src/features/weekly-checkin/WeeklyCheckInAutoOpener';
import { WEEKLY_CHECKIN_ENABLED } from './src/features/weekly-checkin/featureFlag';
import { Serie1AnnouncementAutoOpener } from './src/features/tournaments/announcement/Serie1AnnouncementAutoOpener';
import { isWeeklyCheckInActive } from './src/features/weekly-checkin/isWizardActive';
import { linking } from './src/navigation/linking';
import { navigationRef } from './src/navigation';
import { IS_E2E } from './src/utils/e2e';
import AppNavigator from './src/navigation/AppNavigator';
import type { MatchDetailData } from './src/context/MatchDetailSheetContext';
import {
  attemptFirstLaunchAttribution,
  WEB_DISTINCT_ID_KEY,
} from './src/utils/referralAttribution';

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
      // Don't refetch on mount if data is fresh (within staleTime); refetch only
      // when stale. Hooks needing unconditional mount refetch set their own 'always'.
      refetchOnMount: true,
      // Keep persisted entries usable for 24h. The persister itself also
      // enforces a maxAge, but TanStack only restores a query into cache
      // when gcTime hasn't elapsed, so gcTime must be ≥ the persister's
      // maxAge for cold-start hydration to actually populate the cache.
      gcTime: 1000 * 60 * 60 * 24,
      // Retry failed requests once
      retry: 1,
    },
  },
});

// AsyncStorage-backed persister — cold-start hydration of TanStack Query so
// Home (and other screens) render real cards instead of skeletons on launch.
// Custom serialize/deserialize round-trip JS `Date` instances (suggestion
// slots in the "Just for you" carousel carry them); plain JSON would lose
// them and crash consumers that call `.getTime()` on the rehydrated value.
const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: '@rallia/rq-cache',
  serialize: serializeQueryCache,
  deserialize: deserializeQueryCache,
  // Serializing the whole cache is a synchronous JS-thread cost that lands
  // mid-navigation while queries churn; the cache only needs to be roughly
  // current for cold-start hydration, so persist at most once per 5s instead
  // of the 1s default (asyncThrottle runs on the trailing edge, so the last
  // burst still gets written).
  throttleTime: 5000,
});

// Bump this string to invalidate every persisted query at once — e.g. after a
// breaking change to a query key shape or a payload schema.
// v4: Date-aware serializer added; bust v3 entries so we don't try to rehydrate
// a payload written before Date markers existed (would no-op safely, but the
// bust also covers the newly-included `matches/justForYou` shape).
const QUERY_CACHE_BUSTER = 'v4';

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

/**
 * AuthenticatedProviders - Wraps providers that need userId from auth context.
 * This component sits inside AuthProvider and passes userId to ProfileProvider and PlayerProvider.
 */
/**
 * Holds the native splash up until the Home screen has all the data it needs
 * to render without flicker (auth resolved, profile/player/sport loaded for
 * signed-in users, locale + OTA check done). Has a 5s safety timeout so a
 * stuck provider can never deadlock the app.
 *
 * Signed-out users skip the profile/player/sport gates — the splash hides as
 * soon as auth resolves to "no session".
 */
function SplashGate({ children }: PropsWithChildren) {
  const { setSplashComplete } = useOverlay();
  const { session, loading: authLoading } = useAuth();
  const { loading: profileLoading } = useProfile();
  const { loading: playerLoading } = usePlayer();
  const { isLoading: sportLoading } = useSport();
  const { isReady: isLocaleReady } = useLocale();
  const isCheckingUpdate = useOTAUpdate();
  const hasHiddenSplashRef = useRef(false);
  const [timedOut, setTimedOut] = useState(false);
  // Bundled with the app, so this resolves in one frame; the 5s safety
  // timeout below still applies if loading ever fails.
  const [fontsLoaded] = useFonts(APP_FONTS);

  // Safety net — if any provider hangs, hide splash after 5s anyway.
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const isAppReady = useMemo(() => {
    if (!fontsLoaded) return false;
    if (isCheckingUpdate) return false;
    if (!isLocaleReady) return false;
    if (authLoading) return false;
    // Signed-out: nothing per-user to wait on.
    if (!session) return true;
    // Signed-in: wait for all three user-scoped contexts to settle.
    if (profileLoading) return false;
    if (playerLoading) return false;
    if (sportLoading) return false;
    return true;
  }, [
    fontsLoaded,
    isCheckingUpdate,
    isLocaleReady,
    authLoading,
    session,
    profileLoading,
    playerLoading,
    sportLoading,
  ]);

  useEffect(() => {
    if (hasHiddenSplashRef.current) return;
    if (!isAppReady && !timedOut) return;
    hasHiddenSplashRef.current = true;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setSplashComplete(true));
  }, [isAppReady, timedOut, setSplashComplete]);

  return <>{children}</>;
}

function AuthenticatedProviders({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { syncLocaleToDatabase, isReady: isLocaleReady } = useLocale();
  const { setPendingMatchId } = useDeepLink();
  const { isSplashComplete } = useOverlay();
  const toast = useToast();
  const { t } = useTranslation();
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
    if (!user) return;
    // Bridge the web visitor's PostHog distinct_id into the authenticated
    // mobile profile. `alias` merges the anonymous web-side person (which
    // carries person.utm_source set by web's UtmCapture) into the current
    // mobile distinct_id; then `identify(user.id)` promotes everything to
    // the canonical authenticated user id. Sequence matters: alias MUST
    // run before identify so the merge resolves cleanly.
    void (async () => {
      try {
        const webDid = await AsyncStorage.getItem(WEB_DISTINCT_ID_KEY);
        if (webDid) {
          posthogClient?.alias(webDid);
          await AsyncStorage.removeItem(WEB_DISTINCT_ID_KEY).catch(() => {});
        }
      } finally {
        posthogClient?.identify(user.id, { email: user.email ?? null });
        // Mirror identify to the Meta SDK for Advanced Matching. The SDK
        // SHA-256-hashes these locally before they leave the device; we just
        // hand it the raw values. Improves EMQ (Event Match Quality) for
        // ATT-opted-in users and gives Meta better lookalike seeds.
        setMetaUserId(user.id);
        setMetaUserData({ email: user.email ?? null });
      }
    })();
  }, [user]);

  // Handle incoming deep link URL
  const handleDeepLink = useCallback(
    (url: string | null, isColdStart = false, source: 'os' | 'meta_deferred' = 'os') => {
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

      // PostHog distinct_id passthrough — when a web visitor taps a Universal
      // Link (e.g. the Smart App Banner or a /match/[id] link) the URL carries
      // `?ph_did=<their web distinct_id>`. Persisting this on cold start lets
      // the post-auth alias merge their pre-install web events into the user.
      if (isColdStart) {
        try {
          const phDid = new URL(url).searchParams.get('ph_did');
          if (phDid) {
            AsyncStorage.getItem(WEB_DISTINCT_ID_KEY).then(existing => {
              if (!existing) {
                AsyncStorage.setItem(WEB_DISTINCT_ID_KEY, phDid).catch(() => {});
              }
            });
          }
        } catch {
          // Malformed URL — ignore.
        }
      }

      const matchId = parseMatchIdFromUrl(url);
      const inviteCode = url.match(/\/invite\/([A-Za-z0-9]+)/)?.[1];

      const isStripeConnectReturn =
        url.includes('stripe-connect-return') || url.includes('/stripe-connect-return');

      if (matchId) {
        Logger.logNavigation('deep_link_received', { url, matchId, source });
        deepLinkOpened({ link_type: 'match', source, ...utmParams });
        setPendingMatchId(matchId);
      } else if (isStripeConnectReturn) {
        // The account.updated webhook may not have fired yet when the user
        // returns from Stripe onboarding, so we poll a few times with a delay
        // before giving up.
        const checkOnboarding = async (attempts = 0): Promise<void> => {
          const { data } = await supabase
            .from('player_stripe_account')
            .select('onboarding_completed')
            .eq('player_id', user?.id ?? '')
            .single();

          if (data?.onboarding_completed) {
            successHaptic();
            toast.success(t('tournamentDetail.payments.payoutsConnectedToast'));
            // Screens read the mirror through this query; without invalidation
            // the payout badge stays on its cached pre-onboarding state.
            if (user?.id) {
              void queryClient.invalidateQueries({
                queryKey: tournamentKeys.myPayoutAccount(user.id),
              });
            }
          } else if (attempts < 5) {
            setTimeout(() => checkOnboarding(attempts + 1), 2000);
          }
        };
        checkOnboarding();
      } else if (inviteCode) {
        const invitationType = /[?&]type=([a-z]+)/.exec(url)?.[1];
        deepLinkOpened({
          link_type: 'invite',
          source,
          referral_code: inviteCode,
          invitation_type: invitationType,
          ...utmParams,
        });
      } else if (utmParams) {
        deepLinkOpened({ link_type: 'utm', source, ...utmParams });
      }
    },
    [setPendingMatchId, user?.id, toast, t]
  );

  // After authentication, set UTM params as PostHog person properties AND mirror
  // them onto profile.utm_* so the admin Acquisition tab can join attribution
  // to downstream Supabase data. Both happen exactly once per install.
  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(UTM_STORAGE_KEY).then(async raw => {
      if (!raw) return;
      try {
        const utmParams: UtmParams = JSON.parse(raw);
        posthogClient?.setPersonProperties({ ...utmParams });
        const { error } = await supabase.rpc('set_profile_utm', {
          p_player_id: userId,
          p_utm: utmParams,
        });
        if (!error) {
          AsyncStorage.removeItem(UTM_STORAGE_KEY).catch(() => {});
        }
      } catch {
        // ignore parse errors for malformed UTM storage
      }
    });
  }, [userId]);

  // Listen for deep links (both cold start and while app is running)
  useEffect(() => {
    // Handle URL that opened the app (cold start)
    Linking.getInitialURL().then(url => handleDeepLink(url, true));

    // Meta's deferred deep link — populated when the user tapped a Meta ad
    // whose destination was a deep link, before the app was installed. Fires
    // exactly once per install; subsequent launches return null. Without an
    // MMP this is the only mechanism that recovers ad-click → install
    // context, so we route it through the same handler as a normal cold-start
    // URL — but tag the source so PostHog can distinguish ad-driven cold
    // starts from organic ones.
    fetchDeferredAppLink().then(url => {
      if (url) handleDeepLink(url, true, 'meta_deferred');
    });

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

  // Sync locale to database when user logs in or locale becomes ready.
  // Deferred off the cold-start critical path: this does a profile.update (and
  // possibly auth.updateUser) that otherwise competed with the auth/player/
  // carousel queries for the connection pool during sign-in. Locale rarely
  // changes, so a few seconds' delay is harmless for server-side notifications.
  useEffect(() => {
    if (!userId || !isLocaleReady) return;
    const timer = setTimeout(() => {
      syncLocaleToDatabase(userId);
    }, 5000);
    return () => clearTimeout(timer);
  }, [userId, isLocaleReady, syncLocaleToDatabase]);

  // Attempt automatic referral attribution on first launch — must run
  // pre-auth so PENDING_REFERRAL_KEY is populated before DiscoveryStep
  // checks for it and OnboardingWizard consumes it post-signup.
  //   Android: Parse referral_code from the Play Install Referrer
  //   iOS:     Read the rallia_attrib_v1 clipboard handoff token written
  //            by the marketing /invite landing's Download button
  // Idempotent — guarded by ATTRIBUTION_ATTEMPTED_KEY in AsyncStorage.
  useEffect(() => {
    attemptFirstLaunchAttribution().catch(() => {});
  }, []);

  return (
    <UserLocationProvider>
      <LocationModeProvider>
        <ProfileProvider userId={userId}>
          <PlayerProvider userId={userId}>
            <HomeLocationSync userId={userId} />
            <SportProvider userId={userId}>
              <SubscriptionProvider>
                {/* Warms the React Query cache for Home's "Just for you"
                    carousel as soon as auth + sport + location resolve, so
                    the heavy RPC overlaps with the splash animation instead
                    of starting after Home mounts. Renders nothing. */}
                <JustForYouPrefetch />
                <SplashGate>
                  <ProfileCompletenessBridge>{children}</ProfileCompletenessBridge>
                </SplashGate>
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
 * HomeLocationSync - Syncs the AsyncStorage home location to the player row
 * after sign-in, only when the DB and local values diverge. Skipping the
 * UPDATE when nothing changed avoids contending with usePushNotifications
 * (which also UPDATEs the same player row on sign-in) and the statement
 * timeout that contention occasionally triggers.
 *
 * Must be inside UserLocationProvider AND PlayerProvider.
 */
function HomeLocationSync({ userId }: { userId: string | undefined }) {
  const { homeLocation, hasHomeLocation, syncToDatabase } = useUserHomeLocation();
  const { player, loading: playerLoading } = usePlayer();
  const [hasSynced, setHasSynced] = useState(false);

  useEffect(() => {
    if (!userId || !hasHomeLocation || hasSynced || playerLoading || !player || !homeLocation) {
      return;
    }

    // Skip the UPDATE when the DB already matches AsyncStorage. The sync runs
    // unconditionally on every sign-in by design (defensive — covers cases
    // where the user changed postal code on another device), but in the
    // common case nothing has drifted and the write is wasted lock contention.
    const matches =
      player.latitude === homeLocation.latitude &&
      player.longitude === homeLocation.longitude &&
      player.postal_code === homeLocation.postalCode &&
      player.country === homeLocation.country;

    if (matches) {
      setHasSynced(true);
      return;
    }

    syncToDatabase(userId).then(success => {
      if (success) {
        setHasSynced(true);
      }
    });
  }, [userId, hasHomeLocation, hasSynced, playerLoading, player, homeLocation, syncToDatabase]);

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
    enabled: isSplashComplete && isSportSelectionComplete && !!user?.id && !IS_E2E,
    onMatchFound: data => {
      Logger.logNavigation('pending_feedback_found', {
        matchId: data.matchId,
        opponentsCount: data.opponents.length,
      });
      // Small delay to ensure the UI is ready
      setTimeout(() => {
        // Don't open the feedback sheet over the weekly check-in wizard.
        // The pending feedback persists server-side so it'll be picked up
        // on the next launch / next Home focus.
        if (isWeeklyCheckInActive()) {
          Logger.logUserAction('pending_feedback_suppressed_for_wizard', {
            matchId: data.matchId,
          });
          return;
        }
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
      // Don't open a match-detail sheet over the weekly check-in wizard;
      // re-queue handling for after dismissal would be ideal but for now
      // we simply drop the deep link if the wizard is focused.
      if (isWeeklyCheckInActive()) {
        Logger.logUserAction('deep_link_match_suppressed_for_wizard', {
          matchId: pendingMatchId,
        });
        return;
      }
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

/**
 * useOTAUpdate - Check for OTA updates while the splash screen is visible.
 * If an update is found, download it and let it apply on the next app launch.
 * This avoids any splash screen flash or loading spinner during the reload.
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
          // Don't reload immediately — the update will apply on next launch.
          // This prevents the splash screen from flashing or showing a spinner.
          Logger.info('OTA update downloaded, will apply on next launch');
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

/**
 * UpdateGate — replaces the entire app surface with a blocking "Update Required"
 * screen when the installed binary is below `app_min_version.min_supported_version`.
 * Wraps AppContent so the version check runs in parallel with provider init; on
 * "required" we hide the native splash and render the blocking screen instead of
 * the navigation tree. Fail-open is enforced inside useAppVersionGate so a
 * Supabase outage can't lock the install base out.
 */
function UpdateGate({ children }: PropsWithChildren) {
  const gate = useAppVersionGate();

  useEffect(() => {
    if (gate.status === 'required') {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [gate.status]);

  if (gate.status === 'required') {
    return (
      <UpdateRequiredScreen
        storeUrl={gate.storeUrl}
        currentVersion={gate.currentVersion}
        requiredVersion={gate.requiredVersion}
      />
    );
  }
  return <>{children}</>;
}

/**
 * ThemedRoot — theme-aware background layer sitting just inside ThemeProvider.
 * The GestureHandlerRootView above it is hardcoded light (it renders before
 * ThemeProvider exists), so without this, any frame where the tree below is
 * swapped out — e.g. the gates replacing the app surface, or the navigation
 * tree mounting after re-consent — flashes white in dark mode.
 */
function ThemedRoot({ children }: PropsWithChildren) {
  const { theme } = useTheme();
  const background = theme === 'dark' ? neutral[950] : neutral[50];

  // Keep the native root view (set to light at module init, before the theme
  // is known) in sync too — it's what shows through during native transitions.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(background).catch(() => {});
  }, [background]);

  return <View style={{ flex: 1, backgroundColor: background }}>{children}</View>;
}

/**
 * ConsentGate — replaces the entire app surface with a blocking re-consent
 * screen when the signed-in user hasn't accepted the current version of the
 * Privacy Policy and/or Terms of Use. Nested inside UpdateGate (a stale
 * binary is a more urgent block than stale consent, and there's no point
 * checking consent on a binary that's about to be forced to update anyway).
 * Existing accounts are grandfathered via a migration backfill, so this only
 * ever fires going forward, on a real policy_versions bump. Fail-open is
 * enforced inside usePolicyConsentGate so a Supabase outage can't lock users
 * out; guests (no session) are never gated.
 */
function ConsentGate({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { profile } = useProfile();
  // Brand-new accounts consent inside the onboarding wizard's consent step —
  // gating them here double-prompts and ejects the wizard sheet mid-signup.
  // The blocking gate only covers policy bumps for already-onboarded users
  // (passing null short-circuits the hook to 'ok', same as guests).
  const isOnboarded = !!profile?.onboarding_completed;
  const gate = usePolicyConsentGate(isOnboarded ? user?.id : null);

  useEffect(() => {
    if (gate.status === 'required') {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [gate.status]);

  if (gate.status === 'required') {
    return <PolicyReconsentScreen pending={gate.pending} onAccepted={gate.recheck} />;
  }
  return <>{children}</>;
}

function AppContent() {
  const { theme } = useTheme();
  // Splash hide is owned by SplashGate (which lives inside AuthenticatedProviders
  // so it can wait on profile/player/sport before revealing Home).
  const { isSplashComplete, permissionsHandled } = useOverlay();
  const { showCompletionModal, dismissCompletionModal, lastCompletedTourId } = useTour();

  // Apply a pending OTA update when the app resumes after a long background,
  // for users who background/foreground rather than cold-start. Gated on
  // splash completion so it never races the launch-time update flow.
  useApplyUpdateOnResume({ enabled: isSplashComplete });

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
        background: theme === 'dark' ? neutral[950] : neutral[50],
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
        onReady={() => {
          // onStateChange never fires for the initial state, so the first
          // screen of every session would otherwise go untracked in PostHog.
          const initialRoute = navigationRef.current?.getCurrentRoute();
          if (initialRoute?.name) {
            posthogClient?.screen(initialRoute.name);
          }
        }}
        onStateChange={() => {
          // Notify React Query of navigation state changes so stale queries
          // refetch when the user navigates back to a screen.
          // Fresh queries (within staleTime) are not affected.
          focusManager.setFocused(true);

          // Track screen views in PostHog. Deferred off the transition frame:
          // each capture synchronously JSON.stringifys PostHog's whole
          // persisted cache (flags, person props, event queue), which is a
          // real per-navigation JS-thread cost for signed-in users.
          const currentRoute = navigationRef.current?.getCurrentRoute();
          if (currentRoute?.name) {
            const screenName = currentRoute.name;
            runWhenIdle(() => {
              posthogClient?.screen(screenName);
            });
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
      <WelcomeTourModal splashComplete={isSplashComplete} permissionsHandled={permissionsHandled} />
      {WEEKLY_CHECKIN_ENABLED && <WeeklyCheckInAutoOpener isSplashComplete={isSplashComplete} />}
      <Serie1AnnouncementAutoOpener isSplashComplete={isSplashComplete} />
      <TourCompleteModal
        visible={showCompletionModal}
        onDismiss={dismissCompletionModal}
        tourId={lastCompletedTourId || undefined}
      />
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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: neutral[50] }}>
      <ErrorBoundary onError={handleError} translations={errorBoundaryTranslations}>
        <SafeAreaProvider>
          <PostHogProvider>
            <PersistQueryClientProvider
              client={queryClient}
              persistOptions={{
                persister: queryPersister,
                buster: QUERY_CACHE_BUSTER,
                dehydrateOptions: {
                  shouldDehydrateQuery: query => {
                    if (query.state.status !== 'success') return false;
                    // Skip queries whose payloads contain Date instances —
                    // JSON persistence turns them into strings and breaks
                    // consumers that call Date methods on the rehydrated value.
                    const [root, sub] = query.queryKey;
                    if (root === 'court-availability') return false;
                    // Pending-feedback must be re-checked live on every cold
                    // start — a persisted hit would re-open the sheet for a
                    // match the user already submitted feedback on.
                    if (root === 'pendingFeedback') return false;
                    // `matches/justForYou` is now persisted — the custom
                    // serializer round-trips Date instances on its suggestion
                    // slots. `topSuggestions` stays excluded for now (same
                    // Date hazard, no prefetch counterpart yet).
                    if (root === 'matches' && sub === 'topSuggestions') {
                      return false;
                    }
                    // Skip queries whose payloads are Set/Map instances —
                    // JSON serialization turns `new Set([...])` into `{}`,
                    // and consumers calling .has() on the rehydrated value
                    // crash with "undefined is not a function".
                    if (root === 'blockedUserIds' || root === 'favoriteUserIds') return false;
                    // Heavy infinite lists that are always refetched when
                    // their screen opens: chat message pages (50/page per
                    // conversation) and the notification list. Persisting
                    // them bloats every dehydrate/serialize cycle for zero
                    // cold-start benefit. Unread counts stay persisted —
                    // they're tiny and power the badges at launch.
                    if (root === 'chat' && sub === 'messages') return false;
                    if (root === 'notifications' && sub === 'list') return false;
                    return true;
                  },
                },
              }}
            >
              <LocaleProvider>
                <ThemeProvider>
                  <ThemedRoot>
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
                                                  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
                                                  ''
                                                }
                                                merchantIdentifier="merchant.com.mathisl971.rallia-app"
                                              >
                                                <UpdateGate>
                                                  <ConsentGate>
                                                    <AppContent />
                                                  </ConsentGate>
                                                </UpdateGate>
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
                  </ThemedRoot>
                </ThemeProvider>
              </LocaleProvider>
            </PersistQueryClientProvider>
          </PostHogProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
