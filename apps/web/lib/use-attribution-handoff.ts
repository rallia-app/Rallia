'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { ReferralContext } from '@/lib/attribution-token';
import { readDistinctIdCookie, readUtmCookie } from '@/lib/utm-cookie';

const PREFIX = 'rallia_attrib_v1:';
const TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 14 * 60 * 1000;

export interface AttributionHandoffOptions {
  /**
   * Optional referral context from the current page (e.g. /invite/{code}
   * yields { code, type, targetId }). When present, the signed token
   * carries it through the clipboard so the mobile app can auto-attribute
   * the referral without the user typing a code in onboarding.
   */
  referral?: ReferralContext;
}

/**
 * Pre-fetches a signed attribution token on mount + on refresh interval,
 * and returns a synchronous `writeClipboard()` to call inside an App Store
 * badge click handler. The synchronous write is critical: iOS Safari only
 * permits clipboard writes inside an active user gesture, so we cannot
 * `await` the server's sign response from within the click handler.
 *
 * Tokens expire 15 minutes after minting; we refresh every 10 minutes and
 * treat anything older than 14 minutes as stale to leave headroom.
 *
 * When called from a deep-link page (`/invite`, `/match`, `/community/join`),
 * pass `options.referral` so the token also carries the invitation context
 * — mobile auto-attributes the referral on first launch via the same
 * AsyncStorage PendingReferral path Android already uses.
 */
export function useAttributionHandoff(options: AttributionHandoffOptions = {}) {
  const tokenRef = useRef<{ value: string; mintedAt: number } | null>(null);
  // Serialize the referral context for stable useEffect deps — passing the
  // object directly would re-fire on every render of the caller.
  const referralKey = options.referral ? JSON.stringify(options.referral) : '';

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const did = readDistinctIdCookie();
    if (!did) return;
    const utm = readUtmCookie() ?? {};
    const referral = referralKey ? (JSON.parse(referralKey) as ReferralContext) : undefined;
    try {
      const res = await fetch('/api/attribution/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, utm, ...(referral ? { referral } : {}) }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { token?: string };
      if (data.token) {
        tokenRef.current = { value: data.token, mintedAt: Date.now() };
      }
    } catch {
      // Best-effort. A failed sign just means clipboard handoff won't fire
      // on the next click — Smart App Banner path still works.
    }
  }, [referralKey]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(() => void refresh(), TOKEN_REFRESH_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [refresh]);

  /**
   * Synchronous clipboard write — must be called from inside a user-gesture
   * handler (onClick) on iOS Safari. Silently no-ops if no token is cached
   * or if the cached token is stale.
   */
  const writeClipboard = useCallback((): void => {
    const cached = tokenRef.current;
    if (!cached) return;
    if (Date.now() - cached.mintedAt > TOKEN_TTL_MS) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    // Fire-and-forget — we don't await because the user is about to be
    // navigated to the App Store. The Promise resolves async but the
    // clipboard write itself happens immediately on iOS Safari.
    void navigator.clipboard.writeText(`${PREFIX}${cached.value}`).catch(() => {});
  }, []);

  return writeClipboard;
}
