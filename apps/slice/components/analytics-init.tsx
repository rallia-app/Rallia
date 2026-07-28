'use client';

import { useEffect } from 'react';

import { ensurePostHog } from '@/lib/posthog';

/**
 * Warms PostHog on page load. Not load-bearing: `trackSmokeEvent` initializes
 * on its own if it fires first, and `ensurePostHog` is idempotent.
 */
export function AnalyticsInit() {
  useEffect(() => {
    ensurePostHog();
  }, []);

  return null;
}
