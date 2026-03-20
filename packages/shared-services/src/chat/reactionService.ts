/**
 * Reaction Service
 * Operations for emoji reactions on messages
 */

import { supabase } from '../supabase';
import type { ReactionSummary } from './chatTypes';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Common emoji reactions (like WhatsApp)
 */
export const COMMON_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Add a reaction to a message
 */
export async function addReaction(
  messageId: string,
  playerId: string,
  emoji: string
): Promise<void> {
  const { error } = await supabase.from('message_reaction').insert({
    message_id: messageId,
    player_id: playerId,
    emoji: emoji,
  });

  if (error) {
    // Ignore duplicate error (user already reacted with this emoji)
    if (error.code !== '23505') {
      console.error('Error adding reaction:', error);
      throw error;
    }
  }
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  messageId: string,
  playerId: string,
  emoji: string
): Promise<void> {
  const { error } = await supabase
    .from('message_reaction')
    .delete()
    .eq('message_id', messageId)
    .eq('player_id', playerId)
    .eq('emoji', emoji);

  if (error) {
    console.error('Error removing reaction:', error);
    throw error;
  }
}

/**
 * Toggle a reaction (add if not exists, remove if exists)
 * If user already has a different reaction, replace it with the new one
 */
export async function toggleReaction(
  messageId: string,
  playerId: string,
  emoji: string
): Promise<{ added: boolean }> {
  // Check if this exact reaction exists (same emoji)
  const { data: existingSame } = await supabase
    .from('message_reaction')
    .select('id')
    .eq('message_id', messageId)
    .eq('player_id', playerId)
    .eq('emoji', emoji)
    .single();

  if (existingSame) {
    // User tapped the same emoji - remove it (toggle off)
    await removeReaction(messageId, playerId, emoji);
    return { added: false };
  }

  // Check if user has a different reaction on this message
  const { data: existingOther } = await supabase
    .from('message_reaction')
    .select('id, emoji')
    .eq('message_id', messageId)
    .eq('player_id', playerId)
    .single();

  if (existingOther) {
    // Remove the old reaction first
    await removeReaction(messageId, playerId, existingOther.emoji);
  }

  // Add the new reaction
  await addReaction(messageId, playerId, emoji);
  return { added: true };
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get reactions for a message
 */
export async function getMessageReactions(
  messageId: string,
  currentPlayerId: string
): Promise<ReactionSummary[]> {
  const { data, error } = await supabase
    .from('message_reaction')
    .select(
      `
      id,
      emoji,
      player_id,
      player:player!message_reaction_player_id_fkey (
        id,
        profile (
          first_name
        )
      )
    `
    )
    .eq('message_id', messageId);

  if (error) {
    console.error('Error fetching reactions:', error);
    throw error;
  }

  // Group by emoji
  const reactionMap = new Map<string, ReactionSummary>();

  for (const reaction of data || []) {
    const emoji = reaction.emoji;
    const player = reaction.player as unknown as {
      id: string;
      profile: { first_name: string } | null;
    };

    if (!reactionMap.has(emoji)) {
      reactionMap.set(emoji, {
        emoji,
        count: 0,
        players: [],
        hasReacted: false,
      });
    }

    const summary = reactionMap.get(emoji)!;
    summary.count++;
    summary.players.push({
      id: player.id,
      first_name: player.profile?.first_name || 'Unknown',
    });

    if (reaction.player_id === currentPlayerId) {
      summary.hasReacted = true;
    }
  }

  return Array.from(reactionMap.values());
}

/**
 * Get reactions for multiple messages (batch operation)
 */
export async function getMessagesReactions(
  messageIds: string[],
  currentPlayerId: string
): Promise<Map<string, ReactionSummary[]>> {
  const { data, error } = await supabase
    .from('message_reaction')
    .select(
      `
      id,
      message_id,
      emoji,
      player_id,
      player:player!message_reaction_player_id_fkey (
        id,
        profile (
          first_name
        )
      )
    `
    )
    .in('message_id', messageIds);

  if (error) {
    console.error('Error fetching reactions:', error);
    throw error;
  }

  // Group by message, then by emoji
  const result = new Map<string, ReactionSummary[]>();

  for (const messageId of messageIds) {
    result.set(messageId, []);
  }

  const messageReactionMaps = new Map<string, Map<string, ReactionSummary>>();

  for (const reaction of data || []) {
    const { message_id: messageId, emoji } = reaction;
    const player = reaction.player as unknown as {
      id: string;
      profile: { first_name: string } | null;
    };

    if (!messageReactionMaps.has(messageId)) {
      messageReactionMaps.set(messageId, new Map());
    }

    const emojiMap = messageReactionMaps.get(messageId)!;

    if (!emojiMap.has(emoji)) {
      emojiMap.set(emoji, {
        emoji,
        count: 0,
        players: [],
        hasReacted: false,
      });
    }

    const summary = emojiMap.get(emoji)!;
    summary.count++;
    summary.players.push({
      id: player.id,
      first_name: player.profile?.first_name || 'Unknown',
    });

    if (reaction.player_id === currentPlayerId) {
      summary.hasReacted = true;
    }
  }

  // Convert maps to arrays
  for (const [messageId, emojiMap] of messageReactionMaps) {
    result.set(messageId, Array.from(emojiMap.values()));
  }

  return result;
}
