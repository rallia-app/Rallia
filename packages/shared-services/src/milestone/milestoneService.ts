/**
 * Milestone Service
 * The 1000-user milestone campaign: crossing check for the takeover trigger.
 */

import { supabase } from '../supabase';

/**
 * True once total profile rows reach 1000 (every signup, onboarding
 * drop-offs included). Polled at launch by the milestone launch prompt while
 * the campaign is pending.
 */
export async function isMilestone1000Reached(): Promise<boolean> {
  const { data, error } = await supabase.rpc('milestone_1000_reached');
  if (error) throw new Error(error.message);
  return data === true;
}
