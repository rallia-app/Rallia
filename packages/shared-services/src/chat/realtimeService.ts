/**
 * Realtime Service
 * Real-time subscriptions for messages, conversations, and typing indicators
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../supabase';

import type { Message, TypingIndicator } from './chatTypes';

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
 * Subscribe to conversation updates: new/removed messages in any conversation,
 * plus this player's own conversation_participant changes (e.g. last_read_at
 * updated from another device) so unread counts stay in sync across devices.
 *
 * NOTE: We deliberately ignore message UPDATE events. The unread count formula
 * is driven by conversation_participant.last_read_at — not by message.status —
 * and listening to message UPDATEs would race against mark_messages_as_read.
 */
export function subscribeToConversations(playerId: string, onUpdate: () => void): RealtimeChannel {
  const channel = supabase
    .channel(`conversations:${playerId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message' }, () =>
      onUpdate()
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message' }, () =>
      onUpdate()
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_participant',
        filter: `player_id=eq.${playerId}`,
      },
      () => onUpdate()
    )
    .subscribe();

  return channel;
}

/**
 * Unsubscribe from a channel
 */
export function unsubscribeFromChannel(channel: RealtimeChannel): void {
  void supabase.removeChannel(channel);
}

// ============================================================================
// TYPING INDICATORS (using Supabase Realtime Presence)
// ============================================================================

// Store for active typing channels
const typingChannels = new Map<string, RealtimeChannel>();

/**
 * Subscribe to typing indicators in a conversation
 * Uses Supabase Realtime Presence for real-time typing updates
 */
export function subscribeToTypingIndicators(
  conversationId: string,
  playerId: string,
  playerName: string,
  onTypingChange: (typingUsers: TypingIndicator[]) => void
): RealtimeChannel {
  const channelName = `typing:${conversationId}`;

  // Clean up existing channel if any
  const existingChannel = typingChannels.get(channelName);
  if (existingChannel) {
    void supabase.removeChannel(existingChannel);
  }

  const channel = supabase.channel(channelName, {
    config: {
      presence: {
        key: playerId,
      },
    },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const typingUsers: TypingIndicator[] = [];

      for (const [key, presences] of Object.entries(state)) {
        if (key !== playerId) {
          const presence = presences[0] as {
            player_name?: string;
            timestamp?: number;
            is_typing?: boolean;
          };
          // Only include users who are actively typing
          if (presence && presence.is_typing === true) {
            typingUsers.push({
              player_id: key,
              player_name: presence.player_name || 'Someone',
              conversation_id: conversationId,
              timestamp: presence.timestamp || Date.now(),
            });
          }
        }
      }

      onTypingChange(typingUsers);
    })
    .subscribe(status => {
      if ((status as string) === 'SUBSCRIBED') {
        // Track presence with player info
        void channel.track({
          player_name: playerName,
          timestamp: Date.now(),
          is_typing: false,
        });
      }
    });

  typingChannels.set(channelName, channel);
  return channel;
}

/**
 * Send typing indicator (call when user starts/stops typing)
 */
export async function sendTypingIndicator(
  conversationId: string,
  playerId: string,
  playerName: string,
  isTyping: boolean
): Promise<void> {
  const channelName = `typing:${conversationId}`;
  const channel = typingChannels.get(channelName);

  if (channel) {
    await channel.track({
      player_name: playerName,
      timestamp: Date.now(),
      is_typing: isTyping,
    });
  }
}

/**
 * Unsubscribe from typing indicators
 */
export function unsubscribeFromTypingIndicators(conversationId: string): void {
  const channelName = `typing:${conversationId}`;
  const channel = typingChannels.get(channelName);

  if (channel) {
    void supabase.removeChannel(channel);
    typingChannels.delete(channelName);
  }
}
