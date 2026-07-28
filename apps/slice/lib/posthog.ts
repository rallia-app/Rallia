'use client';

import posthog from 'posthog-js';

/**
 * Idempotent PostHog bootstrap.
 *
 * This exists because the funnel's very first event (`page_view`) fires within
 * milliseconds of mount. Relying on a provider component's effect to have run
 * first makes that event's delivery depend on component order — and in the
 * previous host it silently lost every single `page_view`, leaving the funnel
 * with no top-of-funnel denominator. Capturing through `trackSmokeEvent` calls
 * this first, so ordering cannot matter.
 *
 * `persistence: 'memory'` means no cookies and no localStorage, so the page
 * needs no consent banner. Events are joined on the funnel's own `session_id`
 * (see lib/session.ts), not on distinct_id, which memory persistence resets on
 * every page load.
 */

let initialized = false;

export function ensurePostHog(): boolean {
  if (typeof window === 'undefined') return false;
  if (initialized) return true;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;

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

  initialized = true;
  return true;
}
