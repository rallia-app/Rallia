/**
 * Milestone Service
 * The 1000-user milestone campaign: crossing check for the takeover trigger.
 */

import { requireSession } from '../auth';
import { supabase } from '../supabase';

/**
 * True once total profile rows reach 1000 (every signup, onboarding
 * drop-offs included). Polled at launch by the milestone launch prompt while
 * the campaign is pending.
 */
export async function isMilestone1000Reached(): Promise<boolean> {
  // Anon is revoked on this function: without a session it answers 42501.
  await requireSession('milestone_1000_reached');

  const { data, error } = await supabase.rpc('milestone_1000_reached');
  if (error) throw new Error(error.message);
  return data === true;
}
