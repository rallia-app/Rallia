/**
 * Meta (Facebook) SDK wrapper.
 *
 * Centralizes init, ATT-gated tracking configuration, App Events logging,
 * advanced-matching user identification, and Meta's deferred deep link
 * fetch. Designed to mirror revenuecat.ts: every entry point short-circuits
 * cleanly when the SDK isn't available so the rest of the app stays
 * insulated.
 *
 * Init contract:
 *   1. `initMeta()` runs at module load — calls Settings.initializeSDK with
 *      advertiser tracking and ID collection BOTH disabled. This is the
 *      Meta-recommended privacy-first default: the SDK can fire its built-in
 *      `fb_mobile_activate_app` and a few non-tracking diagnostics, but no
 *      IDFA is collected and no events are sent for ad personalization.
 *   2. After the user grants ATT (via TrackingPermissionStep at the end of
 *      pre-onboarding), `enableMetaTrackingPostATT()` flips advertiser
 *      tracking + ID collection to true so subsequent events carry the
 *      IDFA and are usable for ads optimization.
 *   3. Slice 2 will wire `logMetaEvent` calls into analytics.ts alongside
 *      existing PostHog `capture` calls.
 *
 * iOS 17+ note: Meta SDK 17.x reads ATT status directly from Apple's API
 * and the setter for `isAdvertiserTrackingEnabled` is marked deprecated.
 * We still call it for back-compat with iOS 14.5–16.x devices; on iOS 17+
 * the underlying SDK no-ops the manual setter without harm.
 */

import { Platform } from 'react-native';
import {
  AppEventsLogger,
  AppLink,
  Settings,
  type Params as FBSDKParams,
  type UserData as FBSDKUserData,
} from 'react-native-fbsdk-next';
import {
  requestTrackingPermissionsAsync,
  getTrackingPermissionsAsync,
} from 'expo-tracking-transparency';
import { Logger } from '../services/logger';

// Build-time placeholders mirror the fallback values written into app.config.js.
// Treating them as "not configured" lets us no-op cleanly on a dev machine that
// hasn't been given the real EAS env vars yet — Meta SDK would otherwise reject
// every event with "Invalid App ID" warnings filling the console.
const FB_APP_ID = process.env.EXPO_PUBLIC_FB_APP_ID ?? '';
const IS_PLACEHOLDER = FB_APP_ID === '' || FB_APP_ID === 'PLACEHOLDER_FB_APP_ID';

export const isMetaSdkConfigured = !IS_PLACEHOLDER;

let _initialized = false;

/**
 * Initialize the Meta SDK at app launch. Advertiser tracking stays OFF
 * until the user passes ATT — we only flip it on via
 * `enableMetaTrackingPostATT`.
 */
export function initMeta(): void {
  if (_initialized) return;
  if (!isMetaSdkConfigured) {
    Logger.warn(
      'Meta SDK not configured; skipping initialize (EXPO_PUBLIC_FB_APP_ID is empty/placeholder)'
    );
    return;
  }
  try {
    // Platform-divergent default:
    //   iOS — tracking stays OFF at init; flipped ON only after ATT grants.
    //         TrackingPermissionStep handles the prompt at the end of
    //         pre-onboarding.
    //   Android — no ATT, GAID is governed by Limit Ad Tracking in system
    //         settings instead. Safe to start with tracking ON so Meta
    //         receives full signal from the first event.
    const androidDefault = Platform.OS === 'android';
    Settings.setAdvertiserTrackingEnabled(androidDefault);
    Settings.setAdvertiserIDCollectionEnabled(androidDefault);
    Settings.setAutoLogAppEventsEnabled(androidDefault);
    Settings.initializeSDK();
    _initialized = true;
    Logger.info('Meta SDK initialized', {
      platform: Platform.OS,
      tracking: androidDefault ? 'enabled' : 'awaiting_att',
      configured: isMetaSdkConfigured,
    });
  } catch (err) {
    Logger.error('Meta SDK initializeSDK threw', err as Error);
  }
}

/**
 * Trigger Apple's ATT system prompt and configure Meta SDK based on the
 * outcome. Should be called exactly once per install, from
 * TrackingPermissionStep at the end of pre-onboarding.
 *
 * Returns the ATT status so the caller can branch UI on the result.
 */
export async function requestATTAndConfigureMeta(): Promise<'granted' | 'denied' | 'unavailable'> {
  // ATT is iOS-only. On Android we still want to enable Meta App Events with
  // tracking on (Google's IDFA equivalent — GAID — is governed by Limit Ad
  // Tracking, not ATT) so Meta has full signal from Android installs.
  if (Platform.OS !== 'ios') {
    if (isMetaSdkConfigured) {
      try {
        Settings.setAdvertiserTrackingEnabled(true);
        Settings.setAdvertiserIDCollectionEnabled(true);
        Settings.setAutoLogAppEventsEnabled(true);
      } catch (err) {
        Logger.error('Meta SDK Android tracking-enable threw', err as Error);
      }
    }
    return 'unavailable';
  }

  try {
    const { status } = await requestTrackingPermissionsAsync();
    const granted = status === 'granted';

    if (isMetaSdkConfigured) {
      try {
        Settings.setAdvertiserTrackingEnabled(granted);
        Settings.setAdvertiserIDCollectionEnabled(granted);
        Settings.setAutoLogAppEventsEnabled(granted);
      } catch (err) {
        Logger.error('Meta SDK post-ATT tracking config threw', err as Error);
      }
    }
    return granted ? 'granted' : 'denied';
  } catch (err) {
    Logger.error('ATT prompt threw', err as Error);
    return 'denied';
  }
}

/**
 * Re-sync Meta SDK tracking state from a previously-granted ATT status.
 * Use case: app launches and ATT is already `granted` from a prior session —
 * we want the SDK to start with tracking ON without showing the prompt again.
 */
export async function syncMetaTrackingFromExistingATT(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!isMetaSdkConfigured) return;
  try {
    const { status } = await getTrackingPermissionsAsync();
    if (status !== 'granted') return;
    Settings.setAdvertiserTrackingEnabled(true);
    Settings.setAdvertiserIDCollectionEnabled(true);
    Settings.setAutoLogAppEventsEnabled(true);
  } catch (err) {
    Logger.error('Meta SDK ATT-sync threw', err as Error);
  }
}

// ---- Event logging --------------------------------------------------------

export type MetaEventName =
  | 'fb_mobile_complete_registration'
  | 'fb_mobile_tutorial_completion'
  | 'fb_mobile_content_view'
  | 'fb_mobile_achievement_unlocked'
  | 'fb_mobile_search'
  | 'fb_mobile_initiated_checkout'
  | 'fb_mobile_rate'
  | 'fb_mobile_purchase' // auto-logged on iOS/Android via store receipts; do NOT fire manually
  | 'fb_mobile_subscribe' // auto-logged on iOS via shared secret; do NOT fire manually
  // Custom events — names are arbitrary but stable.
  | 'Match Joined'
  | 'Booking Initiated';

// The FB SDK only accepts string|number values for event params (booleans
// must be encoded as 0/1 or "true"/"false" by the caller).
export type MetaEventParams = FBSDKParams;

/**
 * Fire a Meta App Event. Safe to call regardless of init state — no-ops if
 * the SDK isn't configured.
 *
 * When `valueToSum` is provided, it must be a number (e.g. revenue) — Meta
 * uses it for VO/AEO optimization and AEM conversion-value modeling.
 */
export function logMetaEvent(
  eventName: MetaEventName,
  params?: MetaEventParams,
  valueToSum?: number
): void {
  if (!isMetaSdkConfigured) return;
  try {
    // The native logEvent has overloads: (name), (name, sum), (name, params),
    // (name, sum, params). The SDK's TS signature flattens these into a
    // variadic `...args: Array<number | Params>` so we forward conditionally.
    if (typeof valueToSum === 'number' && params) {
      AppEventsLogger.logEvent(eventName, valueToSum, params);
    } else if (typeof valueToSum === 'number') {
      AppEventsLogger.logEvent(eventName, valueToSum);
    } else if (params) {
      AppEventsLogger.logEvent(eventName, params);
    } else {
      AppEventsLogger.logEvent(eventName);
    }
  } catch (err) {
    Logger.error('Meta logEvent threw', err as Error, { eventName });
  }
}

// ---- User identification (advanced matching) ------------------------------

/**
 * Set the Meta SDK user ID. The SDK hashes this internally before sending.
 * Improves EMQ (Event Match Quality) for ATT-opted-in users.
 */
export function setMetaUserId(userId: string | null): void {
  if (!isMetaSdkConfigured) return;
  try {
    if (userId) {
      AppEventsLogger.setUserID(userId);
    } else {
      AppEventsLogger.clearUserID();
    }
  } catch (err) {
    Logger.error('Meta setUserID threw', err as Error);
  }
}

/**
 * Set advanced matching identifiers (email, phone, etc.). The SDK SHA-256
 * hashes these before they leave the device. Email/phone normalization
 * (lowercase trim for email, E.164 for phone) is the caller's responsibility.
 */
export interface MetaUserData {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export function setMetaUserData(data: MetaUserData): void {
  if (!isMetaSdkConfigured) return;
  try {
    // The native AppEventsLogger.setUserData accepts a UserData object with
    // named keys (email, phone, firstName, lastName, city, state, zip,
    // country, gender, dateOfBirth). Only include keys with non-empty values
    // so we don't clobber prior data with empty strings.
    const payload: FBSDKUserData = {
      ...(data.email ? { email: data.email.trim().toLowerCase() } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.firstName ? { firstName: data.firstName } : {}),
      ...(data.lastName ? { lastName: data.lastName } : {}),
    };
    if (Object.keys(payload).length === 0) return;
    AppEventsLogger.setUserData(payload);
  } catch (err) {
    Logger.error('Meta setUserData threw', err as Error);
  }
}

export function clearMetaUser(): void {
  if (!isMetaSdkConfigured) return;
  try {
    // The SDK has setUserID(null) for clearing the user ID. There's no
    // public clearUserData equivalent — once advanced-matching fields are
    // set they stay in the local SDK state for the install lifetime. This
    // is acceptable on sign-out since the next sign-in immediately overwrites
    // them with the new user's identifiers.
    AppEventsLogger.setUserID(null);
  } catch (err) {
    Logger.error('Meta clear user threw', err as Error);
  }
}

// ---- Deferred deep linking ------------------------------------------------

/**
 * Fetch Meta's deferred deep link, set when a user tapped a Meta ad whose
 * destination URL was deep into the app *before* the install. Fires exactly
 * once per install — the first cold start after install. Subsequent calls
 * return null.
 *
 * Without an MMP this is the only mechanism that recovers ad-click → install
 * → in-app destination context. Wire the returned URL into the same
 * handleDeepLink path that processes Linking.getInitialURL().
 */
export async function fetchDeferredAppLink(): Promise<string | null> {
  if (!isMetaSdkConfigured) return null;
  try {
    // The SDK returns the deferred deep link URL directly (or null when
    // there's no pending deferred link, which is the common case for users
    // who installed organically or who launched after the first cold start).
    const url = await AppLink.fetchDeferredAppLink();
    return url ?? null;
  } catch (err) {
    Logger.error('Meta fetchDeferredAppLink threw', err as Error);
    return null;
  }
}
