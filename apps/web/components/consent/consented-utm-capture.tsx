'use client';

import { UtmCapture } from '@/components/utm-capture';

import { useHasMarketingConsent } from './consent-provider';

/**
 * UtmCapture writes the first-touch `rallia_utm` cookie, mirrors PostHog's
 * distinct_id into `ph_did`, and fires `deep_link_opened`. All three are
 * marketing/attribution tracking — gate behind marketing consent.
 */
export function ConsentedUtmCapture() {
  const allowed = useHasMarketingConsent();
  if (!allowed) return null;
  return <UtmCapture />;
}
