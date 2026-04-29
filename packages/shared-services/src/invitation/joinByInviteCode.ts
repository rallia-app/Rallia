/**
 * Unified invite-code join: looks up the network by code, dispatches to the
 * appropriate group-join or community-request flow based on network_type.
 */

import { supabase } from '../supabase';
import { joinGroupByInviteCode } from '../groups/groupInviteService';
import { requestToJoinCommunityByInviteCode } from '../communities/communityCrudService';

export type JoinByInviteCodeResult =
  | {
      success: true;
      kind: 'group';
      networkId: string;
      name: string;
      sportId?: string | null;
    }
  | {
      success: true;
      kind: 'community';
      networkId: string;
      name: string;
      sportId?: string | null;
    }
  | { success: false; error: string };

const INVALID_CODE_ERROR = 'Invalid invite code';

export async function joinByInviteCode(
  inviteCode: string,
  playerId: string
): Promise<JoinByInviteCodeResult> {
  const code = inviteCode.toUpperCase();

  const { data, error } = await supabase
    .from('network')
    .select(
      `
      id,
      network_type:network_type_id (name)
    `
    )
    .eq('invite_code', code)
    .single();

  if (error || !data) {
    return { success: false, error: INVALID_CODE_ERROR };
  }

  const networkType = data.network_type as unknown as { name: string } | null;
  const typeName = networkType?.name;

  if (typeName === 'player_group') {
    const result = await joinGroupByInviteCode(code, playerId);
    if (!result.success || !result.groupId || !result.groupName) {
      return { success: false, error: result.error ?? INVALID_CODE_ERROR };
    }
    return {
      success: true,
      kind: 'group',
      networkId: result.groupId,
      name: result.groupName,
      sportId: result.sportId ?? null,
    };
  }

  if (typeName === 'community') {
    const result = await requestToJoinCommunityByInviteCode(code, playerId);
    if (!result.success || !result.communityId || !result.communityName) {
      return { success: false, error: result.error ?? INVALID_CODE_ERROR };
    }
    return {
      success: true,
      kind: 'community',
      networkId: result.communityId,
      name: result.communityName,
      sportId: result.sportId ?? null,
    };
  }

  return { success: false, error: INVALID_CODE_ERROR };
}
