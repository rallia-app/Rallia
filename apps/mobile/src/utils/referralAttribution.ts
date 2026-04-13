/**
 * Referral Attribution Utilities
 *
 * Handles automatic referral code detection on first app launch:
 * - Android: Parse referral_code, invitation_type, target_id from Play Install Referrer
 * - iOS: Fingerprint matching against web invite page visits (returns structured data)
 *
 * Stores structured PendingReferral data in AsyncStorage for post-signup attribution.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { PENDING_REFERRAL_KEY } from '../screens/InvitationDeepLinkScreen';
import type { PendingReferral } from '../screens/InvitationDeepLinkScreen';
import { matchReferralFingerprint, Logger } from '@rallia/shared-services';
import type { InvitationType } from '@rallia/shared-services';

const ATTRIBUTION_ATTEMPTED_KEY = 'referral_attribution_attempted';

/**
 * Attempt automatic referral attribution on first launch.
 * Safe to call multiple times — only runs once per install.
 */
export async function attemptFirstLaunchAttribution(playerId: string): Promise<void> {
  try {
    // Only attempt once per install
    const alreadyAttempted = await AsyncStorage.getItem(ATTRIBUTION_ATTEMPTED_KEY);
    if (alreadyAttempted) return;

    // Don't override a manually entered code (from deep link)
    const existingRaw = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    if (existingRaw) {
      await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true');
      return;
    }

    let pendingReferral: PendingReferral | null = null;

    if (Platform.OS === 'android') {
      pendingReferral = await getAndroidInstallReferrer();
    } else if (Platform.OS === 'ios') {
      pendingReferral = await getIOSFingerprintMatch(playerId);
    }

    if (pendingReferral) {
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify(pendingReferral));
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
    if (!code) return null;

    const invitationType = params.get('invitation_type') as InvitationType | null;
    const targetId = params.get('target_id');

    return {
      code,
      type: invitationType || 'referral',
      targetId: targetId || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * iOS: Compute device fingerprint and match against web invite page visits.
 * Uses the same SHA-256(IP:UserAgent) algorithm as the web page.
 * Returns structured data including invitation type and target ID.
 */
async function getIOSFingerprintMatch(playerId: string): Promise<PendingReferral | null> {
  try {
    // Get public IP
    const ipResponse = await fetch('https://api.ipify.org?format=json');
    const { ip } = await ipResponse.json();
    if (!ip) return null;

    // Build a user agent string matching what the web page would see
    const userAgent = await Constants.getWebViewUserAgentAsync();
    if (!userAgent) return null;

    // Extract stable device traits that match across Safari and WebView UAs
    // Both contain e.g. "iPhone; CPU iPhone OS 19_0 like Mac OS X"
    const traitsMatch = userAgent.match(/(iPhone|iPad|iPod);[^)]+like Mac OS X/);
    const traits = traitsMatch ? traitsMatch[0] : userAgent;

    // Compute fingerprint with same algorithm as web page
    const fingerprint = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${ip}:${traits}`
    );

    // Call RPC to match — now returns structured data
    const result = await matchReferralFingerprint(fingerprint, ip, playerId);
    if (!result) return null;

    return {
      code: result.code,
      type: result.invitation_type,
      targetId: result.target_id,
    };
  } catch {
    return null;
  }
}
