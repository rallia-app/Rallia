/**
 * Analytics for the /find-a-match willingness-to-pay smoke test.
 *
 * The brief defines a fixed 9-event funnel where EVERY event carries the same
 * segmentation attributes, so results can be sliced by A/B variant and by
 * segment (sport, city, language) without any retreatment. `trackSmokeEvent`
 * merges that base context into each capture and stamps `horodatage` at emit
 * time. Names are the brief's canonical names (page_view … test_reveal_shown);
 * note `page_view` here is a custom event, distinct from PostHog's `$pageview`.
 *
 * SSR-safe: no-op on the server (posthog-js is browser-only).
 */

import posthog from 'posthog-js';

import type { MatchPlanTier, SportOption, ValuePropVariant } from './constants';
import { ensurePostHog } from './posthog';

export type SmokeEventName =
  | 'page_view'
  | 'value_prop_click'
  | 'preferences_completed'
  | 'courts_viewed'
  | 'liquidity_viewed'
  | 'contact_submitted'
  | 'pricing_viewed'
  | 'plan_selected'
  | 'payment_intent_click'
  | 'test_reveal_shown';

/** The attributes joined to every smoke-test event (brief §4.3). */
export interface SmokeEventContext {
  test_id: string;
  /** Funnel revision (v3.2 = fixed pricing, no price A/B) — cohort fence. */
  funnel_version: string;
  variant_valueprop: ValuePropVariant;
  sport: SportOption | null;
  ville: string | null;
  langue: 'fr' | 'en';
  forfait: MatchPlanTier | null;
  session_id: string;
}

export function trackSmokeEvent(
  event: SmokeEventName,
  context: SmokeEventContext,
  extra?: Record<string, unknown>
): void {
  // Initialize on first capture rather than trusting a provider's effect to
  // have run: `page_view` fires on mount and would otherwise be dropped.
  if (!ensurePostHog()) return;
  posthog.capture(event, {
    ...context,
    horodatage: new Date().toISOString(),
    ...extra,
  });
}
