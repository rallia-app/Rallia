/**
 * useGroupChatInfo Hook
 * Manages fetching and state for group chat info screen
 * - Conversation data
 * - Network info (for network-linked groups)
 * - Moderator IDs
 * - Admin status checks
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useConversation } from '@rallia/shared-hooks';
import { getNetworkByConversationId, getGroupModeratorIds } from '@rallia/shared-services';

interface NetworkInfo {
  id: string;
  name: string;
  cover_image_url: string | null;
  description: string | null;
  member_count: number;
  type: 'community' | 'player_group' | string | null;
}

interface ParticipantInfo {
  id: string;
  player_id: string;
  player: {
    id: string;
    profile: {
      first_name: string;
      last_name: string | null;
      profile_picture_url: string | null;
    } | null;
  } | null;
  is_admin?: boolean;
}

interface UseGroupChatInfoReturn {
  // Data
  conversation: ReturnType<typeof useConversation>['data'];
  networkInfo: NetworkInfo | null;
  networkModeratorIds: string[];
  participants: ParticipantInfo[];
  groupImageUrl: string | null;
  memberCount: number;

  // Loading states
  isLoading: boolean;

  // Actions
  refetch: () => Promise<unknown>;
  refetchNetworkInfo: () => Promise<void>;

  // Admin checks
  isAdmin: boolean;
  isParticipantAdmin: (participantPlayerId: string) => boolean;
}

export function useGroupChatInfo(
  conversationId: string,
  playerId: string | undefined
): UseGroupChatInfoReturn {
  // Fetch conversation details
  const { data: conversation, isLoading, refetch } = useConversation(conversationId);

  // Network state
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [networkModeratorIds, setNetworkModeratorIds] = useState<string[]>([]);

  // Fetch network info if this is a network-linked conversation
  const fetchNetworkInfo = useCallback(async () => {
    try {
      const info = await getNetworkByConversationId(conversationId);
      setNetworkInfo(info);

      // If network-linked, fetch moderator IDs
      if (info?.id) {
        const moderatorIds = await getGroupModeratorIds(info.id);
        setNetworkModeratorIds(moderatorIds);
      }
    } catch (error) {
      // Not linked to a network, that's fine
      setNetworkInfo(null);
      setNetworkModeratorIds([]);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchNetworkInfo();
  }, [fetchNetworkInfo]);

  // Get participants
  const participants = useMemo(() => {
    if (!conversation?.participants) return [];
    return conversation.participants as ParticipantInfo[];
  }, [conversation]);

  // Check if current user is admin
  // For network-linked groups: admins are network moderators
  // For simple groups: admin is the conversation creator
  const isAdmin = useMemo(() => {
    if (!playerId || !conversation) return false;

    // For network-linked groups, check if user is a network moderator
    if (networkInfo?.id && networkModeratorIds.length > 0) {
      return networkModeratorIds.includes(playerId);
    }

    // For simple groups, check if user is the creator
    return conversation.created_by === playerId;
  }, [playerId, conversation, networkInfo, networkModeratorIds]);

  // Check if a participant is an admin
  const isParticipantAdmin = useCallback(
    (participantPlayerId: string) => {
      if (!conversation) return false;

      // For network-linked groups, check if participant is a network moderator
      if (networkInfo?.id && networkModeratorIds.length > 0) {
        return networkModeratorIds.includes(participantPlayerId);
      }

      // For simple groups, check if participant is the creator
      return conversation.created_by === participantPlayerId;
    },
    [conversation, networkInfo, networkModeratorIds]
  );

  // Get group image URL
  const groupImageUrl = useMemo(() => {
    // First check network cover image
    if (networkInfo?.cover_image_url) return networkInfo.cover_image_url;
    // Then check conversation picture_url
    const pictureUrl = (conversation as { picture_url?: string | null })?.picture_url;
    if (pictureUrl) {
      return pictureUrl;
    }
    return null;
  }, [conversation, networkInfo]);

  const memberCount = participants.length;

  return {
    // Data
    conversation,
    networkInfo,
    networkModeratorIds,
    participants,
    groupImageUrl,
    memberCount,

    // Loading states
    isLoading,

    // Actions
    refetch,
    refetchNetworkInfo: fetchNetworkInfo,

    // Admin checks
    isAdmin,
    isParticipantAdmin,
  };
}
