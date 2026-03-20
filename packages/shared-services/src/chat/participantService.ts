/**
 * Participant Service
 * Operations for managing conversation participants (mute, pin, archive, leave, add)
 */

import { supabase } from '../supabase';

// ============================================================================
// MUTE OPERATIONS
// ============================================================================

/**
 * Toggle mute status for a conversation
 */
export async function toggleMuteConversation(
  conversationId: string,
  playerId: string,
  isMuted: boolean
): Promise<void> {
  const { error } = await supabase
    .from('conversation_participant')
    .update({ is_muted: isMuted })
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error toggling mute:', error);
    throw error;
  }
}

// ============================================================================
// LEAVE / JOIN OPERATIONS
// ============================================================================

/**
 * Leave a conversation (for group conversations)
 */
export async function leaveConversation(conversationId: string, playerId: string): Promise<void> {
  const { error } = await supabase
    .from('conversation_participant')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error leaving conversation:', error);
    throw error;
  }
}

/**
 * Add participant to a conversation
 */
export async function addParticipant(conversationId: string, playerId: string): Promise<void> {
  const { error } = await supabase.from('conversation_participant').insert({
    conversation_id: conversationId,
    player_id: playerId,
  });

  if (error) {
    // Ignore if already a participant
    if (error.code !== '23505') {
      console.error('Error adding participant:', error);
      throw error;
    }
  }
}

/**
 * Add a participant to a conversation (with return value)
 */
export async function addConversationParticipant(
  conversationId: string,
  playerId: string
): Promise<boolean> {
  // Check if already a participant
  const { data: existing } = await supabase
    .from('conversation_participant')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId)
    .single();

  if (existing) {
    return true; // Already a participant
  }

  const { error } = await supabase.from('conversation_participant').insert({
    conversation_id: conversationId,
    player_id: playerId,
  });

  if (error) {
    console.error('Error adding participant:', error);
    throw error;
  }

  return true;
}

/**
 * Remove a participant from a conversation
 */
export async function removeConversationParticipant(
  conversationId: string,
  playerId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('conversation_participant')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error removing participant:', error);
    throw error;
  }

  return true;
}

// ============================================================================
// PIN OPERATIONS
// ============================================================================

/**
 * Toggle pin status for a conversation
 */
export async function togglePinConversation(
  conversationId: string,
  playerId: string,
  isPinned: boolean
): Promise<void> {
  const { error } = await supabase
    .from('conversation_participant')
    .update({
      is_pinned: isPinned,
      pinned_at: isPinned ? new Date().toISOString() : null,
    })
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error toggling pin:', error);
    throw error;
  }
}

// ============================================================================
// ARCHIVE OPERATIONS
// ============================================================================

/**
 * Toggle archive status for a conversation
 */
export async function toggleArchiveConversation(
  conversationId: string,
  playerId: string,
  isArchived: boolean
): Promise<void> {
  const { error } = await supabase
    .from('conversation_participant')
    .update({
      is_archived: isArchived,
      archived_at: isArchived ? new Date().toISOString() : null,
    })
    .eq('conversation_id', conversationId)
    .eq('player_id', playerId);

  if (error) {
    console.error('Error toggling archive:', error);
    throw error;
  }
}
