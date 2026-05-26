/**
 * useAppVersionGate Hook
 *
 * Reads `public.app_min_version` on launch and tells the caller whether the
 * installed binary is below the platform's minimum supported version. The
 * <UpdateGate> wrapper in App.tsx uses the result to swap the entire app tree
 * for a blocking "Update Required" screen when the user needs to update.
 *
 * Design choices:
 *  - Fail open. Network errors, missing rows, or a check that takes longer
 *    than the safety timeout all resolve to `status: 'ok'` — a Supabase
 *    outage must never lock users out of the app.
 *  - Stale-while-revalidate. The previous result is cached in AsyncStorage
 *    and hydrated synchronously on next launch; the network fetch then
 *    refreshes it in the background. This keeps the gate fast on cold start
 *    and survives short network blips.
 *  - Dev-mode bypass. `__DEV__` returns `ok` immediately without touching
 *    the network — local development should never be gated by a DB row.
 *
 * Mobile-only (uses native modules + AsyncStorage).
 */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { supabase, Logger } from '@rallia/shared-services';

export type AppVersionGateStatus = 'loading' | 'ok' | 'required';

export interface AppVersionGateResult {
  status: AppVersionGateStatus;
  storeUrl: string | null;
  currentVersion: string | null;
  requiredVersion: string | null;
}

interface CachedRow {
  min_supported_version: string;
  store_url: string;
}

const CACHE_KEY = '@rallia/app-min-version-v1';
// If the fetch hasn't completed by this deadline, fail open. Picked to be
// well under the SplashGate's own 5s safety timeout so we don't compound.
const FETCH_TIMEOUT_MS = 3500;

/**
 * Numeric semver compare. Returns negative if a < b, 0 if equal, positive
 * if a > b. Pre-release suffixes (1.2.0-beta.1) are not supported — App
 * Store / Play Store builds always use pure dotted-integer versions.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
  const ap = parse(a);
  const bp = parse(b);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const ai = ap[i] ?? 0;
    const bi = bp[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function getPlatform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

export function useAppVersionGate(): AppVersionGateResult {
  const currentVersion = Application.nativeApplicationVersion;
  const platform = getPlatform();

  // Dev mode + unsupported platforms (e.g. Expo web) short-circuit to ok so
  // they don't sit forever on a loading state.
  const shouldSkip = __DEV__ || !platform || !currentVersion;

  const [state, setState] = useState<AppVersionGateResult>(() => ({
    status: shouldSkip ? 'ok' : 'loading',
    storeUrl: null,
    currentVersion,
    requiredVersion: null,
  }));

  const settledRef = useRef(shouldSkip);

  useEffect(() => {
    if (shouldSkip) return;
    if (!platform || !currentVersion) return;

    let cancelled = false;

    const settle = (next: AppVersionGateResult) => {
      if (cancelled || settledRef.current) return;
      settledRef.current = true;
      setState(next);
    };

    // Safety net — never let the splash hang on a slow Supabase call.
    const timeoutId = setTimeout(() => {
      if (settledRef.current) return;
      Logger.warn('App version gate timed out, failing open');
      settle({ status: 'ok', storeUrl: null, currentVersion, requiredVersion: null });
    }, FETCH_TIMEOUT_MS);

    const evaluate = (row: CachedRow): AppVersionGateResult => {
      const required = row.min_supported_version;
      const isBlocked = compareVersions(currentVersion, required) < 0;
      return {
        status: isBlocked ? 'required' : 'ok',
        storeUrl: row.store_url,
        currentVersion,
        requiredVersion: required,
      };
    };

    // Stale-while-revalidate: use the cached row to decide immediately if we
    // have one, then refresh in the background. The cached decision will be
    // overwritten by the fresh fetch when it completes (or, if a fresh fetch
    // already committed first, the cache read becomes a no-op).
    AsyncStorage.getItem(CACHE_KEY)
      .then(raw => {
        if (cancelled || settledRef.current || !raw) return;
        try {
          const cached = JSON.parse(raw) as CachedRow;
          settle(evaluate(cached));
        } catch {
          // Corrupted cache — ignore and wait for the fresh fetch.
        }
      })
      .catch(() => {});

    // Fresh fetch from Supabase. RLS policy allows anon select.
    (async () => {
      try {
        const { data, error } = await supabase
          .from('app_min_version')
          .select('min_supported_version, store_url')
          .eq('platform', platform)
          .maybeSingle();

        if (cancelled) return;
        if (error || !data) {
          if (error) Logger.warn('App version gate fetch failed', { error });
          // Fail open if we have no cache and the fetch failed.
          if (!settledRef.current) {
            settle({ status: 'ok', storeUrl: null, currentVersion, requiredVersion: null });
          }
          return;
        }

        const row: CachedRow = {
          min_supported_version: data.min_supported_version,
          store_url: data.store_url,
        };
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(row)).catch(() => {});

        // Allow the fresh fetch to override an earlier cache-based decision —
        // the cached row could be stale (we may have bumped min_version since
        // the user's last launch).
        settledRef.current = false;
        settle(evaluate(row));
      } catch (e) {
        if (cancelled) return;
        Logger.warn('App version gate unexpected error', { error: e });
        if (!settledRef.current) {
          settle({ status: 'ok', storeUrl: null, currentVersion, requiredVersion: null });
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [shouldSkip, platform, currentVersion]);

  return state;
}
