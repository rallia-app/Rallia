'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

import { inferInboundAttribution } from '@/lib/inbound-attribution';
import { writeDistinctIdCookieIfAbsent, writeUtmCookieIfAbsent } from '@/lib/utm-cookie';

/**
 * Mounts once at the root of the app. On the visitor's first landing it
 * captures the inbound attribution (UTM params + paid-ad click IDs +
 * document.referrer fallback), persists a 90-day cookie, fires
 * `deep_link_opened` for landings reporting, and — critically — writes the
 * attribution as PostHog *person properties with set-once semantics*. That
 * sticks the source to the visitor's distinct_id so every subsequent event
 * carries `person.utm_source` etc., which is what makes "where did this
 * unique visitor come from?" queryable across the whole session.
 *
 * The cookie is also flushed to profile.utm_* by PostHogIdentify on the
 * auth'd surfaces — that path is mostly dormant on the marketing site since
 * end-users don't sign in here.
 */
export function UtmCapture() {
  const posthog = usePostHog();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Mirror the PostHog distinct_id into a first-party cookie on every
    // landing. Even visitors with no UTM context get a ph_did cookie — the
    // Smart App Banner and the App Store clipboard handoff both need it.
    // First-touch semantics keep the distinct_id stable across visits.
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

    // Person properties with setOnce semantics. PostHog only writes keys
    // that don't already exist on the person, giving us native first-touch
    // semantics on the (still-anonymous) distinct_id. Once the visitor
    // identifies (via PostHogIdentify on auth'd surfaces) these stick to
    // the user record and are queryable as person.utm_source etc.
    posthog?.setPersonProperties(undefined, attribution);

    posthog?.capture('deep_link_opened', {
      link_type: 'utm',
      first_touch: isFirstTouch,
      ...attribution,
    });
  }, [posthog]);

  return null;
}
