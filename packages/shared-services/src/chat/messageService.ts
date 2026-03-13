/**
 * Message Service
 * Operations for messages within conversations
 */

import { supabase } from '../supabase';
import type { Message, MessageWithSender, MessageStatus, SendMessageInput } from './chatTypes';

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get messages for a conversation with pagination
 * Includes reply_to message data for reply chains
 */
export async function getMessages(
  conversationId: string,
  options: {
    limit?: number;
    offset?: number;
    before?: string; // Get messages before this timestamp
  } = {}
): Promise<MessageWithSender[]> {
  const { limit = 50, offset = 0, before } = options;

  let query = supabase
    .from('message')
    .select(
      `
      id,
      conversation_id,
      sender_id,
      content,
      status,
      created_at,
      updated_at,
      reply_to_message_id,
      is_edited,
      edited_at,
      deleted_at,
      sender:player!message_sender_id_fkey (
        id,
        profile (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `
    )
    .eq('conversation_id', conversationId)
    .is('deleted_at', null) // Don't fetch soft-deleted messages
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching messages:', error);
    throw error;
  }

  // Get reply_to message data for messages that have replies
  const messagesWithReplies = data || [];
  const replyToIds = messagesWithReplies
    .filter(m => m.reply_to_message_id)
    .map(m => m.reply_to_message_id as string);

  const replyToMap = new Map<string, { id: string; content: string; sender_name: string }>();

  if (replyToIds.length > 0) {
    const { data: replyMessages } = await supabase
      .from('message')
      .select(
        `
        id,
        content,
        sender:player!message_sender_id_fkey (
          profile (
            first_name
          )
        )
      `
      )
      .in('id', replyToIds);

    if (replyMessages) {
      for (const rm of replyMessages) {
        const sender = rm.sender as unknown as { profile: { first_name: string } | null };
        replyToMap.set(rm.id, {
          id: rm.id,
          content: rm.content,
          sender_name: sender?.profile?.first_name || 'Unknown',
        });
      }
    }
  }

  return messagesWithReplies.map(msg => ({
    ...msg,
    status: (msg.status || 'sent') as MessageStatus,
    read_by: null,
    sender: msg.sender as unknown as MessageWithSender['sender'],
    reply_to: msg.reply_to_message_id ? (replyToMap.get(msg.reply_to_message_id) ?? null) : null,
  }));
}

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

/**
 * Send a new message (supports replies)
 * Returns the message with reply_to data populated if it's a reply
 */
export async function sendMessage(input: SendMessageInput): Promise<MessageWithSender> {
  const insertData: Record<string, unknown> = {
    conversation_id: input.conversation_id,
    sender_id: input.sender_id,
    content: input.content,
    status: 'sent',
  };

  // Add reply_to_message_id if provided
  if (input.reply_to_message_id) {
    insertData.reply_to_message_id = input.reply_to_message_id;
  }

  // Build the select query — include reply_to data inline if this is a reply
  const selectFields = `
      id,
      conversation_id,
      sender_id,
      content,
      status,
      created_at,
      updated_at,
      reply_to_message_id,
      is_edited,
      edited_at,
      deleted_at,
      sender:player!message_sender_id_fkey (
        id,
        profile (
          first_name,
          last_name,
          display_name,
          profile_picture_url
        )
      )
    `;

  const { data, error } = await supabase
    .from('message')
    .insert(insertData)
    .select(selectFields)
    .single();

  if (error) {
    console.error('Error sending message:', error);
    throw error;
  }

  // conversation.updated_at is handled by trigger_update_conversation_on_message

  // Fetch reply_to data only if this is a reply
  let replyTo: { id: string; content: string; sender_name: string } | null = null;

  if (input.reply_to_message_id) {
    const { data: replyMessage } = await supabase
      .from('message')
      .select(
        `
        id,
        content,
        sender:player!message_sender_id_fkey (
          profile (
            first_name
          )
        )
      `
      )
      .eq('id', input.reply_to_message_id)
      .single();

    if (replyMessage) {
      const sender = replyMessage.sender as unknown as { profile: { first_name: string } | null };
      replyTo = {
        id: replyMessage.id,
        content: replyMessage.content,
        sender_name: sender?.profile?.first_name || 'Unknown',
      };
    }
  }

  return {
    ...data,
    status: (data.status || 'sent') as MessageStatus,
    read_by: null,
    sender: data.sender as unknown as MessageWithSender['sender'],
    reply_to: replyTo,
  };
}

/**
 * Mark messages as read up to a certain point
 * Updates both conversation_participant.last_read_at AND message.status
 * Uses RPC function to bypass RLS (since recipient is not the sender)
 */
export async function markMessagesAsRead(conversationId: string, playerId: string): Promise<void> {
  // Update the participant's last_read_at
  const { error: participantError } = await supabase
    .from('conversation_participant')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId);

  if (participantError) {
    console.error('Error updating participant last_read_at:', participantError);
    throw participantError;
  }

  // Use RPC function to update message status to 'read'
  // This bypasses RLS which only allows sender to update their own messages
  const { error: messageError } = await supabase.rpc('mark_messages_as_read', {
    p_conversation_id: conversationId,
    p_reader_id: playerId,
  });

  if (messageError) {
    console.error('Error updating message status to read:', messageError);
    // Don't throw here - the participant update succeeded,
    // and this is a secondary update for status display
  }
}

/**
 * Mark messages as delivered when recipient receives/fetches them
 * Called when messages are fetched or received via realtime
 * Uses RPC function to bypass RLS
 */
export async function markMessagesAsDelivered(
  conversationId: string,
  recipientId: string
): Promise<void> {
  // Use RPC function to update message status to 'delivered'
  const { error } = await supabase.rpc('mark_messages_as_delivered', {
    p_conversation_id: conversationId,
    p_recipient_id: recipientId,
  });

  if (error) {
    console.error('Error updating message status to delivered:', error);
    // Don't throw - this is a non-critical update
  }
}

/**
 * Mark a single message as delivered (for realtime incoming messages)
 * Uses RPC function to bypass RLS
 */
export async function markMessageAsDelivered(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_message_as_delivered', {
    p_message_id: messageId,
  });

  if (error) {
    console.error('Error updating single message status to delivered:', error);
  }
}

/**
 * Soft delete a message (shows "This message was deleted")
 * Only the sender can delete their own messages
 */
export async function deleteMessage(messageId: string, senderId: string): Promise<void> {
  // Soft delete - set deleted_at timestamp
  const { error } = await supabase
    .from('message')
    .update({
      deleted_at: new Date().toISOString(),
      content: '', // Clear content for privacy
    })
    .eq('id', messageId)
    .eq('sender_id', senderId);

  if (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
}

/**
 * Edit a message (only sender can edit)
 */
export async function editMessage(
  messageId: string,
  senderId: string,
  newContent: string
): Promise<Message | null> {
  const { data, error } = await supabase
    .from('message')
    .update({
      content: newContent,
      is_edited: true,
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId)
    .eq('sender_id', senderId)
    .select()
    .single();

  if (error) {
    console.error('Error editing message:', error);
    throw error;
  }

  return data
    ? {
        ...data,
        status: (data.status || 'sent') as MessageStatus,
        read_by: null,
      }
    : null;
}

/**
 * Clear all messages in a conversation for a specific user
 * This soft-deletes messages sent by the user only
 */
export async function clearChatForUser(conversationId: string, playerId: string): Promise<number> {
  // Soft delete all messages sent by this user in this conversation
  const { data, error } = await supabase
    .from('message')
    .update({
      deleted_at: new Date().toISOString(),
      content: '', // Clear content for privacy
    })
    .eq('conversation_id', conversationId)
    .eq('sender_id', playerId)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('Error clearing chat:', error);
    throw error;
  }

  return data?.length || 0;
}
