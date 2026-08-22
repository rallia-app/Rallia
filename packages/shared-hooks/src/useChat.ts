/**
 * useChat Hook
 * React Query hooks for chat operations
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  getPlayerConversations,
  getPlayerConversationsFiltered,
  getConversation,
  createConversation,
  getOrCreateDirectConversation,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  markMessagesAsDelivered,
  deleteMessage,
  editMessage,
  toggleMuteConversation,
  leaveConversation,
  togglePinConversation,
  toggleArchiveConversation,
  toggleReaction,
  subscribeToMessages,
  subscribeToConversations,
  subscribeToReactions,
  unsubscribeFromChannel,
  getTotalUnreadCount,
  getUnreadConversationsCount,
  getConversationByNetworkId,
  getConversationUnreadCount,
  getConversationUnreadCountLast7Days,
  hasAgreedToChatRules,
  agreeToChatRules,
  // New enhanced functions
  updatePlayerLastSeen,
  getPlayersOnlineStatus,
  searchMessagesInConversation,
  type ConversationPreview,
  type ConversationWithDetails,
  type Message,
  type MessageWithSender,
  type SendMessageInput,
  type CreateConversationInput,
  type ReactionSummary,
  type PlayerOnlineStatus,
  type SearchMessageResult,
} from '@rallia/shared-services';
import type { ConversationFilter } from '@rallia/shared-types';

// ============================================================================
// QUERY KEYS
// ============================================================================

export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  playerConversations: (playerId: string, sportId?: string) =>
    [...chatKeys.conversations(), playerId, ...(sportId ? [sportId] : [])] as const,
  conversation: (conversationId: string) =>
    [...chatKeys.all, 'conversation', conversationId] as const,
  messages: (conversationId: string) => [...chatKeys.all, 'messages', conversationId] as const,
  reactions: (messageIds: string[]) =>
    [...chatKeys.all, 'reactions', messageIds.join(',')] as const,
  unreadCount: (playerId: string) => [...chatKeys.all, 'unreadCount', playerId] as const,
  conversationUnreadCount: (conversationId: string, playerId: string) =>
    [...chatKeys.all, 'conversationUnreadCount', conversationId, playerId] as const,
  conversationUnreadCountLast7Days: (conversationId: string, playerId: string) =>
    [...chatKeys.all, 'conversationUnreadCountLast7Days', conversationId, playerId] as const,
  networkConversation: (networkId: string) =>
    [...chatKeys.all, 'networkConversation', networkId] as const,
  chatAgreement: (playerId: string) => [...chatKeys.all, 'chatAgreement', playerId] as const,
  // Filtered + paginated conversations (extends playerConversations for partial-key invalidation)
  filteredConversations: (playerId: string, params?: Record<string, unknown>) =>
    [...chatKeys.playerConversations(playerId), params] as const,
  unreadConversationsCount: (playerId: string) =>
    [...chatKeys.all, 'unreadConversationsCount', playerId] as const,
  // New enhanced keys
  onlineStatus: (playerIds: string[]) =>
    [...chatKeys.all, 'onlineStatus', playerIds.join(',')] as const,
  searchMessages: (conversationId: string, query: string) =>
    [...chatKeys.all, 'searchMessages', conversationId, query] as const,
};

// ============================================================================
// CONVERSATION HOOKS
// ============================================================================

/**
 * Get all conversations for the current player
 */
export function usePlayerConversations(playerId: string | undefined, sportId?: string) {
  return useQuery({
    queryKey: chatKeys.playerConversations(playerId || '', sportId),
    queryFn: () => getPlayerConversations(playerId!, sportId),
    enabled: !!playerId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Get filtered + paginated conversations for the chat inbox.
 * Uses server-side filtering via get_player_conversations_filtered RPC.
 */

const CONVERSATION_PAGE_SIZE = 20;

interface FilteredConversationsPage {
  conversations: ConversationPreview[];
  nextOffset: number | null;
  hasMore: boolean;
}

export interface UseFilteredConversationsOptions {
  playerId: string | undefined;
  filter?: ConversationFilter;
  search?: string;
  limit?: number;
  enabled?: boolean;
  sportId?: string;
}

export function useFilteredConversations(options: UseFilteredConversationsOptions) {
  const {
    playerId,
    filter = 'all',
    search = '',
    limit = CONVERSATION_PAGE_SIZE,
    enabled = true,
    sportId,
  } = options;

  const hasRequiredParams = !!playerId;

  const query = useInfiniteQuery<FilteredConversationsPage, Error>({
    queryKey: chatKeys.filteredConversations(playerId || '', { filter, search, limit, sportId }),
    queryFn: async ({ pageParam = 0 }) => {
      if (!hasRequiredParams) {
        return { conversations: [], nextOffset: null, hasMore: false };
      }

      return getPlayerConversationsFiltered({
        playerId: playerId!,
        filter,
        search,
        limit,
        offset: pageParam as number,
        sportId,
      });
    },
    getNextPageParam: lastPage => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: enabled && hasRequiredParams,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Flatten all pages into a single array
  const conversations = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap(page => page.conversations);
  }, [query.data]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    conversations,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isRefetching: query.isRefetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage: query.fetchNextPage,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: query.error,
    refetch: refresh,
  };
}

/**
 * Get count of conversations with unread messages (for Unread chip badge)
 */
export function useUnreadConversationsCount(playerId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.unreadConversationsCount(playerId || ''),
    queryFn: () => getUnreadConversationsCount(playerId!),
    enabled: !!playerId,
    staleTime: 10 * 1000, // 10 seconds
  });
}

/**
 * Get a single conversation with details
 */
export function useConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.conversation(conversationId || ''),
    queryFn: () => getConversation(conversationId!),
    enabled: !!conversationId,
  });
}

/**
 * Get conversation for a network (group/community)
 */
export function useNetworkConversation(networkId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.networkConversation(networkId || ''),
    queryFn: () => getConversationByNetworkId(networkId!),
    enabled: !!networkId,
  });
}

/**
 * Create a new conversation
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateConversationInput) => createConversation(input),
    onSuccess: (_, variables) => {
      // Invalidate conversations list
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(variables.created_by),
      });
    },
  });
}

/**
 * Get or create a direct conversation between two players
 */
export function useGetOrCreateDirectConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playerId1, playerId2 }: { playerId1: string; playerId2: string }) =>
      getOrCreateDirectConversation(playerId1, playerId2),
    onSuccess: (_, variables) => {
      // Invalidate conversations list so the new direct chat appears immediately
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(),
      });
    },
  });
}

// ============================================================================
// MESSAGE HOOKS
// ============================================================================

/**
 * Get messages for a conversation with infinite scroll
 */
export function useMessages(conversationId: string | undefined, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(conversationId || ''),
    queryFn: async ({ pageParam = 0 }) => {
      const messages = await getMessages(conversationId!, {
        limit: pageSize,
        offset: pageParam,
      });
      return messages;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < pageSize) {
        return undefined; // No more pages
      }
      return allPages.flat().length;
    },
    initialPageParam: 0,
    enabled: !!conversationId,
  });
}

type MessagesPages = { pages: MessageWithSender[][]; pageParams: number[] };

/**
 * Send a message optimistically.
 *
 * The message is inserted into the thread immediately with a temporary id so it
 * appears instantly. On success the placeholder is replaced in place with the
 * server row (so it keeps its position); on failure it is rolled back and
 * removed. The realtime subscription ignores the sender's own messages, so the
 * server echo never double-inserts.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SendMessageInput) => sendMessage(input),
    onMutate: async input => {
      const messagesKey = chatKeys.messages(input.conversation_id);

      // Stop in-flight refetches from clobbering the optimistic insert
      await queryClient.cancelQueries({ queryKey: messagesKey });

      const previousMessages = queryClient.getQueryData<MessagesPages>(messagesKey);

      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Enrich with the sender's own profile from the cached conversation
      const conversation = queryClient.getQueryData<ConversationWithDetails>(
        chatKeys.conversation(input.conversation_id)
      );
      const participant = conversation?.participants?.find(p => p.player_id === input.sender_id);

      // Build the reply preview from the message being replied to, if any
      let replyTo: MessageWithSender['reply_to'] = null;
      if (input.reply_to_message_id) {
        const repliedMessage = previousMessages?.pages
          .flat()
          .find(m => m.id === input.reply_to_message_id);
        if (repliedMessage) {
          replyTo = {
            id: repliedMessage.id,
            content: repliedMessage.content,
            sender_name: repliedMessage.sender?.profile?.first_name ?? 'Unknown',
          };
        }
      }

      const now = new Date().toISOString();
      const optimisticMessage: MessageWithSender = {
        id: tempId,
        conversation_id: input.conversation_id,
        sender_id: input.sender_id,
        content: input.content,
        status: 'sent',
        read_by: null,
        created_at: now,
        updated_at: now,
        reply_to_message_id: input.reply_to_message_id ?? null,
        is_edited: false,
        edited_at: null,
        deleted_at: null,
        sender: participant?.player ?? null,
        reply_to: replyTo,
      };

      queryClient.setQueryData(messagesKey, (oldData: MessagesPages | undefined) => {
        if (!oldData?.pages) {
          return { pages: [[optimisticMessage]], pageParams: [0] };
        }
        const firstPage = oldData.pages[0] || [];
        return {
          ...oldData,
          pages: [[optimisticMessage, ...firstPage], ...oldData.pages.slice(1)],
        };
      });

      return { tempId };
    },
    onSuccess: (newMessage, variables, context) => {
      const realMsg = newMessage as MessageWithSender;
      const tempId = context?.tempId;

      queryClient.setQueryData(
        chatKeys.messages(variables.conversation_id),
        (oldData: MessagesPages | undefined) => {
          if (!oldData?.pages) return oldData;

          // Replace the optimistic placeholder in place with the server row
          const tempExists = oldData.pages.some(page => page.some(m => m.id === tempId));
          if (tempExists) {
            return {
              ...oldData,
              pages: oldData.pages.map(page => page.map(m => (m.id === tempId ? realMsg : m))),
            };
          }

          // Placeholder is gone (e.g. cache was reset) — make sure the real
          // message is present without duplicating it
          if (oldData.pages.some(page => page.some(m => m.id === realMsg.id))) {
            return oldData;
          }
          const firstPage = oldData.pages[0] || [];
          return {
            ...oldData,
            pages: [[realMsg, ...firstPage], ...oldData.pages.slice(1)],
          };
        }
      );

      // Invalidate conversations list so the inbox shows the latest message
      // immediately (don't rely solely on Realtime which can be unreliable with RLS)
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(),
      });
    },
    onError: (_err, variables, context) => {
      const tempId = context?.tempId;
      if (!tempId) return;

      // Roll back by removing only the failed placeholder — preserves any
      // messages that arrived from other users during the pending window
      queryClient.setQueryData(
        chatKeys.messages(variables.conversation_id),
        (oldData: MessagesPages | undefined) => {
          if (!oldData?.pages) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map(page => page.filter(m => m.id !== tempId)),
          };
        }
      );
    },
  });
}

type ConversationListCache = ConversationPreview[] | InfiniteData<FilteredConversationsPage>;

function isInfiniteConversationList(
  data: ConversationListCache
): data is InfiniteData<FilteredConversationsPage> {
  return !Array.isArray(data) && Array.isArray(data.pages);
}

// Patches every cache under the playerConversations prefix: flat lists and the paginated inbox query.
function patchConversationCaches(
  queryClient: QueryClient,
  playerId: string,
  patch: (conversation: ConversationPreview) => ConversationPreview
) {
  queryClient.setQueriesData<ConversationListCache>(
    { queryKey: chatKeys.playerConversations(playerId) },
    old => {
      if (!old) return old;
      if (!isInfiniteConversationList(old)) return old.map(patch);
      return {
        ...old,
        pages: old.pages.map(page =>
          Array.isArray(page?.conversations)
            ? { ...page, conversations: page.conversations.map(patch) }
            : page
        ),
      };
    }
  );
}

function findCachedConversation(
  lists: Array<[QueryKey, ConversationListCache | undefined]>,
  conversationId: string
): ConversationPreview | undefined {
  for (const [, data] of lists) {
    if (!data) continue;
    const rows = isInfiniteConversationList(data)
      ? data.pages.flatMap(page => page?.conversations ?? [])
      : data;
    const hit = rows.find(conv => conv.id === conversationId);
    if (hit) return hit;
  }
  return undefined;
}

const MARK_MESSAGES_AS_READ_KEY = [...chatKeys.all, 'markMessagesAsRead'] as const;

/**
 * Mark messages as read
 */
export function useMarkMessagesAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: MARK_MESSAGES_AS_READ_KEY,
    mutationFn: ({ conversationId, playerId }: { conversationId: string; playerId: string }) =>
      markMessagesAsRead(conversationId, playerId),
    onMutate: async variables => {
      const listKey = chatKeys.playerConversations(variables.playerId);
      const totalKey = chatKeys.unreadCount(variables.playerId);
      const convsKey = chatKeys.unreadConversationsCount(variables.playerId);
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await Promise.all(
        [listKey, totalKey, convsKey].map(queryKey => queryClient.cancelQueries({ queryKey }))
      );

      // Read, patch and decrement in one synchronous block so overlapping calls never double-count.
      const previousLists = queryClient.getQueriesData<ConversationListCache>({
        queryKey: listKey,
      });
      const previousCounts = [totalKey, convsKey].flatMap(queryKey =>
        queryClient.getQueriesData<number>({ queryKey, exact: true })
      );
      const cached = findCachedConversation(previousLists, variables.conversationId);

      patchConversationCaches(queryClient, variables.playerId, conv =>
        conv.id === variables.conversationId && conv.unread_count !== 0
          ? { ...conv, unread_count: 0 }
          : conv
      );

      // Both badge counts exclude archived conversations.
      const unread = cached && !cached.is_archived ? cached.unread_count : 0;
      if (unread > 0) {
        queryClient.setQueriesData<number>({ queryKey: totalKey, exact: true }, old =>
          old === undefined ? old : Math.max(0, old - unread)
        );
        queryClient.setQueriesData<number>({ queryKey: convsKey, exact: true }, old =>
          old === undefined ? old : Math.max(0, old - 1)
        );
      }

      const previous: Array<[QueryKey, unknown]> = [...previousLists, ...previousCounts];
      return { previous };
    },
    onError: (_err, _variables, context) => {
      context?.previous.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: (_, __, variables) => {
      // Calls overlap (enter + each incoming message): only the last one refetches.
      if (queryClient.isMutating({ mutationKey: MARK_MESSAGES_AS_READ_KEY }) > 1) return;
      // Refetch conversations list so inbox reflects read state when navigating back
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversations(),
      });
      // Refetch unread count badge to ensure server state is in sync
      queryClient.invalidateQueries({
        queryKey: chatKeys.unreadCount(variables.playerId),
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.unreadConversationsCount(variables.playerId),
      });
    },
  });
}

/**
 * Mark messages as delivered (when recipient receives them)
 */
export function useMarkMessagesAsDelivered() {
  return useMutation({
    mutationFn: ({
      conversationId,
      recipientId,
    }: {
      conversationId: string;
      recipientId: string;
    }) => markMessagesAsDelivered(conversationId, recipientId),
  });
}

/**
 * Delete a message
 */
export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      senderId,
      conversationId: _conversationId,
    }: {
      messageId: string;
      senderId: string;
      conversationId: string;
    }) => deleteMessage(messageId, senderId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.conversationId),
      });
    },
  });
}

/**
 * Edit a message
 */
export function useEditMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      senderId,
      newContent,
    }: {
      messageId: string;
      senderId: string;
      newContent: string;
      conversationId: string;
    }) => editMessage(messageId, senderId, newContent),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.conversationId),
      });
    },
  });
}

// ============================================================================
// REACTION HOOKS
// ============================================================================

/**
 * Toggle a reaction on a message
 */
export function useToggleReaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      playerId,
      emoji,
    }: {
      messageId: string;
      playerId: string;
      emoji: string;
      conversationId: string; // For cache invalidation
    }) => toggleReaction(messageId, playerId, emoji),
    onSuccess: (_, variables) => {
      // Invalidate messages to refresh reactions
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.conversationId),
      });
    },
  });
}

// ============================================================================
// PARTICIPANT HOOKS
// ============================================================================

/**
 * Toggle mute for a conversation
 */
export function useToggleMuteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      playerId,
      isMuted,
    }: {
      conversationId: string;
      playerId: string;
      isMuted: boolean;
    }) => toggleMuteConversation(conversationId, playerId, isMuted),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversation(variables.conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(variables.playerId),
      });
    },
  });
}

/**
 * Toggle pin for a conversation
 */
export function useTogglePinConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      playerId,
      isPinned,
    }: {
      conversationId: string;
      playerId: string;
      isPinned: boolean;
    }) => togglePinConversation(conversationId, playerId, isPinned),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversation(variables.conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(variables.playerId),
      });
    },
  });
}

/**
 * Toggle archive for a conversation
 */
export function useToggleArchiveConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      playerId,
      isArchived,
    }: {
      conversationId: string;
      playerId: string;
      isArchived: boolean;
    }) => toggleArchiveConversation(conversationId, playerId, isArchived),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.conversation(variables.conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(variables.playerId),
      });
    },
  });
}

/**
 * Leave a conversation
 */
export function useLeaveConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, playerId }: { conversationId: string; playerId: string }) =>
      leaveConversation(conversationId, playerId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(variables.playerId),
      });
    },
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Get total unread message count
 */
export function useTotalUnreadCount(playerId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.unreadCount(playerId || ''),
    queryFn: () => getTotalUnreadCount(playerId!),
    enabled: !!playerId,
    staleTime: 1000,
  });
}

/**
 * Get unread message count for a specific conversation
 * Useful for showing unread count on Group/Community detail screens
 */
export function useConversationUnreadCount(
  conversationId: string | undefined,
  playerId: string | undefined
) {
  return useQuery({
    queryKey: chatKeys.conversationUnreadCount(conversationId || '', playerId || ''),
    queryFn: () => getConversationUnreadCount(conversationId!, playerId!),
    enabled: !!conversationId && !!playerId,
    staleTime: 1000,
  });
}

/**
 * Get unread message count for a specific conversation, limited to last 7 days
 * Useful for showing unread count in "Last 7 Days Activities" section
 */
export function useConversationUnreadCountLast7Days(
  conversationId: string | undefined,
  playerId: string | undefined
) {
  return useQuery({
    queryKey: chatKeys.conversationUnreadCountLast7Days(conversationId || '', playerId || ''),
    queryFn: () => getConversationUnreadCountLast7Days(conversationId!, playerId!),
    enabled: !!conversationId && !!playerId,
    staleTime: 1000,
  });
}

/**
 * Subscribe to real-time updates for a specific conversation's unread count
 * Invalidates the unread count query when messages change
 */
export function useConversationUnreadRealtime(
  conversationId: string | undefined,
  playerId: string | undefined
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId || !playerId) return;

    const channel = subscribeToMessages(conversationId, {
      onInsert: () => {
        // Invalidate both unread count queries when a new message arrives
        queryClient.invalidateQueries({
          queryKey: chatKeys.conversationUnreadCount(conversationId, playerId),
        });
        queryClient.invalidateQueries({
          queryKey: chatKeys.conversationUnreadCountLast7Days(conversationId, playerId),
        });
      },
    });

    return () => {
      unsubscribeFromChannel(channel);
    };
  }, [conversationId, playerId, queryClient]);
}

// ============================================================================
// REAL-TIME HOOKS
// ============================================================================

/**
 * Subscribe to real-time messages in a conversation
 * Handles new messages, edits, and deletions
 */
export function useChatRealtime(
  conversationId: string | undefined,
  playerId: string | undefined,
  callbacks?: {
    onNewMessage?: (message: Message) => void;
    onMessageUpdated?: (message: Message) => void;
    onMessageDeleted?: (messageId: string) => void;
  }
) {
  const queryClient = useQueryClient();

  // Use a ref for callbacks so the subscription doesn't churn on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!conversationId || !playerId) return;

    const channel = subscribeToMessages(conversationId, {
      // Handle new messages from OTHER users only.
      // Own messages are inserted optimistically in useSendMessage.onMutate and
      // replaced in place by onSuccess. This guard is load-bearing: without it,
      // the realtime echo of our own INSERT would duplicate the message until a
      // refetch dedupes it. Do not remove without changing the send flow.
      onInsert: newMessage => {
        if (newMessage.sender_id === playerId) return;

        // Enrich the raw message with sender profile from the cached conversation
        const conversation = queryClient.getQueryData<ConversationWithDetails>(
          chatKeys.conversation(conversationId)
        );
        const participant = conversation?.participants?.find(
          p => p.player_id === newMessage.sender_id
        );
        const enrichedMessage: MessageWithSender = {
          ...newMessage,
          sender: participant?.player ?? null,
        };

        queryClient.setQueryData(
          chatKeys.messages(conversationId),
          (oldData: { pages: MessageWithSender[][]; pageParams: number[] } | undefined) => {
            if (!oldData) return oldData;

            const firstPage = oldData.pages[0] || [];

            // Already present — skip
            if (firstPage.some(m => m.id === newMessage.id)) {
              return oldData;
            }

            return {
              ...oldData,
              pages: [[enrichedMessage, ...firstPage], ...oldData.pages.slice(1)],
            };
          }
        );

        // Call custom handler via ref (avoids stale closure)
        callbacksRef.current?.onNewMessage?.(newMessage);
      },

      // Handle message edits
      onUpdate: updatedMessage => {
        queryClient.setQueryData(
          chatKeys.messages(conversationId),
          (oldData: { pages: MessageWithSender[][]; pageParams: number[] } | undefined) => {
            if (!oldData) return oldData;

            // Update the message in the cache
            const newPages = oldData.pages.map(page =>
              page.map(msg => (msg.id === updatedMessage.id ? { ...msg, ...updatedMessage } : msg))
            );

            return {
              ...oldData,
              pages: newPages,
            };
          }
        );

        // Call custom handler via ref (avoids stale closure)
        callbacksRef.current?.onMessageUpdated?.(updatedMessage);
      },

      // Handle message deletions
      onDelete: messageId => {
        queryClient.setQueryData(
          chatKeys.messages(conversationId),
          (oldData: { pages: MessageWithSender[][]; pageParams: number[] } | undefined) => {
            if (!oldData) return oldData;

            // Mark message as deleted in the cache (soft delete)
            const newPages = oldData.pages.map(page =>
              page.map(msg =>
                msg.id === messageId ? { ...msg, is_deleted: true, content: '' } : msg
              )
            );

            return {
              ...oldData,
              pages: newPages,
            };
          }
        );

        // Call custom handler via ref (avoids stale closure)
        callbacksRef.current?.onMessageDeleted?.(messageId);
      },
    });

    return () => {
      unsubscribeFromChannel(channel);
    };
  }, [conversationId, playerId, queryClient]);
}

/**
 * Subscribe to real-time reaction changes in a conversation.
 * Gated on playerId so we never join the private channel before auth is ready.
 */
export function useReactionsRealtime(
  conversationId: string | undefined,
  playerId: string | undefined
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId || !playerId) return;

    const channel = subscribeToReactions(conversationId, ({ messageId: _messageId }) => {
      // Invalidate reactions for the affected message
      // We invalidate all reactions queries since we don't know which specific query contains this message
      queryClient.invalidateQueries({
        queryKey: chatKeys.all,
        predicate: query => query.queryKey[0] === 'chat' && query.queryKey[1] === 'reactions',
      });
    });

    return () => {
      unsubscribeFromChannel(channel);
    };
  }, [conversationId, playerId, queryClient]);
}

/**
 * Subscribe to all conversation updates
 *
 * The conversation-list screen stays mounted app-wide (tab preload +
 * freezeOnBlur), so pass `isScreenVisible` to keep the expensive
 * conversation-list RPC from refetching while the screen isn't on screen:
 * blurred, events only mark the list stale (`refetchType: 'none'`) and the
 * caller refetches stale queries when the screen regains focus. Unread-count
 * queries always refetch actively — they power the tab badge.
 */
export function useConversationsRealtime(
  playerId: string | undefined,
  options?: { isScreenVisible?: boolean }
) {
  const queryClient = useQueryClient();
  const isScreenVisible = options?.isScreenVisible ?? true;

  // Read by the subscription callback so visibility changes don't resubscribe.
  const isScreenVisibleRef = useRef(isScreenVisible);
  isScreenVisibleRef.current = isScreenVisible;

  useEffect(() => {
    if (!playerId) return;

    const channel = subscribeToConversations(playerId, () => {
      // Refresh conversations list (also invalidates filteredConversations via prefix matching)
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(playerId),
        refetchType: isScreenVisibleRef.current ? 'active' : 'none',
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.unreadCount(playerId),
      });
      queryClient.invalidateQueries({
        queryKey: chatKeys.unreadConversationsCount(playerId),
      });
    });

    return () => {
      unsubscribeFromChannel(channel);
    };
  }, [playerId, queryClient]);
}

// ============================================================================
// CHAT AGREEMENT HOOKS
// ============================================================================

/**
 * Check if player has agreed to chat rules
 */
export function useChatAgreement(playerId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.chatAgreement(playerId ?? ''),
    queryFn: () => hasAgreedToChatRules(playerId!),
    enabled: !!playerId,
    staleTime: Infinity, // Only need to check once per session
  });
}

/**
 * Agree to chat rules mutation
 */
export function useAgreeToChatRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (playerId: string) => agreeToChatRules(playerId),
    onSuccess: (_, playerId) => {
      // Update the cache to reflect agreement
      queryClient.setQueryData(chatKeys.chatAgreement(playerId), true);
    },
  });
}

// ============================================================================
// ONLINE STATUS HOOKS
// ============================================================================

/**
 * Get online status for multiple players
 */
export function usePlayersOnlineStatus(playerIds: string[]) {
  return useQuery({
    queryKey: chatKeys.onlineStatus(playerIds),
    queryFn: () => getPlayersOnlineStatus(playerIds),
    enabled: playerIds.length > 0,
    staleTime: 60 * 1000, // Refresh every minute
    refetchInterval: 60 * 1000, // Auto-refresh every minute
  });
}

/**
 * Update current player's last seen timestamp
 * Call this hook to track user activity
 */
export function useUpdateLastSeen(playerId: string | undefined) {
  const lastUpdateRef = useRef<number>(0);

  const updateLastSeen = useCallback(() => {
    if (!playerId) return;

    // Throttle updates to max once per minute
    const now = Date.now();
    if (now - lastUpdateRef.current < 60 * 1000) return;

    lastUpdateRef.current = now;
    updatePlayerLastSeen(playerId);
  }, [playerId]);

  // Update on mount and periodically
  useEffect(() => {
    if (!playerId) return;

    // Initial update
    updateLastSeen();

    // Update every 2 minutes while active
    const interval = setInterval(updateLastSeen, 2 * 60 * 1000);

    return () => clearInterval(interval);
  }, [playerId, updateLastSeen]);

  return updateLastSeen;
}

// ============================================================================
// SEARCH HOOKS
// ============================================================================

/**
 * Search messages within a conversation
 */
export function useSearchMessages(
  conversationId: string | undefined,
  query: string,
  enabled = true
) {
  return useQuery({
    queryKey: chatKeys.searchMessages(conversationId || '', query),
    queryFn: () => searchMessagesInConversation(conversationId!, query),
    enabled: enabled && !!conversationId && query.trim().length >= 2,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  ConversationPreview,
  ConversationWithDetails,
  Message,
  MessageWithSender,
  SendMessageInput,
  CreateConversationInput,
  ReactionSummary,
  PlayerOnlineStatus,
  SearchMessageResult,
};
