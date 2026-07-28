'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';

/**
 * No consent gate and no cookies: `persistence: 'memory'` means analytics set
 * no cookies or localStorage, so the page needs no consent banner. The funnel
 * joins its own events on `session_id` (sessionStorage, see lib/session.ts),
 * not on PostHog's distinct_id, which memory persistence resets on each load.
 */
export function AnalyticsInit() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    posthog.init(key, {
      api_host: '/ingest',
      persistence: 'memory',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: 'identified_only',
    });
  }, []);

  return null;
}
