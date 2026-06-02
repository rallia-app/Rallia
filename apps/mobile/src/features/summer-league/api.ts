/**
 * Summer League interest API.
 *
 * Records a player's interest in the first Rallia Summer League. One row per
 * player — re-taps are idempotent (ON CONFLICT DO NOTHING), so a player who
 * registers from two devices, or taps twice, only ever has a single row.
 *
 * Migration: supabase/migrations/20260602120000_add_summer_league_interest.sql
 */
import { supabase, Logger } from '@rallia/shared-services';

interface RegisterInterestParams {
  /** The current player's id (== auth.uid(), enforced by RLS). */
  playerId: string;
  /** Player UI locale at opt-in time (e.g. 'en-US', 'fr-CA') for localized follow-up. */
  locale?: string;
}

/**
 * Insert the player's interest. Returns `true` on success (including the
 * idempotent no-op when a row already exists), `false` if the write failed.
 */
export async function registerSummerLeagueInterest({
  playerId,
  locale,
}: RegisterInterestParams): Promise<boolean> {
  const { error } = await supabase.from('summer_league_interest').upsert(
    {
      player_id: playerId,
      locale: locale ?? null,
      source: 'mobile_app_popup',
    },
    { onConflict: 'player_id', ignoreDuplicates: true }
  );

  if (error) {
    Logger.error('Failed to register summer league interest', error);
    return false;
  }

  return true;
}
