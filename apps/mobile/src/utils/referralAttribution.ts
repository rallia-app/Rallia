/**
 * Referral Attribution Utilities
 *
 * Handles automatic referral code detection on first app launch:
 * - Android: Parse referral_code from Play Install Referrer
 * - iOS: Fingerprint matching against web invite page visits
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { PENDING_REFERRAL_KEY_EXPORT } from '../screens/InviteReferralScreen';
import { matchReferralFingerprint, Logger } from '@rallia/shared-services';

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

    // Don't override a manually entered code
    const existingCode = await AsyncStorage.getItem(PENDING_REFERRAL_KEY_EXPORT);
    if (existingCode) {
      await AsyncStorage.setItem(ATTRIBUTION_ATTEMPTED_KEY, 'true');
      return;
    }

    let referralCode: string | null = null;

    if (Platform.OS === 'android') {
      referralCode = await getAndroidInstallReferrerCode();
    } else if (Platform.OS === 'ios') {
      referralCode = await getIOSFingerprintMatch(playerId);
    }

    if (referralCode) {
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY_EXPORT, referralCode);
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
 * Android: Parse referral_code from the Play Install Referrer string.
 * The web invite page appends `&referrer=referral_code%3DXXXXXXXX` to the Play Store URL.
 */
async function getAndroidInstallReferrerCode(): Promise<string | null> {
  try {
    const referrer = await Application.getInstallReferrerAsync();
    if (!referrer) return null;

    // Parse "referral_code=XXXXXXXX" from the referrer string
    const params = new URLSearchParams(referrer);
    const code = params.get('referral_code');
    return code || null;
  } catch {
    return null;
  }
}

/**
 * iOS: Compute device fingerprint and match against web invite page visits.
 * Uses the same SHA-256(IP:UserAgent) algorithm as the web page.
 */
async function getIOSFingerprintMatch(playerId: string): Promise<string | null> {
  try {
    // Get public IP
    const ipResponse = await fetch('https://api.ipify.org?format=json');
    const { ip } = await ipResponse.json();
    if (!ip) return null;

    // Build a user agent string matching what the web page would see
    const userAgent = await Constants.getWebViewUserAgentAsync();
    if (!userAgent) return null;

    // Compute fingerprint with same algorithm as web page
    const fingerprint = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${ip}:${userAgent}`
    );

    // Call RPC to match
    const code = await matchReferralFingerprint(fingerprint, ip, playerId);
    return code;
  } catch {
    return null;
  }
}
