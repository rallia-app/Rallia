'use client';

import { Analytics } from '@vercel/analytics/next';

import { useHasAnalyticsConsent } from './consent-provider';

/**
 * Renders Vercel Web Analytics only when the visitor has granted analytics
 * consent. Unmounting tears down the script tag and stops further pings.
 */
export function ConsentedVercelAnalytics() {
  const allowed = useHasAnalyticsConsent();
  if (!allowed) return null;
  return <Analytics />;
}
