/**
 * Referral Attribution Utilities
 *
 * Handles automatic referral code detection on first app launch:
 * - Android: Parse referral_code, invitation_type, target_id from Play Install Referrer
 * - iOS: No automatic attribution. Users enter the referral code manually during
 *   onboarding (PersonalInfoStep / DiscoveryStep). The web invite page displays
 *   the code prominently for that purpose.
 *
 * Stores structured PendingReferral data in AsyncStorage for post-signup attribution.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import {
  PENDING_REFERRAL_KEY,
  type PendingReferral,
  type DeepLinkPayload,
  setPendingDeepLink,
} from '../navigation/deepLinkStore';
import { Logger } from '@rallia/shared-services';
import type { InvitationType } from '@rallia/shared-services';

const ATTRIBUTION_ATTEMPTED_KEY = 'referral_attribution_attempted';

/**
 * Attempt automatic referral attribution on first launch.
 * Safe to call multiple times — only runs once per install.
 *
 * iOS is intentionally a no-op: Apple provides no Install Referrer equivalent,
 * and the previous clipboard + fingerprint workarounds were unreliable and
 * triggered the iOS 16+ "Allow Paste" banner. iOS users enter their code
 * manually in onboarding instead.
 */
export async function attemptFirstLaunchAttribution(_playerId: string): Promise<void> {
  try {
    if (Platform.OS !== 'android') return;

    // Only attempt once per install
    const alreadyAttempted = await AsyncStorage.getItem(ATTRIBUTION_ATTEMPTED_KEY);
    if (alreadyAttempted) return;

    // Don't override a manually entered code (from deep link)
    const existingRaw = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    if (existingRaw) {
      await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true');
      return;
    }

    const pendingReferral = await getAndroidInstallReferrer();

    if (pendingReferral) {
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pendingReferral));
      // Also push to in-memory store so Home's listener fires immediately
      // (avoids race condition for already-onboarded users who reinstall)
      const payload = toDeepLinkPayload(pendingReferral);
      if (payload) setPendingDeepLink(payload);
    }

    await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true');
  } catch (error) {
    Logger.warn('[referralAttribution] First launch attribution failed', {
      error: String(error),
    });
    // Mark as attempted to avoid retrying on every launch
    await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true').catch(() => {});
  }
}

/**
 * Android: Parse referral data from the Play Install Referrer string.
 * The web invite page appends referral_code, invitation_type, and target_id
 * to the Play Store URL's referrer parameter.
 */
async function getAndroidInstallReferrer(): Promise<PendingReferral | null> {
  try {
    const referrer = await Application.getInstallReferrerAsync();
    if (!referrer) return null;

    const params = new URLSearchParams(referrer);
    const code = params.get('referral_code');
    const invitationType = params.get('invitation_type') as InvitationType | null;
    const targetId = params.get('target_id');

    // If we have a referral code, return full referral data
    if (code) {
      return {
        code,
        type: invitationType || 'referral',
        targetId: targetId || undefined,
      };
    }

    // No referral code but invitation context present (e.g., /join/{code} or /match/{id})
    // — still capture the invitation type and target for deferred deep linking
    if (invitationType && targetId) {
      return {
        code: '',
        type: invitationType,
        targetId,
      };
    }

    return null;
  } catch {
    return null;
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
    };
  return null;
}
