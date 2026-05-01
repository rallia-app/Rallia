/**
 * useChat Hook
 * React Query hooks for chat operations
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  getPlayerConversations,
  getPlayerConversationsFiltered,
  getConversation,
  createConversation,
  getOrCreateDirectConversation,
  getMessages,
  getMessageById,
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
  subscribeToTypingIndicators,
  sendTypingIndicator,
  unsubscribeFromTypingIndicators,
  type ConversationPreview,
  type ConversationWithDetails,
  type Message,
  type MessageWithSender,
  type SendMessageInput,
  type CreateConversationInput,
  type ReactionSummary,
  type PlayerOnlineStatus,
  type TypingIndicator,
  type SearchMessageResult,
  type ChatAttachment,
  type ChatAttachmentKind,
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

/**
 * Send a message — waits for the API to return the real message, then adds it to the cache.
 * No optimistic update: the realtime subscription is responsible for other people's messages,
 * and onSuccess handles the sender's own message. This avoids race conditions entirely.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SendMessageInput) => sendMessage(input),
    onSuccess: (newMessage, variables) => {
      const realMsg = newMessage as MessageWithSender;

      // Add the real message to the messages cache (prepend to first page)
      queryClient.setQueryData(
        chatKeys.messages(variables.conversation_id),
        (oldData: { pages: MessageWithSender[][]; pageParams: number[] } | undefined) => {
          if (!oldData?.pages) return oldData;

          // Already present (e.g. a stale refetch included it) — skip
          if (oldData.pages.flat().some(m => m.id === realMsg.id)) {
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
  });
}

// ============================================================================
// OPTIMISTIC SEND WITH ATTACHMENTS
// ============================================================================

/**
 * Subset of `ChatAttachmentKind` the composer can actually produce. The wider
 * server-side type also includes `'audio' | 'other'`, but those never come
 * from a user-facing picker.
 */
export type UploadableAttachmentKind = 'image' | 'video' | 'document';

/**
 * Local file picked by the composer, not yet uploaded.
 */
export interface LocalChatAttachment {
  localId: string;
  uri: string;
  thumbnailUri: string | null;
  kind: UploadableAttachmentKind;
  mimeType: string;
  size: number;
  originalName: string;
}

/**
 * Upload contract the hook delegates to. Callers wire up their platform's
 * uploader (mobile: `uploadChatAttachment` in apps/mobile/src/services).
 */
export type ChatAttachmentUploader = (input: {
  fileUri: string;
  fileType: UploadableAttachmentKind;
  originalName: string;
  mimeType: string;
  fileSize: number;
  userId: string;
  conversationId: string;
  onProgress?: (percent: number) => void;
}) => Promise<{
  success: boolean;
  fileId?: string;
  url?: string;
  thumbnailUrl?: string | null;
  error?: string;
}>;

export interface SendMessageWithUploadsInput {
  conversation_id: string;
  sender_id: string;
  user_id: string;
  content: string | null;
  reply_to_message_id?: string;
  attachments: LocalChatAttachment[];
  sender_profile: MessageWithSender['sender'];
}

interface InFlightAttachment extends LocalChatAttachment {
  /** File id once uploaded (skipped on retry). */
  fileId?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress: number;
  error?: string;
}

interface InFlightMessage {
  tmpId: string;
  input: SendMessageWithUploadsInput;
  attachments: InFlightAttachment[];
  /** Local URI map for swap-aware rendering. */
  createdAt: string;
}

const TMP_ID_PREFIX = 'tmp-';

function makeTmpId(): string {
  return `${TMP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isOptimisticMessageId(id: string): boolean {
  return id.startsWith(TMP_ID_PREFIX);
}

function buildOptimisticMessage(state: InFlightMessage): MessageWithSender {
  return {
    id: state.tmpId,
    conversation_id: state.input.conversation_id,
    sender_id: state.input.sender_id,
    content: state.input.content?.length ? state.input.content : null,
    status: 'sending',
    read_by: null,
    created_at: state.createdAt,
    updated_at: state.createdAt,
    reply_to_message_id: state.input.reply_to_message_id ?? null,
    is_edited: false,
    edited_at: null,
    deleted_at: null,
    sender: state.input.sender_profile,
    attachments: state.attachments.map<ChatAttachment>((att, position) => ({
      id: `${TMP_ID_PREFIX}att-${att.localId}`,
      message_id: state.tmpId,
      file_id: att.fileId ?? `${TMP_ID_PREFIX}file-${att.localId}`,
      position,
      created_at: state.createdAt,
      file: {
        id: att.fileId ?? `${TMP_ID_PREFIX}file-${att.localId}`,
        file_type: att.kind,
        url: att.uri,
        thumbnail_url: att.thumbnailUri,
        mime_type: att.mimeType,
        file_size: att.size,
        original_name: att.originalName,
        storage_key: '',
        metadata: null,
      },
      __upload: {
        status: att.status,
        progress: att.progress,
        error: att.error,
      },
    })),
  };
}

type MessagesPages = { pages: MessageWithSender[][]; pageParams: number[] } | undefined;

/**
 * Prepend a real (server-confirmed) message to the messages cache, deduping
 * if the realtime sub already inserted it.
 */
function prependRealMessage(oldData: MessagesPages, message: MessageWithSender): MessagesPages {
  if (!oldData?.pages) {
    return { pages: [[message]], pageParams: [0] };
  }
  if (oldData.pages.flat().some(m => m.id === message.id)) {
    return oldData;
  }
  const firstPage = oldData.pages[0] || [];
  return {
    ...oldData,
    pages: [[message, ...firstPage], ...oldData.pages.slice(1)],
  };
}

/**
 * Snapshot persisted by the optional persistence layer. Same shape as the
 * mobile outbox row in apps/mobile/src/features/chat/services/outboxStore.ts.
 */
export interface PersistedOutboxRow {
  tmpId: string;
  conversationId: string;
  senderId: string;
  userId: string;
  content: string | null;
  replyToMessageId?: string;
  attachments: Array<{
    localId: string;
    uri: string;
    thumbnailUri: string | null;
    kind: UploadableAttachmentKind;
    mimeType: string;
    size: number;
    originalName: string;
    fileId?: string;
    status: 'pending' | 'uploading' | 'uploaded' | 'failed';
    error?: string;
  }>;
  status: 'sending' | 'failed';
  createdAt: string;
}

export interface PersistenceAdapter {
  /** Called whenever a row's persisted snapshot should be saved. */
  onPersist: (row: PersistedOutboxRow) => void;
  /** Called when a row should be removed (sent or dismissed). */
  onRemove: (tmpId: string) => void;
}

export interface UseSendMessageWithUploadsResult {
  /** Kick off an optimistic send. Returns the tmp id immediately. */
  sendMessageWithUploads: (input: SendMessageWithUploadsInput) => string;
  /** Re-run a failed send. No-op if the tmp id is unknown. */
  retryMessage: (tmpId: string) => void;
  /** Discard a failed optimistic message. */
  dismissMessage: (tmpId: string) => void;
  /**
   * Re-hydrate an optimistic message previously persisted, and (if its
   * persisted status was `sending`) re-run the upload+send pipeline.
   * Failed rows park until the user taps retry.
   */
  replayMessage: (row: PersistedOutboxRow, senderProfile: MessageWithSender['sender']) => void;
  /**
   * Optimistic messages currently being sent or failed-and-parked, keyed by
   * conversation id. Callers merge these into their messages list at render
   * time so other invalidations to `chatKeys.messages` cannot wipe them.
   */
  optimisticMessages: MessageWithSender[];
  /** True while at least one optimistic send is pending. */
  isSending: boolean;
}

/**
 * Optimistic chat send: splices a `tmp-…` MessageWithSender into the messages
 * cache immediately, uploads attachments in parallel, then calls `sendMessage`
 * with the resulting fileIds and swaps the optimistic row with the real one.
 *
 * On failure the tmp message stays in the cache as `status: 'failed'` and
 * `retryMessage(tmpId)` re-runs the pipeline, reusing already-uploaded fileIds.
 */
export function useSendMessageWithUploads(options: {
  uploader: ChatAttachmentUploader;
  persistence?: PersistenceAdapter;
}): UseSendMessageWithUploadsResult {
  const { uploader, persistence } = options;
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Map<string, InFlightMessage>>(new Map());
  const [optimisticMap, setOptimisticMap] = useState<Map<string, MessageWithSender>>(
    () => new Map()
  );
  const [pendingCount, setPendingCount] = useState(0);

  const persistRow = useCallback(
    (state: InFlightMessage, status: 'sending' | 'failed') => {
      if (!persistence) return;
      const row: PersistedOutboxRow = {
        tmpId: state.tmpId,
        conversationId: state.input.conversation_id,
        senderId: state.input.sender_id,
        userId: state.input.user_id,
        content: state.input.content,
        replyToMessageId: state.input.reply_to_message_id,
        attachments: state.attachments.map(att => ({
          localId: att.localId,
          uri: att.uri,
          thumbnailUri: att.thumbnailUri,
          kind: att.kind,
          mimeType: att.mimeType,
          size: att.size,
          originalName: att.originalName,
          fileId: att.fileId,
          status: att.status,
          error: att.error,
        })),
        status,
        createdAt: state.createdAt,
      };
      persistence.onPersist(row);
    },
    [persistence]
  );

  // Optimistic messages live in component state, NOT in the React Query cache.
  // Other mutations (reactions, edits, deletes, on-mount refetch) invalidate
  // `chatKeys.messages` — keeping tmp rows out of the cache is the only way
  // to make sure those don't wipe in-flight or failed sends.
  const writeOptimistic = useCallback((state: InFlightMessage) => {
    const msg = buildOptimisticMessage(state);
    setOptimisticMap(prev => {
      const next = new Map(prev);
      next.set(state.tmpId, msg);
      return next;
    });
  }, []);

  const removeOptimistic = useCallback((tmpId: string) => {
    setOptimisticMap(prev => {
      if (!prev.has(tmpId)) return prev;
      const next = new Map(prev);
      next.delete(tmpId);
      return next;
    });
  }, []);

  const setAttachmentState = useCallback(
    (tmpId: string, localId: string, patch: Partial<InFlightAttachment>) => {
      const state = inFlightRef.current.get(tmpId);
      if (!state) return;
      const next: InFlightMessage = {
        ...state,
        attachments: state.attachments.map(a => (a.localId === localId ? { ...a, ...patch } : a)),
      };
      inFlightRef.current.set(tmpId, next);
      writeOptimistic(next);
    },
    [writeOptimistic]
  );

  const setMessageStatus = useCallback((tmpId: string, status: 'sending' | 'failed') => {
    const state = inFlightRef.current.get(tmpId);
    if (!state) return;
    setOptimisticMap(prev => {
      const existing = prev.get(tmpId);
      if (!existing || existing.status === status) return prev;
      const next = new Map(prev);
      next.set(tmpId, { ...existing, status });
      return next;
    });
  }, []);

  const runPipeline = useCallback(
    async (tmpId: string) => {
      const state = inFlightRef.current.get(tmpId);
      if (!state) return;

      setPendingCount(c => c + 1);
      setMessageStatus(tmpId, 'sending');
      persistRow(state, 'sending');

      try {
        // 1. Upload all attachments in parallel (skip already-uploaded).
        const uploadResults = await Promise.all(
          state.attachments.map(async att => {
            if (att.fileId) {
              return { localId: att.localId, fileId: att.fileId, ok: true as const };
            }
            setAttachmentState(tmpId, att.localId, {
              status: 'uploading',
              progress: 0,
              error: undefined,
            });
            const result = await uploader({
              fileUri: att.uri,
              fileType: att.kind,
              originalName: att.originalName,
              mimeType: att.mimeType,
              fileSize: att.size,
              userId: state.input.user_id,
              conversationId: state.input.conversation_id,
              onProgress: percent => {
                setAttachmentState(tmpId, att.localId, {
                  status: 'uploading',
                  progress: percent,
                });
              },
            });
            if (result.success && result.fileId) {
              setAttachmentState(tmpId, att.localId, {
                status: 'uploaded',
                progress: 100,
                fileId: result.fileId,
              });
              // Persist after each individual upload success so an app kill
              // won't cause us to re-upload (and orphan) already-stored files.
              const snapshot = inFlightRef.current.get(tmpId);
              if (snapshot) persistRow(snapshot, 'sending');
              return { localId: att.localId, fileId: result.fileId, ok: true as const };
            }
            setAttachmentState(tmpId, att.localId, {
              status: 'failed',
              error: result.error ?? 'Upload failed',
            });
            return {
              localId: att.localId,
              ok: false as const,
              error: result.error ?? 'Upload failed',
            };
          })
        );

        const failedUploads = uploadResults.filter(r => !r.ok);
        if (failedUploads.length > 0) {
          throw new Error(failedUploads[0].ok === false ? failedUploads[0].error : 'Upload failed');
        }

        // Re-read state after uploads — fileIds are now stamped on it.
        const latest = inFlightRef.current.get(tmpId);
        if (!latest) return;

        const fileIds = latest.attachments
          .map(a => a.fileId)
          .filter((id): id is string => Boolean(id));

        // 2. Create the real message row.
        const realMessage = await sendMessage({
          conversation_id: latest.input.conversation_id,
          sender_id: latest.input.sender_id,
          content: latest.input.content?.length ? latest.input.content : null,
          reply_to_message_id: latest.input.reply_to_message_id,
          attachment_file_ids: fileIds.length > 0 ? fileIds : undefined,
        });

        // 3. Clean up persistence first — UI state mutations (setQueryData etc.)
        //    could theoretically throw, and we must not leave the outbox entry
        //    behind for a message that was already successfully sent.
        inFlightRef.current.delete(tmpId);
        persistence?.onRemove(tmpId);

        // 4. Drop the optimistic from local state and prepend the real
        //    message into the cache — same shape the existing useSendMessage
        //    relies on (with realtime-dedupe).
        removeOptimistic(tmpId);
        queryClient.setQueryData<MessagesPages>(
          chatKeys.messages(latest.input.conversation_id),
          old => prependRealMessage(old, realMessage)
        );
        queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      } catch (err) {
        setMessageStatus(tmpId, 'failed');
        const failed = inFlightRef.current.get(tmpId);
        if (failed) persistRow(failed, 'failed');
      } finally {
        setPendingCount(c => Math.max(0, c - 1));
      }
    },
    [
      queryClient,
      setAttachmentState,
      setMessageStatus,
      uploader,
      persistRow,
      persistence,
      removeOptimistic,
    ]
  );

  const sendMessageWithUploads = useCallback(
    (input: SendMessageWithUploadsInput): string => {
      const tmpId = makeTmpId();
      const state: InFlightMessage = {
        tmpId,
        input,
        createdAt: new Date().toISOString(),
        attachments: input.attachments.map(att => ({
          ...att,
          status: 'pending',
          progress: 0,
        })),
      };
      inFlightRef.current.set(tmpId, state);
      writeOptimistic(state);
      persistRow(state, 'sending');
      void runPipeline(tmpId);
      return tmpId;
    },
    [persistRow, runPipeline, writeOptimistic]
  );

  const retryMessage = useCallback(
    (tmpId: string) => {
      if (!inFlightRef.current.has(tmpId)) return;
      void runPipeline(tmpId);
    },
    [runPipeline]
  );

  const dismissMessage = useCallback(
    (tmpId: string) => {
      removeOptimistic(tmpId);
      inFlightRef.current.delete(tmpId);
      persistence?.onRemove(tmpId);
    },
    [persistence, removeOptimistic]
  );

  const replayMessage = useCallback(
    (row: PersistedOutboxRow, senderProfile: MessageWithSender['sender']) => {
      if (inFlightRef.current.has(row.tmpId)) return;
      const state: InFlightMessage = {
        tmpId: row.tmpId,
        createdAt: row.createdAt,
        input: {
          conversation_id: row.conversationId,
          sender_id: row.senderId,
          user_id: row.userId,
          content: row.content,
          reply_to_message_id: row.replyToMessageId,
          attachments: row.attachments.map(att => ({
            localId: att.localId,
            uri: att.uri,
            thumbnailUri: att.thumbnailUri,
            kind: att.kind,
            mimeType: att.mimeType,
            size: att.size,
            originalName: att.originalName,
          })),
          sender_profile: senderProfile,
        },
        attachments: row.attachments.map(att => ({
          localId: att.localId,
          uri: att.uri,
          thumbnailUri: att.thumbnailUri,
          kind: att.kind,
          mimeType: att.mimeType,
          size: att.size,
          originalName: att.originalName,
          fileId: att.fileId,
          status: att.status,
          progress: att.status === 'uploaded' ? 100 : 0,
          error: att.error,
        })),
      };
      inFlightRef.current.set(row.tmpId, state);
      writeOptimistic(state);
      // Auto-resume non-failed rows. Failed rows park until the user taps retry.
      if (row.status === 'sending') {
        void runPipeline(row.tmpId);
      } else {
        setMessageStatus(row.tmpId, 'failed');
      }
    },
    [runPipeline, setMessageStatus, writeOptimistic]
  );

  const optimisticMessages = useMemo(() => Array.from(optimisticMap.values()), [optimisticMap]);

  return {
    sendMessageWithUploads,
    retryMessage,
    dismissMessage,
    replayMessage,
    optimisticMessages,
    isSending: pendingCount > 0,
  };
}

/**
 * Mark messages as read
 */
export function useMarkMessagesAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, playerId }: { conversationId: string; playerId: string }) =>
      markMessagesAsRead(conversationId, playerId),
    onMutate: async variables => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({
        queryKey: chatKeys.playerConversations(variables.playerId),
      });

      // Snapshot previous value
      const previousConversations = queryClient.getQueryData<ConversationPreview[]>(
        chatKeys.playerConversations(variables.playerId)
      );

      // Optimistically set unread_count to 0 for this conversation
      if (previousConversations) {
        queryClient.setQueryData<ConversationPreview[]>(
          chatKeys.playerConversations(variables.playerId),
          previousConversations.map(conv =>
            conv.id === variables.conversationId ? { ...conv, unread_count: 0 } : conv
          )
        );
      }

      return { previousConversations };
    },
    onError: (_err, variables, context) => {
      // Roll back on error
      if (context?.previousConversations) {
        queryClient.setQueryData(
          chatKeys.playerConversations(variables.playerId),
          context.previousConversations
        );
      }
    },
    onSettled: (_, __, variables) => {
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
      // Own messages are added to the cache by useSendMessage.onSuccess.
      onInsert: newMessage => {
        if (newMessage.sender_id === playerId) return;

        // Enrich the raw message with sender profile from the cached conversation.
        // The realtime payload doesn't include attachments; we hydrate them via
        // a follow-up fetch below.
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

        // Hydrate attachments + fresh sender by re-fetching the full row.
        // We don't await this — the bubble appears immediately with text and
        // attachments fill in within a few hundred ms.
        void getMessageById(newMessage.id)
          .then(full => {
            if (!full) return;
            queryClient.setQueryData(
              chatKeys.messages(conversationId),
              (oldData: { pages: MessageWithSender[][]; pageParams: number[] } | undefined) => {
                if (!oldData) return oldData;
                const newPages = oldData.pages.map(page =>
                  page.map(msg => (msg.id === full.id ? { ...msg, ...full } : msg))
                );
                return { ...oldData, pages: newPages };
              }
            );
          })
          .catch(err => {
            // Non-fatal — the lightweight enriched message is already shown.
            console.warn('Failed to hydrate realtime message', err);
          });

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
 * Subscribe to real-time reaction changes in a conversation
 */
export function useReactionsRealtime(conversationId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

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
  }, [conversationId, queryClient]);
}

/**
 * Subscribe to all conversation updates
 */
export function useConversationsRealtime(playerId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!playerId) return;

    const channel = subscribeToConversations(playerId, () => {
      // Refresh conversations list (also invalidates filteredConversations via prefix matching)
      queryClient.invalidateQueries({
        queryKey: chatKeys.playerConversations(playerId),
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
// TYPING INDICATOR HOOKS
// ============================================================================

/**
 * Subscribe to typing indicators in a conversation
 */
export function useTypingIndicators(
  conversationId: string | undefined,
  playerId: string | undefined,
  playerName: string | undefined
) {
  const [typingUsers, setTypingUsers] = useState<TypingIndicator[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Early return for invalid state - cleanup function handles clearing
    if (!conversationId || !playerId || !playerName) {
      return;
    }

    // Subscribe to typing indicators (channel is managed internally)
    subscribeToTypingIndicators(conversationId, playerId, playerName, users => {
      // Filter out stale typing indicators (older than 5 seconds)
      const now = Date.now();
      const activeUsers = users.filter(u => now - u.timestamp < 5000);
      setTypingUsers(activeUsers);
    });

    return () => {
      unsubscribeFromTypingIndicators(conversationId);
      // Clear typing users when unsubscribing (e.g., when leaving conversation)
      setTypingUsers([]);
    };
  }, [conversationId, playerId, playerName]);

  // Function to send typing indicator
  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!conversationId || !playerId || !playerName) return;

      // Clear any existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      sendTypingIndicator(conversationId, playerId, playerName, isTyping);

      // Auto-stop typing after 3 seconds
      if (isTyping) {
        typingTimeoutRef.current = setTimeout(() => {
          sendTypingIndicator(conversationId, playerId, playerName, false);
        }, 3000);
      }
    },
    [conversationId, playerId, playerName]
  );

  return {
    typingUsers,
    sendTyping,
  };
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
  TypingIndicator,
  SearchMessageResult,
};
