/**
 * Onboarding gaps (specs/01-authentication/onboarding-minimum.md, "Repair").
 * Read-only mirror of complete_onboarding(): which invariant pieces a player
 * still lacks, as stable codes the clients localize.
 */

import { requireSession } from '../auth';
import { supabase } from '../supabase';
import { Logger } from '../logger';

/**
 * Codes: 'postal_code' | 'sport' | 'rating:<sport_id>' | 'favorites:<sport_id>'.
 * No playerId = the signed-in player.
 */
export async function getOnboardingGaps(playerId?: string | null): Promise<string[]> {
  // Anon is revoked on this function: without a session it answers 42501.
  await requireSession('get_onboarding_gaps');

  const { data, error } = await supabase.rpc('get_onboarding_gaps', {
    p_player_id: playerId ?? undefined,
  });

  if (error) {
    Logger.error('Failed to load onboarding gaps', error, { playerId: playerId ?? 'self' });
    throw new Error(`Failed to load onboarding gaps: ${error.message}`);
  }

  return (data as string[] | null) ?? [];
}
