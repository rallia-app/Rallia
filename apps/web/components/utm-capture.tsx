'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

import { inferInboundAttribution } from '@/lib/inbound-attribution';
import { writeDistinctIdCookieIfAbsent, writeUtmCookieIfAbsent } from '@/lib/utm-cookie';

/**
 * Mounts once at the root of the app. On every landing it:
 *   - Mirrors the PostHog distinct_id into a first-party `ph_did` cookie
 *     (server-side handlers and the App Store clipboard handoff both need
 *     it, and neither can call posthog-js).
 *   - Infers inbound attribution from URL UTM params + paid-ad click IDs +
 *     document.referrer fallback (see inferInboundAttribution).
 *   - Persists the canonical UTM subset to a 90-day first-touch cookie.
 *   - Fires `deep_link_opened` for landings reporting in the admin UI.
 *   - Writes `referrer_host` to PostHog person properties (set-once).
 *
 * ===========================================================================
 * IMPORTANT — PostHog first-touch convention (don't overwrite this!)
 * ===========================================================================
 * PostHog's `defaults: '2026-01-30'` enables `save_campaign_params: true`,
 * which automatically mirrors utm_*, gclid, fbclid, ttclid, msclkid, etc.
 * onto the person record under TWO parallel namespaces on every $pageview:
 *
 *   person.utm_source           = LAST-touch (overwritten every visit)
 *   person.$initial_utm_source  = FIRST-touch (set-once, preserved forever)
 *
 * For unique-visitor first-touch attribution in HogQL queries, ALWAYS use
 * `person.$initial_utm_*`. Querying `person.utm_*` gives last-touch, which
 * is not what you want for marketing source attribution.
 *
 * We deliberately do NOT write utm_*, gclid, fbclid via setPersonProperties
 * here — PostHog's autocapture path writes them through `$set` (overwrite),
 * which would shadow any set-once we'd attempt. The only field we DO write
 * is `referrer_host`, because PostHog doesn't classify document.referrer
 * the way we do (we map facebook.com to 'facebook', l.facebook.com to
 * 'facebook', t.co to 'twitter', etc.).
 *
 * The cookie is also flushed to profile.utm_* by PostHogIdentify on the
 * auth'd surfaces — that path mostly applies to mobile signups (web has
 * no end-user auth on the marketing site).
 */
export function UtmCapture() {
  const posthog = usePostHog();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const did = posthog?.get_distinct_id();
    if (did) writeDistinctIdCookieIfAbsent(did);

    const attribution = inferInboundAttribution(
      window.location.search,
      document.referrer,
      window.location.host
    );
    if (!attribution) return;

    // Cookie holds only the canonical UTM subset (what set_profile_utm
    // accepts). Click IDs and referrer_host live in PostHog only.
    const utmOnly = {
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      utm_term: attribution.utm_term,
    };
    const hasUtm = Object.values(utmOnly).some(v => v != null);
    const isFirstTouch = hasUtm ? writeUtmCookieIfAbsent(utmOnly) : false;

    // Only write fields PostHog doesn't already auto-capture. referrer_host
    // is our custom inference (e.g. "facebook" mapped from l.facebook.com);
    // set-once so a returning visitor's later inference doesn't overwrite.
    if (attribution.referrer_host) {
      posthog?.setPersonProperties(undefined, {
        referrer_host: attribution.referrer_host,
      });
    }

    posthog?.capture('deep_link_opened', {
      link_type: 'utm',
      first_touch: isFirstTouch,
      ...attribution,
    });
  }, [posthog]);

  return null;
}
