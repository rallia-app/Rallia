/**
 * Unified invite-code join: tries the group RPC first (SECURITY DEFINER, can
 * find any group regardless of RLS visibility), falls back to the community
 * flow on "Invalid invite code". Other group-side errors (e.g. already a
 * member) short-circuit so the caller sees the meaningful message.
 *
 * We can't pre-lookup `network` from PostgREST because the row-level policy
 * only allows authenticated users to see networks they are members of, public
 * communities, or networks they created — group codes for non-members would
 * always read back empty.
 */

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

function isInvalidCode(error: string | undefined): boolean {
  if (!error) return false;
  // Group RPC returns the bare string; community service prefixes a longer message.
  return error === INVALID_CODE_ERROR || error.startsWith('Invalid invite code');
}

export async function joinByInviteCode(
  inviteCode: string,
  playerId: string
): Promise<JoinByInviteCodeResult> {
  const code = inviteCode.toUpperCase();

  const groupResult = await joinGroupByInviteCode(code, playerId);

  if (groupResult.success && groupResult.groupId && groupResult.groupName) {
    return {
      success: true,
      kind: 'group',
      networkId: groupResult.groupId,
      name: groupResult.groupName,
      sportId: groupResult.sportId ?? null,
    };
  }

  // Group RPC failed. If the failure is anything other than "Invalid invite code"
  // (e.g., "You are already a member of this group"), surface it directly —
  // the code clearly belongs to a group and we shouldn't fall through.
  if (!isInvalidCode(groupResult.error)) {
    return { success: false, error: groupResult.error ?? INVALID_CODE_ERROR };
  }

  // Try community path. This also handles rating gates (RATING_TOO_LOW etc.)
  // by returning them inside the result.error string.
  const communityResult = await requestToJoinCommunityByInviteCode(code, playerId);

  if (communityResult.success && communityResult.communityId && communityResult.communityName) {
    return {
      success: true,
      kind: 'community',
      networkId: communityResult.communityId,
      name: communityResult.communityName,
      sportId: communityResult.sportId ?? null,
    };
  }

  return { success: false, error: communityResult.error ?? INVALID_CODE_ERROR };
}
