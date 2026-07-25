import { createClient } from '@/lib/supabase/server';

/**
 * The minimum a player record must contain before the app is usable.
 *
 * Deliberately narrow. Anything softer — avatar, bio, availability, favourite
 * facilities — is surfaced by the Home completion banner via
 * `useProfileCompleteness`, not enforced here. Gating on those would trap
 * returning players in a wizard they already finished.
 */
export interface PlayerShellData {
  firstName: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
  /** Sport IDs the player has active, primary first. Empty until onboarding runs. */
  activeSportIds: string[];
  primarySportId: string | null;
  hasLocation: boolean;
  /** The player row's saved location, seed for the client location provider. */
  homeLocation: { latitude: number; longitude: number; postalCode: string | null } | null;
  /** False when any hard requirement is missing, which sends the player to /app/onboarding. */
  isOnboardingComplete: boolean;
}

const EMPTY_SHELL: PlayerShellData = {
  firstName: null,
  displayName: null,
  profilePictureUrl: null,
  activeSportIds: [],
  primarySportId: null,
  hasLocation: false,
  homeLocation: null,
  isOnboardingComplete: false,
};

/**
 * Loads the data the player shell needs and decides whether onboarding is done,
 * in a single parallel round trip so the layout does not waterfall.
 *
 * Errors resolve to "not onboarded" rather than throwing: a transient read failure
 * should land the player on a wizard they can complete, not on an error page.
 */
export async function getPlayerShellData(userId: string): Promise<PlayerShellData> {
  const supabase = await createClient();

  const [profileResult, playerResult, sportsResult] = await Promise.all([
    supabase
      .from('profile')
      .select('first_name, display_name, profile_picture_url')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('player')
      .select('latitude, longitude, postal_code')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('player_sport')
      .select('sport_id, is_primary')
      .eq('player_id', userId)
      .eq('is_active', true),
  ]);

  if (profileResult.error || playerResult.error || sportsResult.error) {
    console.error('Error loading player shell data:', {
      profile: profileResult.error,
      player: playerResult.error,
      sports: sportsResult.error,
    });
    return EMPTY_SHELL;
  }

  const profile = profileResult.data;
  const player = playerResult.data;
  const sports = sportsResult.data ?? [];

  const primarySportId = sports.find(s => s.is_primary)?.sport_id ?? null;
  // Primary first so the sport switcher and any "default sport" read agree.
  const activeSportIds = [
    ...(primarySportId ? [primarySportId] : []),
    ...sports.filter(s => s.sport_id !== primarySportId).map(s => s.sport_id),
  ];

  const hasLocation = player?.latitude != null && player?.longitude != null;
  const homeLocation =
    player?.latitude != null && player?.longitude != null
      ? {
          latitude: player.latitude,
          longitude: player.longitude,
          postalCode: player.postal_code ?? null,
        }
      : null;

  return {
    firstName: profile?.first_name ?? null,
    displayName: profile?.display_name ?? null,
    profilePictureUrl: profile?.profile_picture_url ?? null,
    activeSportIds,
    primarySportId,
    hasLocation,
    homeLocation,
    isOnboardingComplete: Boolean(profile?.first_name) && activeSportIds.length > 0 && hasLocation,
  };
}
