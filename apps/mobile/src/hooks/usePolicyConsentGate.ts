/**
 * usePolicyConsentGate Hook
 *
 * Reads which policy_type(s) (privacy/terms) the signed-in user has not yet
 * accepted at the currently-required version, via get_pending_policy_consents().
 * The <ConsentGate> wrapper in App.tsx uses the result to swap the app tree
 * for a blocking re-consent screen when anything is pending.
 *
 * Design mirrors useAppVersionGate:
 *  - Fail open. Any error/timeout resolves to `status: 'ok'` — a Supabase
 *    outage must never lock users out of the app.
 *  - Stale-while-revalidate via an AsyncStorage cache (per-user, since this
 *    check is inherently post-auth — unlike the version gate's platform-scoped
 *    cache key).
 *  - No session or __DEV__ short-circuits to 'ok' immediately.
 *
 * `recheck()` lets the gate screen re-evaluate right after a successful
 * accept, without requiring an app restart.
 *
 * Mobile-only (uses AsyncStorage).
 */

import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPendingPolicyConsents,
  Logger,
  type PendingPolicyConsent,
} from '@rallia/shared-services';

export type PolicyConsentGateStatus = 'loading' | 'ok' | 'required';

export interface PolicyConsentGateResult {
  status: PolicyConsentGateStatus;
  pending: PendingPolicyConsent[];
  recheck: () => void;
}

const CACHE_KEY_PREFIX = '@rallia/pending-policy-consents-v1:';
// Well under SplashGate's own 5s safety timeout so we don't compound.
const FETCH_TIMEOUT_MS = 3500;

export function usePolicyConsentGate(userId: string | null | undefined): PolicyConsentGateResult {
  // Unlike useAppVersionGate, there's no dev-mode bypass here: skipping in
  // __DEV__ would mean this gate could never be exercised in a dev build,
  // which is exactly where it needs to be tested. Only guests (no session)
  // are skipped — there's nothing for them to have consented to yet.
  const shouldSkip = !userId;

  const [state, setState] = useState<{
    status: PolicyConsentGateStatus;
    pending: PendingPolicyConsent[];
  }>(() => ({ status: shouldSkip ? 'ok' : 'loading', pending: [] }));
  const settledRef = useRef(shouldSkip);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (shouldSkip) {
      settledRef.current = true;
      setState({ status: 'ok', pending: [] });
      return;
    }

    // On recheck (post-accept), keep the current screen mounted and skip the
    // stale cache — it still lists the just-accepted policies, and repainting
    // from it would flash the gate (and the app tree behind it) needlessly.
    const isRecheck = nonce > 0;
    settledRef.current = false;
    if (!isRecheck) setState({ status: 'loading', pending: [] });

    let cancelled = false;
    const cacheKey = `${CACHE_KEY_PREFIX}${userId}`;

    const settle = (next: { status: PolicyConsentGateStatus; pending: PendingPolicyConsent[] }) => {
      if (cancelled || settledRef.current) return;
      settledRef.current = true;
      setState(next);
    };

    const timeoutId = setTimeout(() => {
      if (settledRef.current) return;
      Logger.warn('Policy consent gate timed out, failing open');
      settle({ status: 'ok', pending: [] });
    }, FETCH_TIMEOUT_MS);

    // Stale-while-revalidate: paint from cache immediately, then let the
    // fresh fetch below override it (whichever it decides) once it lands.
    AsyncStorage.getItem(cacheKey)
      .then(raw => {
        if (cancelled || settledRef.current || !raw || isRecheck) return;
        try {
          const cached = JSON.parse(raw) as PendingPolicyConsent[];
          settle({ status: cached.length > 0 ? 'required' : 'ok', pending: cached });
        } catch {
          // Corrupted cache — ignore and wait for the fresh fetch.
        }
      })
      .catch(() => {});

    (async () => {
      try {
        const pending = await getPendingPolicyConsents();
        if (cancelled) return;
        AsyncStorage.setItem(cacheKey, JSON.stringify(pending)).catch(() => {});
        settledRef.current = false; // allow the fresh result to override a cache-based decision
        settle({ status: pending.length > 0 ? 'required' : 'ok', pending });
      } catch (e) {
        if (cancelled) return;
        Logger.warn('Policy consent gate fetch failed, failing open', { error: e });
        if (!settledRef.current) settle({ status: 'ok', pending: [] });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [shouldSkip, userId, nonce]);

  return {
    ...state,
    recheck: () => setNonce(n => n + 1),
  };
}
