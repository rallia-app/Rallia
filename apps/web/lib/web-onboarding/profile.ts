import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types';

/** Defaults when the web wizard skips the preferences step (aligned with mobile onboarding). */
export const DEFAULT_WEB_ONBOARDING_PREFERENCES = {
  playingHand: 'right' as const,
  matchType: 'both' as const,
};

export type WebOnboardingProfilePayload = {
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  birthDate: string;
  sportId: string;
  ratingScoreId: string;
  postalCode: string;
  /**
   * Street address, when the surface collected one. The join and booking gates do not,
   * so this falls back to the postal code rather than leaving the column empty.
   */
  address?: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  playingHand: 'left' | 'right' | 'both';
  matchType: 'casual' | 'competitive' | 'both';
  locale: string;
};

/**
 * Where the account came from, recorded on the profile for attribution.
 * The referral fields are constrained to real invitation types
 * (profile_referral_invitation_type_check) — omit them for signups that
 * aren't an invitation, like the courts booking gate.
 */
export type WebOnboardingAttribution = {
  acquisitionChannel: string;
  referralInvitationType?: string;
  referralTargetId?: string;
};

/** complete_onboarding() refused: the stable gap codes the client can localize. */
export class OnboardingIncompleteError extends Error {
  readonly code = 'ONBOARDING_INCOMPLETE' as const;
  constructor(readonly missing: string[]) {
    super('ONBOARDING_INCOMPLETE');
    this.name = 'OnboardingIncompleteError';
  }
}

/**
 * The only way web code flips `profile.onboarding_completed`: the RPC re-checks the
 * invariant (postal code, sport, rating, favourites) and refuses with the missing codes.
 */
export async function completeOnboarding(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  const { data, error } = await admin.rpc('complete_onboarding', { p_player_id: userId });
  if (error) throw new Error(`Failed to complete onboarding: ${error.message}`);

  const result = data as { ok?: boolean; missing?: string[] } | null;
  if (!result?.ok) throw new OnboardingIncompleteError(result?.missing ?? []);
}

/**
 * Creates the player records a web signup needs: profile, player, the primary
 * sport, and a self-reported rating. Shared by the /games join gate and the
 * /courts booking gate so both produce identically-shaped accounts.
 *
 * Does NOT mark onboarding complete; callers write favourites, then call
 * `completeOnboarding()`.
 */
export async function writeWebOnboardingProfile(
  admin: SupabaseClient<Database>,
  userId: string,
  email: string,
  payload: WebOnboardingProfilePayload,
  attribution: WebOnboardingAttribution
): Promise<void> {
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
      acquisition_channel: attribution.acquisitionChannel,
      ...(attribution.referralInvitationType
        ? {
            referral_invitation_type: attribution.referralInvitationType,
            referral_target_id: attribution.referralTargetId,
          }
        : {}),
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
      address: payload.address ?? payload.postalCode,
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
}
