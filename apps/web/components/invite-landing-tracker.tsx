'use client';

import { useEffect } from 'react';

import {
  inviteLandingViewed,
  type InvitationLandingPlatform,
  type InvitationLandingSurface,
  type InvitationLandingType,
} from '@/lib/analytics';

/**
 * Fires `invite_landing_viewed` once on mount with the page context.
 *
 * Server-side `logReferralClick` already records the click in Supabase
 * (`invitation_click`), but this client event joins to the rest of the
 * PostHog session so we can answer "of users who landed on /invite, what
 * fraction tapped a store badge?" — the server-side write can't, since it
 * has no PostHog distinct_id.
 */
export function InviteLandingTracker({
  surface,
  invitationType,
  platform,
  code,
  targetId,
}: {
  surface: InvitationLandingSurface;
  invitationType: InvitationLandingType;
  platform: InvitationLandingPlatform;
  code?: string;
  targetId?: string;
}) {
  useEffect(() => {
    inviteLandingViewed({
      surface,
      invitation_type: invitationType,
      platform,
      ...(code ? { code } : {}),
      ...(targetId ? { target_id: targetId } : {}),
    });
  }, [surface, invitationType, platform, code, targetId]);

  return null;
}
