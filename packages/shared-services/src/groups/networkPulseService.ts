/**
 * Network Pulse Service
 *
 * Wraps the `get_network_pulse` Postgres RPC, which returns the full
 * story-driven payload for the Group/Community Leaderboard tab.
 *
 * The RPC is the single source of truth for the leaderboard tab — one round
 * trip returns headline insight, form strip, your_summary (with sport-specific
 * stats and matchup extremes), the ranked leaderboard, settling-in members,
 * and the four discover-lane data sets.
 */

import { supabase } from '../supabase';
import type { NetworkPulse } from './groupTypes';

/**
 * Fetch the network pulse for a given network/window.
 *
 * @param networkId - id of the group or community
 * @param daysBack  - rolling window in days (default 30)
 */
export async function getNetworkPulse(
  networkId: string,
  daysBack: number = 30
): Promise<NetworkPulse> {
  const { data, error } = await supabase.rpc('get_network_pulse', {
    p_network_id: networkId,
    p_days_back: daysBack,
  });

  if (error) {
    console.error('Error fetching network pulse:', error);
    throw new Error(error.message);
  }

  // The RPC returns a single jsonb object. Supabase may give it back wrapped
  // as either the object directly or a row of one column — normalize.
  const payload = (Array.isArray(data) ? data[0] : data) as NetworkPulse | null;
  if (!payload) {
    throw new Error('get_network_pulse returned no payload');
  }
  return payload;
}
