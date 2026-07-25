import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types';

import { joinMatch, leaveMatch, setSupabaseInstance } from '@rallia/shared-services';

import {
  DEFAULT_WEB_ONBOARDING_PREFERENCES,
  writeWebOnboardingProfile,
  type WebOnboardingProfilePayload,
} from '@/lib/web-onboarding/profile';

/** Defaults when web join skips the preferences step (aligned with mobile onboarding). */
export const DEFAULT_WEB_JOIN_PREFERENCES = DEFAULT_WEB_ONBOARDING_PREFERENCES;

export type WebJoinProfilePayload = WebOnboardingProfilePayload;

export type WebJoinResult = {
  joinStatus: 'joined' | 'requested' | 'waitlisted';
  matchId: string;
};

/**
 * Installs the service-role client as the shared-services singleton.
 *
 * `joinMatch` / `leaveMatch` are the only shared services that still read the
 * module singleton instead of taking an explicit client the way `checkPlayerBlocked`
 * and friends do — and so do the fire-and-forget `notifyPlayerJoined` /
 * `notifyMatchJoinRequest` calls they make internally. There is no client to pass
 * them, so the singleton has to be set. Do not remove this.
 *
 * Safe because it is the only writer of the server-side global: `SharedSupabaseSync`
 * is browser-guarded, and every other web server consumer of shared-services passes
 * its client explicitly. Concurrent web-join requests all install an equivalent
 * service-role client, so there is nothing to clobber.
 *
 * The global goes away once the notification factory accepts a client.
 */
function installServiceRoleClient(admin: SupabaseClient<Database>): void {
  setSupabaseInstance(admin);
}

/**
 * Joins the match, treating an existing participation as success (idempotent).
 * Without this, re-running the web-join flow for someone already in the match
 * throws "You are already in this match" and the UI surfaces it as an error.
 */
async function resolveJoinStatus(
  admin: SupabaseClient<Database>,
  matchId: string,
  userId: string
): Promise<WebJoinResult['joinStatus']> {
  installServiceRoleClient(admin);
  try {
    const joinResult = await joinMatch(matchId, userId);
    return joinResult.participant.status as WebJoinResult['joinStatus'];
  } catch (err) {
    if (err instanceof Error && err.message === 'You are already in this match') {
      const { data } = await admin
        .from('match_participant')
        .select('status')
        .eq('match_id', matchId)
        .eq('player_id', userId)
        .maybeSingle();

      if (data?.status === 'requested') return 'requested';
      if (data?.status === 'waitlisted') return 'waitlisted';
      return 'joined';
    }
    throw err;
  }
}

/** Record that the player joined this match via the web (idempotent). */
export async function recordWebJoin(
  admin: SupabaseClient<Database>,
  userId: string,
  matchId: string
): Promise<void> {
  await (admin as SupabaseClient)
    .from('web_join')
    .upsert({ player_id: userId, match_id: matchId }, { onConflict: 'player_id,match_id' });
}

export async function completeWebJoinProfile(
  admin: SupabaseClient<Database>,
  userId: string,
  email: string,
  matchId: string,
  payload: WebJoinProfilePayload
): Promise<WebJoinResult> {
  await writeWebOnboardingProfile(admin, userId, email, payload, {
    acquisitionChannel: 'web_join',
    referralInvitationType: 'match',
    referralTargetId: matchId,
  });

  return {
    joinStatus: await resolveJoinStatus(admin, matchId, userId),
    matchId,
  };
}

export async function joinMatchForExistingUser(
  admin: SupabaseClient<Database>,
  userId: string,
  matchId: string
): Promise<WebJoinResult> {
  await admin
    .from('profile')
    .update({
      referral_invitation_type: 'match',
      referral_target_id: matchId,
    })
    .eq('id', userId);

  return {
    joinStatus: await resolveJoinStatus(admin, matchId, userId),
    matchId,
  };
}

/**
 * Removes the player from the match. Leaves the web_join record in place — it's
 * a historical log of web joins, not a gate, so there's nothing to roll back.
 */
export async function leaveWebJoinMatch(
  admin: SupabaseClient<Database>,
  userId: string,
  matchId: string
): Promise<void> {
  installServiceRoleClient(admin);
  await leaveMatch(matchId, userId);
}
