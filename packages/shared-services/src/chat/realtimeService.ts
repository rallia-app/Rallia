/**
 * Realtime Service
 * Real-time subscriptions for messages and conversations
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../supabase';

import type { Message } from './chatTypes';

// ============================================================================
// MESSAGE SUBSCRIPTIONS
// ============================================================================

/**
 * Callback types for message events
 */
export type MessageEventCallback = {
  onInsert?: (message: Message) => void;
  onUpdate?: (message: Message) => void;
  onDelete?: (messageId: string) => void;
};

/**
 * Body delivered by realtime.broadcast_changes() (see the 20260526
 * chat_broadcast_from_database migration). The DB trigger sends the row under
 * `record`, and the pre-image under `old_record` for UPDATE/DELETE.
 */
type BroadcastBody<TRecord> = {
  operation?: string;
  table?: string;
  schema?: string;
  record?: TRecord;
  old_record?: TRecord;
};

/**
 * Ensure the Realtime socket carries the current auth token before joining a
 * private channel. Private channels are authorized via RLS on realtime.messages,
 * and a missing token surfaces as CHANNEL_ERROR. setAuth() with no argument uses
 * the client's current session token.
 */
function authorizeRealtime(): void {
  void supabase.realtime.setAuth();
}

// Pending trailing-edge timers per channel, cleared by unsubscribeFromChannel.
const channelCleanups = new WeakMap<RealtimeChannel, () => void>();

/**
 * Leading + trailing throttle: fires immediately when idle, then coalesces any
 * burst into a single trailing call at most once per `waitMs`.
 */
function throttleWithTrailing(
  fn: () => void,
  waitMs: number
): { call: () => void; cancel: () => void } {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      const now = Date.now();
      if (now - lastRun >= waitMs) {
        lastRun = now;
        fn();
        return;
      }
      if (!timer) {
        timer = setTimeout(
          () => {
            timer = null;
            lastRun = Date.now();
            fn();
          },
          waitMs - (now - lastRun)
        );
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Subscribe to all message events in a conversation (INSERT, UPDATE, DELETE).
 *
 * Uses a private Broadcast channel fed by a database trigger
 * (realtime.broadcast_changes -> topic 'chat:<conversationId>'), authorized by
 * RLS so only conversation participants receive events. This replaces the older
 * postgres_changes subscription.
 */
export function subscribeToMessages(
  conversationId: string,
  onMessageOrCallbacks: ((message: Message) => void) | MessageEventCallback
): RealtimeChannel {
  // Support both legacy single callback and new multi-callback format
  const callbacks: MessageEventCallback =
    typeof onMessageOrCallbacks === 'function'
      ? { onInsert: onMessageOrCallbacks }
      : onMessageOrCallbacks;

  authorizeRealtime();

  const channel = supabase
    .channel(`chat:${conversationId}`, { config: { private: true } })
    // New messages
    .on('broadcast', { event: 'INSERT' }, message => {
      const msg = (message.payload as BroadcastBody<Message>)?.record;
      if (msg) {
        callbacks.onInsert?.({ ...msg, status: msg.status || 'sent' });
      }
    })
    // Message edits
    .on('broadcast', { event: 'UPDATE' }, message => {
      const msg = (message.payload as BroadcastBody<Message>)?.record;
      if (msg) {
        callbacks.onUpdate?.({ ...msg, status: msg.status || 'sent' });
      }
    })
    // Message deletions
    .on('broadcast', { event: 'DELETE' }, message => {
      const oldMsg = (message.payload as BroadcastBody<{ id: string }>)?.old_record;
      if (oldMsg?.id) {
        callbacks.onDelete?.(oldMsg.id);
      }
    })
    .subscribe();

  return channel;
}

/**
 * Subscribe to message reactions in a conversation.
 *
 * Uses a private Broadcast channel fed by a database trigger
 * (realtime.broadcast_changes -> topic 'reactions:<conversationId>'). This
 * replaces the previous table-wide postgres_changes subscription on
 * message_reaction, so reactions are now scoped to the conversation and
 * authorized by RLS.
 */
export function subscribeToReactions(
  conversationId: string,
  onReactionChange: (payload: {
    eventType: 'INSERT' | 'DELETE';
    reaction: unknown;
    messageId: string;
  }) => void
): RealtimeChannel {
  authorizeRealtime();

  const channel = supabase
    .channel(`reactions:${conversationId}`, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, message => {
      const reaction = (message.payload as BroadcastBody<{ message_id?: string }>)?.record;
      if (reaction?.message_id) {
        onReactionChange({ eventType: 'INSERT', reaction, messageId: reaction.message_id });
      }
    })
    .on('broadcast', { event: 'DELETE' }, message => {
      const reaction = (message.payload as BroadcastBody<{ message_id?: string }>)?.old_record;
      if (reaction?.message_id) {
        onReactionChange({ eventType: 'DELETE', reaction, messageId: reaction.message_id });
      }
    })
    .subscribe();

  return channel;
}

/**
 * Subscribe to match-organizer vote changes in a conversation.
 *
 * Uses a private Broadcast channel fed by a database trigger
 * (realtime.broadcast_changes -> topic 'votes:<conversationId>', see
 * 20260626160000_match_time_vote). Lets both players see each other's option
 * votes live without polling. RLS-authorized to conversation participants.
 */
export function subscribeToMatchVotes(
  conversationId: string,
  onVoteChange: (payload: { eventType: 'INSERT' | 'DELETE'; messageId: string }) => void
): RealtimeChannel {
  authorizeRealtime();

  const channel = supabase
    .channel(`votes:${conversationId}`, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, message => {
      const vote = (message.payload as BroadcastBody<{ message_id?: string }>)?.record;
      if (vote?.message_id) {
        onVoteChange({ eventType: 'INSERT', messageId: vote.message_id });
      }
    })
    .on('broadcast', { event: 'DELETE' }, message => {
      const vote = (message.payload as BroadcastBody<{ message_id?: string }>)?.old_record;
      if (vote?.message_id) {
        onVoteChange({ eventType: 'DELETE', messageId: vote.message_id });
      }
    })
    .subscribe();

  return channel;
}

/**
 * Subscribe to conversation updates: new/removed messages in any conversation,
 * plus this player's own conversation_participant changes (e.g. last_read_at
 * updated from another device) so unread counts stay in sync across devices.
 *
 * NOTE: We deliberately ignore message UPDATE events. The unread count formula
 * is driven by conversation_participant.last_read_at — not by message.status —
 * and listening to message UPDATEs would race against mark_messages_as_read.
 */
export function subscribeToConversations(playerId: string, onUpdate: () => void): RealtimeChannel {
  // Every visible message INSERT/DELETE triggers a conversation-list refetch
  // (~120-170ms RPC), so bursts must coalesce instead of stampeding the DB.
  const throttled = throttleWithTrailing(onUpdate, 2000);
  const channel = supabase
    .channel(`conversations:${playerId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message' }, () =>
      throttled.call()
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message' }, () =>
      throttled.call()
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_participant',
        filter: `player_id=eq.${playerId}`,
      },
      () => throttled.call()
    )
    .subscribe();

  channelCleanups.set(channel, throttled.cancel);
  return channel;
}

/**
 * Unsubscribe from a channel
 */
export function unsubscribeFromChannel(channel: RealtimeChannel): void {
  channelCleanups.get(channel)?.();
  channelCleanups.delete(channel);
  void supabase.removeChannel(channel);
}
