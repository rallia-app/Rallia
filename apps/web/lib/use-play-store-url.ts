'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect, useState } from 'react';

import type { ReferralContext } from '@/lib/attribution-token';
import { buildPlayStoreUrl, PLAY_STORE_URL } from '@/lib/store-urls';
import { readDistinctIdCookie, readUtmCookie } from '@/lib/utm-cookie';

/**
 * Client-side counterpart of the landing pages' server-built Play Store URLs:
 * returns a Play Store link whose `referrer` param carries the visitor's
 * PostHog distinct_id, first-touch UTM cookie, and optional referral context,
 * so Android installs from generic surfaces (hero badges, download dialogs,
 * web-onboarding wizards) attribute via the Install Referrer API instead of
 * landing bare.
 *
 * SSR-safe: renders the bare URL on the server, upgrades after mount.
 */
export function useAttributedPlayStoreUrl(referral?: ReferralContext): string {
  const posthog = usePostHog();
  const [url, setUrl] = useState<string>(PLAY_STORE_URL);
  // Serialize for stable effect deps — callers pass object literals.
  const referralKey = referral ? JSON.stringify(referral) : '';

  useEffect(() => {
    const ref = referralKey ? (JSON.parse(referralKey) as ReferralContext) : undefined;
    const did = posthog?.get_distinct_id?.() || readDistinctIdCookie() || undefined;
    const utm = readUtmCookie() ?? undefined;
    setUrl(
      buildPlayStoreUrl(ref?.code, ref?.type ?? 'referral', ref?.targetId, {
        webDistinctId: did,
        utm,
      })
    );
  }, [posthog, referralKey]);

  return url;
}
