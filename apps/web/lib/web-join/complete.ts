import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types';

import { joinMatch, leaveMatch, setSupabaseInstance } from '@rallia/shared-services';

/** Defaults when web join skips the preferences step (aligned with mobile onboarding). */
export const DEFAULT_WEB_JOIN_PREFERENCES = {
  playingHand: 'right' as const,
  matchType: 'both' as const,
};

export type WebJoinProfilePayload = {
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  birthDate: string;
  sportId: string;
  ratingScoreId: string;
  postalCode: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  playingHand: 'left' | 'right' | 'both';
  matchType: 'casual' | 'competitive' | 'both';
  locale: string;
};

export type WebJoinResult = {
  joinStatus: 'joined' | 'requested' | 'waitlisted';
  matchId: string;
};

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
  setSupabaseInstance(admin);
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

/**
 * Enforce the one-web-join-per-player cap. Throws WEB_JOIN_LIMIT if the player
 * already joined a DIFFERENT match via the web; re-attempts on the same match
 * are allowed (idempotent). `web_join` is service-role-only and not yet in the
 * generated Database types, hence the cast.
 */
export async function assertWebJoinAllowed(
  admin: SupabaseClient<Database>,
  userId: string,
  matchId: string
): Promise<void> {
  const { data, error } = await (admin as SupabaseClient)
    .from('web_join')
    .select('match_id')
    .eq('player_id', userId)
    .neq('match_id', matchId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check web join limit: ${error.message}`);
  }
  if (data && data.length > 0) {
    throw new Error('WEB_JOIN_LIMIT');
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
  const displayName = `${payload.firstName} ${payload.lastName}`.trim();

  const { error: profileError } = await admin.from('profile').upsert(
    {
      id: userId,
      email,
      first_name: payload.firstName,
      last_name: payload.lastName,
      display_name: displayName,
      birth_date: payload.birthDate,
      preferred_locale: payload.locale === 'fr-CA' ? 'fr-CA' : 'en-US',
      onboarding_completed: true,
      acquisition_channel: 'web_join',
      referral_invitation_type: 'match',
      referral_target_id: matchId,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    throw new Error(`Failed to save profile: ${profileError.message}`);
  }

  const { error: playerError } = await admin.from('player').upsert(
    {
      id: userId,
      gender: payload.gender,
      address: payload.postalCode,
      city: payload.city,
      province: payload.province,
      postal_code: payload.postalCode,
      latitude: payload.latitude,
      longitude: payload.longitude,
      playing_hand: payload.playingHand,
      max_travel_distance: 25,
    },
    { onConflict: 'id' }
  );

  if (playerError) {
    throw new Error(`Failed to save player: ${playerError.message}`);
  }

  const { error: sportError } = await admin.from('player_sport').upsert(
    {
      player_id: userId,
      sport_id: payload.sportId,
      preferred_match_duration: '60',
      preferred_match_type: payload.matchType,
      is_primary: true,
    },
    { onConflict: 'player_id,sport_id' }
  );

  if (sportError) {
    throw new Error(`Failed to save sport preferences: ${sportError.message}`);
  }

  const { error: ratingError } = await admin.from('player_rating_score').upsert(
    {
      player_id: userId,
      rating_score_id: payload.ratingScoreId,
      source: 'self_reported',
      is_certified: false,
    },
    { onConflict: 'player_id,rating_score_id' }
  );

  if (ratingError) {
    throw new Error(`Failed to save rating: ${ratingError.message}`);
  }

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
 * Removes the player from the match. Does NOT touch their web_join record — the
 * one-web-join allowance stays spent, so after leaving they must use the app to
 * join a different match (they can still re-join this same one).
 */
export async function leaveWebJoinMatch(
  admin: SupabaseClient<Database>,
  userId: string,
  matchId: string
): Promise<void> {
  setSupabaseInstance(admin);
  await leaveMatch(matchId, userId);
}
