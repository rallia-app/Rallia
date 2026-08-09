/**
 * Referral Attribution Utilities
 *
 * Handles automatic attribution capture on first app launch:
 * - Android: Parse referral_code, invitation_type, target_id, ph_did, and
 *   utm_* from the Play Install Referrer string. UTM params get persisted
 *   to UTM_STORAGE_KEY for the post-auth flush in App.tsx; the
 *   PostHog distinct_id from the web visitor goes to WEB_DISTINCT_ID_KEY
 *   so App.tsx can `posthog.alias(webDid)` before `identify(user.id)`.
 * - iOS: Read the clipboard handoff token written by the web's App Store
 *   badge click handler. `Clipboard.hasUrlAsync()` checks silently, then
 *   `getStringAsync()` triggers the one-time paste banner only if a URL
 *   was actually present. Server-side `/api/attribution/verify` validates
 *   HMAC + 15-min expiry.
 *
 * Stores structured PendingReferral data in AsyncStorage for post-signup
 * attribution. The attribution-attempted flag guarantees this only runs
 * once per install.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Logger } from '@rallia/shared-services';
import type { InvitationType } from '@rallia/shared-services';

import {
  PENDING_REFERRAL_KEY,
  type PendingReferral,
  type DeepLinkPayload,
  setPendingDeepLink,
} from '#/navigation/deepLinkStore';

import { readClipboardAttribution } from './iosClipboardAttribution';

const ATTRIBUTION_ATTEMPTED_KEY = 'referral_attribution_attempted';

/** Web visitor's PostHog distinct_id, captured at marketing-site click time
 * and bridged to mobile via either the Android install referrer or the
 * iOS clipboard handoff. Read by App.tsx after auth to call
 * `posthog.alias(webDid)` so pre-install web events merge into the user. */
export const WEB_DISTINCT_ID_KEY = '@rallia/web-distinct-id';

/** UTM params from the web visit. Matches the key already consumed by
 * App.tsx's post-auth flush (kept in sync with apps/mobile/App.tsx). */
const UTM_STORAGE_KEY = '@rallia/utm-params';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export async function attemptFirstLaunchAttribution(): Promise<void> {
  try {
    // Only attempt once per install — both platforms.
    const alreadyAttempted = await AsyncStorage.getItem(ATTRIBUTION_ATTEMPTED_KEY);
    if (alreadyAttempted) return;

    // Don't override a manually entered code (from deep link).
    const existingRaw = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    if (existingRaw) {
      await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true');
      return;
    }

    if (Platform.OS === 'android') {
      await captureAndroidInstallReferrer();
    } else if (Platform.OS === 'ios') {
      await captureIOSClipboardAttribution();
    }

    await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true');
  } catch (error) {
    Logger.warn('[referralAttribution] First launch attribution failed', {
      error: String(error),
    });
    // Mark as attempted to avoid retrying on every launch.
    await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true').catch(() => {});
  }
}

async function captureAndroidInstallReferrer(): Promise<void> {
  const referrer = await Application.getInstallReferrerAsync();
  if (!referrer) return;

  const params = new URLSearchParams(referrer);
  const code = params.get('referral_code');
  const invitationType = params.get('invitation_type') as InvitationType | null;
  const targetId = params.get('target_id');
  const webDistinctId = params.get('ph_did');

  // Persist the web distinct_id so App.tsx can alias post-auth.
  if (webDistinctId) {
    await AsyncStorage.setItem(WEB_DISTINCT_ID_KEY, webDistinctId);
  }

  // Persist UTM keys (matching what App.tsx's post-auth flush reads).
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }
  if (Object.keys(utm).length > 0) {
    await AsyncStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utm));
  }

  // Referral-code branch: full PendingReferral payload, surfaced via the
  // existing deep-link store so onboarding picks it up.
  if (code) {
    const pending: PendingReferral = {
      code,
      type: invitationType || 'referral',
      targetId: targetId || undefined,
    };
    await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pending));
    const payload = toDeepLinkPayload(pending);
    if (payload) setPendingDeepLink(payload);
    return;
  }

  // No referral code but invitation context present (e.g., /join/{code} or
  // /match/{id} via Play Store install referrer).
  if (invitationType && targetId) {
    const pending: PendingReferral = { code: '', type: invitationType, targetId };
    await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pending));
    const payload = toDeepLinkPayload(pending);
    if (payload) setPendingDeepLink(payload);
  }
}

async function captureIOSClipboardAttribution(): Promise<void> {
  const payload = await readClipboardAttribution();
  if (!payload) return;

  await AsyncStorage.setItem(WEB_DISTINCT_ID_KEY, payload.did);
  if (payload.utm && Object.keys(payload.utm).length > 0) {
    await AsyncStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(payload.utm));
  }

  // If the source page was a deep-link landing (/invite, /match,
  // /community/join, /join), the token carries the referral context.
  // Mirror to the same AsyncStorage key Android populates from the Install
  // Referrer string — onboarding's existing PendingReferral consumer picks
  // it up without changes, and setPendingDeepLink fires immediately so
  // Home's listener gets it for already-onboarded users.
  if (payload.referral && (payload.referral.code || payload.referral.targetId)) {
    const pending: PendingReferral = {
      code: payload.referral.code || '',
      type: payload.referral.type || 'referral',
      targetId: payload.referral.targetId,
    };
    await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pending));
    const dpl = toDeepLinkPayload(pending);
    if (dpl) setPendingDeepLink(dpl);
  }
}

function toDeepLinkPayload(referral: PendingReferral): DeepLinkPayload | null {
  if (referral.type === 'group' && referral.targetId)
    return { type: 'group', inviteCode: referral.targetId };
  if (referral.type === 'community' && referral.targetId)
    return { type: 'community', inviteCode: referral.targetId };
  if (referral.type === 'match' && referral.targetId)
    return { type: 'match', matchId: referral.targetId };
  if (referral.code)
    return {
      type: 'invitation',
      referralCode: referral.code,
      invitationType: referral.type,
      targetId: referral.targetId,
      shareToken: referral.shareToken,
      sessionId: referral.sessionId,
    };
  return null;
}
