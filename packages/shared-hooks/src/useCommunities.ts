/**
 * useCommunities Hook
 * React Query hooks for managing communities
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  // CRUD operations
  getPublicCommunities,
  getPlayerCommunities,
  getCommunity,
  getCommunityWithMembers,
  createCommunity,
  updateCommunity,
  deleteCommunity,
  isCommunityMember,
  isCommunityModerator,
  getCommunityMembershipStatus,
  checkCommunityAccess,
  // Membership operations
  requestToJoinCommunity,
  requestToJoinCommunityByInviteCode,
  referPlayerToCommunity,
  approveCommunityMember,
  rejectCommunityMember,
  getPendingCommunityMembers,
  leaveCommunity,
  addCommunityMember,
  removeCommunityMember,
  promoteCommunityMember,
  demoteCommunityMember,
  // Realtime
  subscribeToPlayerCommunities,
  subscribeToPublicCommunities,
  subscribeToCommunityMembers,
  subscribeToCommunityActivity,
  subscribeToCommunitySettings,
  subscribeToPendingRequests,
  unsubscribeFromCommunityChannel,
  // Types
  type Community,
  type CommunityWithStatus,
  type CommunityWithMembers,
  type CommunityMember,
  type CreateCommunityInput,
  type UpdateCommunityInput,
  type PendingMemberRequest,
} from '@rallia/shared-services';

// Query Keys
export const communityKeys = {
  all: ['communities'] as const,
  lists: () => [...communityKeys.all, 'list'] as const,
  publicCommunities: (playerId?: string) => [...communityKeys.lists(), 'public', playerId] as const,
  playerCommunities: (playerId: string) => [...communityKeys.lists(), 'player', playerId] as const,
  details: () => [...communityKeys.all, 'detail'] as const,
  detail: (communityId: string) => [...communityKeys.details(), communityId] as const,
  withMembers: (communityId: string) => [...communityKeys.detail(communityId), 'members'] as const,
  isModerator: (communityId: string, playerId: string) =>
    [...communityKeys.detail(communityId), 'moderator', playerId] as const,
  isMember: (communityId: string, playerId: string) =>
    [...communityKeys.detail(communityId), 'member', playerId] as const,
  membershipStatus: (communityId: string, playerId: string) =>
    [...communityKeys.detail(communityId), 'status', playerId] as const,
  access: (communityId: string, playerId?: string) =>
    [...communityKeys.detail(communityId), 'access', playerId] as const,
  pendingRequests: (communityId: string) =>
    [...communityKeys.detail(communityId), 'pending'] as const,
};

// =============================================================================
// QUERY HOOKS
// =============================================================================

/**
 * Get all public communities for discovery
 */
export function usePublicCommunities(playerId?: string) {
  return useQuery({
    queryKey: communityKeys.publicCommunities(playerId),
    queryFn: () => getPublicCommunities(playerId),
  });
}

/**
 * Get all communities for the current player
 */
export function usePlayerCommunities(playerId: string | undefined) {
  return useQuery({
    queryKey: communityKeys.playerCommunities(playerId || ''),
    queryFn: () => getPlayerCommunities(playerId!),
    enabled: !!playerId,
  });
}

/**
 * Get a single community by ID
 */
export function useCommunity(communityId: string | undefined) {
  return useQuery({
    queryKey: communityKeys.detail(communityId || ''),
    queryFn: () => getCommunity(communityId!),
    enabled: !!communityId,
  });
}

/**
 * Get a community with its members
 */
export function useCommunityWithMembers(communityId: string | undefined) {
  return useQuery({
    queryKey: communityKeys.withMembers(communityId || ''),
    queryFn: () => getCommunityWithMembers(communityId!),
    enabled: !!communityId,
  });
}

/**
 * Check if a player is a community moderator
 */
export function useIsCommunityModerator(
  communityId: string | undefined,
  playerId: string | undefined
) {
  return useQuery({
    queryKey: communityKeys.isModerator(communityId || '', playerId || ''),
    queryFn: () => isCommunityModerator(communityId!, playerId!),
    enabled: !!communityId && !!playerId,
  });
}

/**
 * Check if a player is a community member
 */
export function useIsCommunityMember(
  communityId: string | undefined,
  playerId: string | undefined
) {
  return useQuery({
    queryKey: communityKeys.isMember(communityId || '', playerId || ''),
    queryFn: () => isCommunityMember(communityId!, playerId!),
    enabled: !!communityId && !!playerId,
  });
}

/**
 * Get a player's membership status in a community
 */
export function useCommunityMembershipStatus(
  communityId: string | undefined,
  playerId: string | undefined
) {
  return useQuery({
    queryKey: communityKeys.membershipStatus(communityId || '', playerId || ''),
    queryFn: () => getCommunityMembershipStatus(communityId!, playerId!),
    enabled: !!communityId && !!playerId,
  });
}

/**
 * Check if a player can access a community's full features
 * Returns access status, membership info, and reason if denied
 */
export function useCommunityAccess(communityId: string | undefined, playerId: string | undefined) {
  return useQuery({
    queryKey: communityKeys.access(communityId || '', playerId),
    queryFn: () => checkCommunityAccess(communityId!, playerId),
    enabled: !!communityId,
  });
}

/**
 * Get pending membership requests for a community (moderators only)
 */
export function usePendingCommunityMembers(
  communityId: string | undefined,
  moderatorId: string | undefined
) {
  return useQuery({
    queryKey: communityKeys.pendingRequests(communityId || ''),
    queryFn: () => getPendingCommunityMembers(communityId!, moderatorId!),
    enabled: !!communityId && !!moderatorId,
  });
}

// =============================================================================
// MUTATION HOOKS
// =============================================================================

/**
 * Create a new community
 */
export function useCreateCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playerId, input }: { playerId: string; input: CreateCommunityInput }) =>
      createCommunity(playerId, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.playerCommunities(variables.playerId),
      });
      queryClient.invalidateQueries({ queryKey: communityKeys.publicCommunities() });
    },
  });
}

/**
 * Update a community
 */
export function useUpdateCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      playerId,
      input,
    }: {
      communityId: string;
      playerId: string;
      input: UpdateCommunityInput;
    }) => updateCommunity(communityId, playerId, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: communityKeys.detail(variables.communityId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.publicCommunities() });
    },
  });
}

/**
 * Delete a community
 */
export function useDeleteCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ communityId, playerId }: { communityId: string; playerId: string }) =>
      deleteCommunity(communityId, playerId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.playerCommunities(variables.playerId),
      });
      queryClient.invalidateQueries({ queryKey: communityKeys.publicCommunities() });
    },
  });
}

/**
 * Request to join a public community
 */
export function useRequestToJoinCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ communityId, playerId }: { communityId: string; playerId: string }) =>
      requestToJoinCommunity(communityId, playerId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.membershipStatus(variables.communityId, variables.playerId),
      });
      queryClient.invalidateQueries({
        queryKey: communityKeys.publicCommunities(variables.playerId),
      });
    },
  });
}

/**
 * Request to join a community by invite code (e.g., from QR scan)
 */
export function useRequestToJoinCommunityByInviteCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inviteCode, playerId }: { inviteCode: string; playerId: string }) =>
      requestToJoinCommunityByInviteCode(inviteCode, playerId),
    onSuccess: (result, variables) => {
      if (result.success && result.communityId) {
        queryClient.invalidateQueries({
          queryKey: communityKeys.membershipStatus(result.communityId, variables.playerId),
        });
        queryClient.invalidateQueries({
          queryKey: communityKeys.publicCommunities(variables.playerId),
        });
        queryClient.invalidateQueries({
          queryKey: communityKeys.playerCommunities(variables.playerId),
        });
      }
    },
  });
}

/**
 * Refer a player to join a community
 */
export function useReferPlayerToCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      referredPlayerId,
      referrerId,
    }: {
      communityId: string;
      referredPlayerId: string;
      referrerId: string;
    }) => referPlayerToCommunity(communityId, referredPlayerId, referrerId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.pendingRequests(variables.communityId),
      });
    },
    onError: (error, variables) => {
      console.error('[useReferPlayerToCommunity] Error referring player:', {
        error,
        communityId: variables.communityId,
        referredPlayerId: variables.referredPlayerId,
        referrerId: variables.referrerId,
      });
    },
  });
}

/**
 * Approve a pending membership request
 */
export function useApproveCommunityMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      memberId,
      approverId,
    }: {
      communityId: string;
      memberId: string;
      approverId: string;
    }) => approveCommunityMember(communityId, memberId, approverId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.pendingRequests(variables.communityId),
      });
      queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(variables.communityId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.detail(variables.communityId) });
    },
  });
}

/**
 * Reject a pending membership request
 */
export function useRejectCommunityMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      memberId,
      rejectorId,
    }: {
      communityId: string;
      memberId: string;
      rejectorId: string;
    }) => rejectCommunityMember(communityId, memberId, rejectorId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.pendingRequests(variables.communityId),
      });
    },
  });
}

/**
 * Leave a community
 */
export function useLeaveCommunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ communityId, playerId }: { communityId: string; playerId: string }) =>
      leaveCommunity(communityId, playerId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: communityKeys.playerCommunities(variables.playerId),
      });
      queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(variables.communityId) });
      queryClient.invalidateQueries({
        queryKey: communityKeys.publicCommunities(variables.playerId),
      });
    },
  });
}

/**
 * Add a member directly to a community (MODERATORS ONLY)
 * - Only moderators can directly add members
 * - Moderators can also add as moderator if addAsModerator is true
 */
export function useAddCommunityMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      playerId,
      moderatorId,
      addAsModerator = false,
    }: {
      communityId: string;
      playerId: string;
      moderatorId: string;
      addAsModerator?: boolean;
    }) => addCommunityMember(communityId, playerId, moderatorId, addAsModerator),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(variables.communityId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.detail(variables.communityId) });
      queryClient.invalidateQueries({
        queryKey: communityKeys.pendingRequests(variables.communityId),
      });
    },
    onError: (error, variables) => {
      console.error('[useAddCommunityMember] Error adding member:', {
        error,
        communityId: variables.communityId,
        playerId: variables.playerId,
        moderatorId: variables.moderatorId,
        addAsModerator: variables.addAsModerator,
      });
    },
  });
}

/**
 * Remove a member (moderators only)
 */
export function useRemoveCommunityMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      playerId,
      moderatorId,
    }: {
      communityId: string;
      playerId: string;
      moderatorId: string;
    }) => removeCommunityMember(communityId, playerId, moderatorId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(variables.communityId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.detail(variables.communityId) });
    },
  });
}

/**
 * Promote a member to moderator
 */
export function usePromoteCommunityMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      playerId,
      promoterId,
    }: {
      communityId: string;
      playerId: string;
      promoterId: string;
    }) => promoteCommunityMember(communityId, playerId, promoterId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(variables.communityId) });
      // Force refetch activity to show the promotion/demotion immediately
      await queryClient.refetchQueries({ queryKey: ['groups', 'activity', variables.communityId] });
    },
  });
}

/**
 * Demote a moderator to member
 */
export function useDemoteCommunityMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      communityId,
      playerId,
      demoterId,
    }: {
      communityId: string;
      playerId: string;
      demoterId: string;
    }) => demoteCommunityMember(communityId, playerId, demoterId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(variables.communityId) });
      // Force refetch activity to show the promotion/demotion immediately
      await queryClient.refetchQueries({ queryKey: ['groups', 'activity', variables.communityId] });
    },
  });
}

// =============================================================================
// REALTIME HOOKS
// =============================================================================

/**
 * Subscribe to real-time updates for player's communities
 */
export function usePlayerCommunitiesRealtime(playerId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!playerId) return;

    const channel = subscribeToPlayerCommunities(playerId, () => {
      // Invalidate player's communities list on any membership change
      queryClient.invalidateQueries({ queryKey: communityKeys.playerCommunities(playerId) });
    });

    return () => {
      unsubscribeFromCommunityChannel(channel);
    };
  }, [playerId, queryClient]);
}

/**
 * Subscribe to real-time updates for public communities (discovery)
 */
export function usePublicCommunitiesRealtime(playerId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = subscribeToPublicCommunities(() => {
      // Invalidate public communities list on any change
      queryClient.invalidateQueries({ queryKey: communityKeys.publicCommunities(playerId) });
    });

    return () => {
      unsubscribeFromCommunityChannel(channel);
    };
  }, [playerId, queryClient]);
}

/**
 * Subscribe to real-time updates for a specific community
 */
export function useCommunityRealtime(communityId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!communityId) return;

    // Subscribe to member changes
    const membersChannel = subscribeToCommunityMembers(communityId, () => {
      queryClient.invalidateQueries({ queryKey: communityKeys.withMembers(communityId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.detail(communityId) });
    });

    // Subscribe to community settings changes
    const settingsChannel = subscribeToCommunitySettings(communityId, () => {
      queryClient.invalidateQueries({ queryKey: communityKeys.detail(communityId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.publicCommunities() });
    });

    // Subscribe to activity
    const activityChannel = subscribeToCommunityActivity(communityId, () => {
      // Activity queries would be invalidated here if we had them
    });

    return () => {
      unsubscribeFromCommunityChannel(membersChannel);
      unsubscribeFromCommunityChannel(settingsChannel);
      unsubscribeFromCommunityChannel(activityChannel);
    };
  }, [communityId, queryClient]);
}

/**
 * Subscribe to pending membership requests (for moderators)
 */
export function usePendingRequestsRealtime(communityId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!communityId) return;

    const channel = subscribeToPendingRequests(communityId, () => {
      queryClient.invalidateQueries({ queryKey: communityKeys.pendingRequests(communityId) });
    });

    return () => {
      unsubscribeFromCommunityChannel(channel);
    };
  }, [communityId, queryClient]);
}

// =============================================================================
// RE-EXPORT TYPES
// =============================================================================

export type {
  Community,
  CommunityWithStatus,
  CommunityWithMembers,
  CommunityMember,
  CreateCommunityInput,
  UpdateCommunityInput,
  PendingMemberRequest,
};
