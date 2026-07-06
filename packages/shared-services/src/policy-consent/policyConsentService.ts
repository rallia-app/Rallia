/**
 * Policy Consent Service
 *
 * Wraps the versioned privacy-policy/terms-of-use consent RPCs. Used both by
 * the onboarding wizard's consent step (new signups) and the mobile-only
 * re-consent gate (existing users, on a policy_versions bump) — one shared
 * write path so both flows stay in sync.
 */

import type { Tables } from '@rallia/shared-types';
import { supabase } from '../supabase';

export type PlayerConsent = Tables<'player_consent'>;
export type PolicyType = 'privacy' | 'terms';

export interface PendingPolicyConsent {
  policy_type: PolicyType;
  current_version: number;
}

export async function getPendingPolicyConsents(): Promise<PendingPolicyConsent[]> {
  const { data, error } = await supabase.rpc('get_pending_policy_consents');
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingPolicyConsent[];
}

export async function acceptPolicyConsent(
  policyType: PolicyType,
  version: number
): Promise<PlayerConsent> {
  const { data, error } = await supabase.rpc('accept_policy_consent', {
    p_policy_type: policyType,
    p_version: version,
  });
  if (error) throw new Error(error.message);
  return data as PlayerConsent;
}
