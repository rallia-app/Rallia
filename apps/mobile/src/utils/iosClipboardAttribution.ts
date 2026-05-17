/**
 * iOS-only first-launch clipboard attribution handoff.
 *
 * Flow (DIY equivalent of Branch's NativeLink):
 *   1. Web App Store badge click synchronously copies
 *      `rallia_attrib_v1:<signed-token>` to the iOS clipboard.
 *   2. User installs Rallia from the App Store.
 *   3. App opens cold. This util runs from `attemptFirstLaunchAttribution`.
 *   4. We use `Clipboard.hasUrlAsync()` (wraps Apple's
 *      `UIPasteboard.detectPatterns(.probableWebURL)`) which detects a
 *      URL-shaped string *without* triggering the iOS 16+ paste banner.
 *   5. Only if a URL is detected do we read the clipboard via
 *      `getStringAsync()` — this triggers the paste banner exactly once
 *      per install, and only when a probable URL was actually present.
 *   6. If the string is a Rallia attribution token, we POST it to the web
 *      `/api/attribution/verify` endpoint for HMAC + expiry validation.
 *      The server returns the decoded `{did, utm}` payload or 401.
 *   7. Clipboard is cleared to prevent double-attribution on reinstall.
 *
 * The verify endpoint is called server-side (not validated on-device) so
 * the HMAC secret stays out of the app bundle.
 */
import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

import { Logger } from '../services/logger';

const TOKEN_PREFIX = 'rallia_attrib_v1:';
const VERIFY_ENDPOINT = 'https://rallia.app/api/attribution/verify';

export interface AttributionPayload {
  /** PostHog distinct_id from the web visitor. */
  did: string;
  /** UTM/inbound attribution captured on the web at handoff time. */
  utm: Record<string, string>;
  /** Unix ms when the token was minted (already validated to be ≤15min old). */
  ts: number;
}

export async function readClipboardAttribution(): Promise<AttributionPayload | null> {
  if (Platform.OS !== 'ios') return null;

  // Silent pattern detection — no paste banner. Apple guarantees
  // detectPatterns does not surface a user-visible notification.
  let hasUrl: boolean;
  try {
    hasUrl = await Clipboard.hasUrlAsync();
  } catch {
    return null;
  }
  if (!hasUrl) return null;

  // Pattern matched. Reading the clipboard now triggers the one-time
  // "Rallia pasted from Safari" banner — acceptable trade-off for ~95%
  // attribution on cold installs.
  let raw: string;
  try {
    raw = await Clipboard.getStringAsync();
  } catch {
    return null;
  }
  if (!raw.startsWith(TOKEN_PREFIX)) return null;

  // Validate signature + expiry server-side. The HMAC key is server-only.
  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: raw }),
    });
    if (!res.ok) {
      Logger.info('[clipboardAttribution] verify rejected', { status: res.status });
      return null;
    }
    const payload = (await res.json()) as AttributionPayload;
    if (!payload.did) return null;

    // Clear clipboard so subsequent reinstalls or other apps don't
    // re-consume the same token.
    await Clipboard.setStringAsync('').catch(() => {});

    return payload;
  } catch (err) {
    Logger.warn('[clipboardAttribution] verify failed', { error: String(err) });
    return null;
  }
}
