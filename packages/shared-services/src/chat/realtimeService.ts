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
 * Subscribe to all message events in a conversation (INSERT, UPDATE, DELETE)
 * Handles new messages, edits, and deletions
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

  const channel = supabase
    .channel(`messages:${conversationId}`)
    // Handle new messages
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'message',
        filter: `conversation_id=eq.${conversationId}`,
      },
      payload => {
        const msg = payload.new as Message;
        callbacks.onInsert?.({
          ...msg,
          status: msg.status || 'sent',
        });
      }
    )
    // Handle message edits
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'message',
        filter: `conversation_id=eq.${conversationId}`,
      },
      payload => {
        const msg = payload.new as Message;
        callbacks.onUpdate?.({
          ...msg,
          status: msg.status || 'sent',
        });
      }
    )
    // Handle message deletions
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'message',
        filter: `conversation_id=eq.${conversationId}`,
      },
      payload => {
        const oldMsg = payload.old as { id: string };
        callbacks.onDelete?.(oldMsg.id);
      }
    )
    .subscribe();

  return channel;
}

/**
 * Subscribe to message reactions in a conversation
 */
export function subscribeToReactions(
  conversationId: string,
  onReactionChange: (payload: {
    eventType: 'INSERT' | 'DELETE';
    reaction: unknown;
    messageId: string;
  }) => void
): RealtimeChannel {
  const channel = supabase
    .channel(`reactions:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'message_reaction',
      },
      payload => {
        const reaction = (payload.new || payload.old) as { message_id?: string };
        if (reaction.message_id) {
          onReactionChange({
            eventType: payload.eventType as 'INSERT' | 'DELETE',
            reaction: payload.new || payload.old,
            messageId: reaction.message_id,
          });
        }
      }
    )
    .subscribe();

  return channel;
}

/**
 * Subscribe to conversation updates (new messages in any conversation)
 * Listens to conversation UPDATE events — triggered automatically by the
 * update_conversation_on_new_message trigger when a message is inserted.
 * RLS ensures only conversations the player participates in are delivered.
 */
export function subscribeToConversations(playerId: string, onUpdate: () => void): RealtimeChannel {
  const channel = supabase
    .channel(`conversations:${playerId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation',
      },
      () => {
        onUpdate();
      }
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
