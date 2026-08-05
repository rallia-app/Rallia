'use client';

import { useEffect, useMemo, useState } from 'react';
import type { UtmParams } from '@rallia/shared-utils';

import { inviteLandingViewed } from '@/lib/analytics';
import { buildPlayStoreUrl, detectPlatform } from '@/lib/store-urls';
import { readDistinctIdCookie, readUtmCookie } from '@/lib/utm-cookie';
import { TrackedStoreBadges } from '@/components/tracked-store-badges';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/**
 * Per-visitor logic for the match landing page, moved client-side so the
 * page itself can be ISR-cached: platform detection, the Android
 * redirect-to-Play-Store, click logging (via /api/referral-click) and the
 * attribution payload on the store badges. Current-touch URL UTMs win over
 * the first-touch cookie, mirroring the old server-side getLandingContext.
 */
export function MatchLandingClient({
  matchId,
  appStoreLabel,
  playStoreLabel,
}: {
  matchId: string;
  appStoreLabel: string;
  playStoreLabel: string;
}) {
  const [platform, setPlatform] = useState<'ios' | 'android' | null>(null);
  const [attribution, setAttribution] = useState<{
    webDistinctId?: string;
    utm?: UtmParams;
  }>({});

  useEffect(() => {
    const detected = detectPlatform(navigator.userAgent);

    const urlUtm: UtmParams = {};
    const search = new URLSearchParams(window.location.search);
    for (const key of UTM_KEYS) {
      const value = search.get(key);
      if (value) urlUtm[key] = value;
    }
    const utm = { ...(readUtmCookie() ?? {}), ...urlUtm };
    const webDistinctId = readDistinctIdCookie() ?? undefined;
    const extras = {
      webDistinctId,
      utm: Object.keys(utm).length > 0 ? utm : undefined,
    };

    setPlatform(detected);
    setAttribution(extras);

    inviteLandingViewed({
      surface: 'match',
      invitation_type: 'match',
      platform: detected ?? 'desktop',
      target_id: matchId,
    });

    fetch('/api/referral-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitationType: 'match',
        targetId: matchId,
        webDistinctId,
        utm: extras.utm,
      }),
      keepalive: true,
    }).catch(() => {});

    if (detected === 'android') {
      window.location.replace(buildPlayStoreUrl(undefined, 'match', matchId, extras));
    }
  }, [matchId]);

  const playStoreUrl = useMemo(
    () => buildPlayStoreUrl(undefined, 'match', matchId, attribution),
    [matchId, attribution]
  );

  return (
    <TrackedStoreBadges
      placement="match_page"
      playStoreUrl={playStoreUrl}
      hidePlayStore={platform === 'ios'}
      appStoreLabel={appStoreLabel}
      playStoreLabel={playStoreLabel}
      matchId={matchId}
      referral={{ type: 'match', targetId: matchId }}
    />
  );
}
