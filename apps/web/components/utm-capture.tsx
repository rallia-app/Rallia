'use client';

import { parseUtmParams } from '@rallia/shared-utils';
import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';
import { writeUtmCookieIfAbsent } from '@/lib/utm-cookie';

/**
 * Mounts once at the root of the app. On every page load it reads UTM params
 * from the URL, persists the first set we ever see in a 90-day cookie, and
 * fires `deep_link_opened` so the landing event is attributable in PostHog
 * even before the visitor signs up.
 *
 * The cookie is flushed to PostHog person properties by `PostHogIdentify`
 * once the user authenticates — that's where attribution sticks to the user.
 */
export function UtmCapture() {
  const posthog = usePostHog();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = parseUtmParams(window.location.search);
    if (!params) return;

    const isFirstTouch = writeUtmCookieIfAbsent(params);
    posthog?.capture('deep_link_opened', {
      link_type: 'utm',
      first_touch: isFirstTouch,
      ...params,
    });
  }, [posthog]);

  return null;
}
