/**
 * Match Organizer Service
 *
 * Backs the chat "Match Organizer" card: a votable time/place scheduling card
 * any chat participant can post. It snapshots ranked options (availability
 * overlap x favorited facilities x live court slots — see the
 * match_organizer_options engine) into the message metadata, lets every
 * participant thumbs-up the options they'd be good with, and creates a fully
 * pre-joined private match once an option is mutually agreed.
 *
 * Votes mirror message_reaction (per-user, per-message, insert/delete toggle)
 * but key on an option_index instead of an emoji.
 */

import { supabase } from '../supabase';

import type { MatchOrganizerMetadata, MatchOrganizerOption, MessageWithSender } from './chatTypes';
import { sendMessage } from './messageService';

// ============================================================================
// SUGGESTION ENGINE
// ============================================================================

/** Map an engine row onto the leaner option snapshot stored in the card. */
function toOption(row: {
  slot_start: string;
  day_label: string;
  hour_of_day: number;
  facility_id: string | null;
  facility_name: string | null;
  court_name: string | null;
  court_count: number | null;
  price_cents: number | null;
  court_confirmed: boolean;
  tier: string;
  distance_km: number | null;
}): MatchOrganizerOption {
  return {
    slot_start: row.slot_start,
    day_label: row.day_label,
    hour_of_day: row.hour_of_day,
    facility_id: row.facility_id,
    facility_name: row.facility_name,
    court_name: row.court_name,
    court_count: row.court_count ?? 0,
    price_cents: row.price_cents,
    court_confirmed: row.court_confirmed,
    tier: row.tier === 'bookable' ? 'bookable' : 'usually_free',
    distance_km: row.distance_km,
  };
}

/**
 * Ranked time/place options for a set of players + sport. Read-only; the result
 * is meant to be snapshotted into a card via postMatchOrganizerCard.
 */
export async function getMatchOrganizerOptions(
  playerIds: string[],
  sportId: string,
  options: { windowDays?: number; limit?: number } = {}
): Promise<MatchOrganizerOption[]> {
  const { data, error } = await supabase.rpc('match_organizer_options', {
    p_player_ids: playerIds,
    p_sport_id: sportId,
    p_window_days: options.windowDays ?? 14,
    p_limit: options.limit ?? 6,
  });

  if (error) {
    console.error('Error fetching match organizer options:', error);
    throw error;
  }

  return (data ?? []).map(toOption);
}

// ============================================================================
// SPORT RESOLUTION
// ============================================================================

export interface OrganizerSport {
  id: string;
  /** Lowercase sport key (e.g. 'tennis') — used for the sport icon. */
  name: string;
  /** Human label (e.g. 'Tennis') — used for display. */
  displayName: string;
}

/**
 * Sports played by EVERY listed player (intersection of their player_sport
 * rows), so the organizer defaults to common ground. Falls back to the union
 * of the players' sports when there is no shared sport, so the picker is never
 * empty.
 */
export async function getSharedSports(playerIds: string[]): Promise<OrganizerSport[]> {
  const uniqueIds = Array.from(new Set(playerIds));
  if (uniqueIds.length === 0) return [];

  const { data, error } = await supabase
    .from('player_sport')
    .select('player_id, sport_id, sport(id, name, display_name)')
    .in('player_id', uniqueIds)
    .eq('is_active', true);

  if (error) {
    console.error('Error resolving shared sports:', error);
    throw error;
  }

  const bySport = new Map<string, { name: string; displayName: string; players: Set<string> }>();
  for (const row of data ?? []) {
    const sport = row.sport as unknown as {
      id: string;
      name: string;
      display_name: string | null;
    } | null;
    if (!sport) continue;
    if (!bySport.has(sport.id)) {
      bySport.set(sport.id, {
        name: sport.name,
        displayName: sport.display_name ?? sport.name,
        players: new Set(),
      });
    }
    bySport.get(sport.id)!.players.add(row.player_id);
  }

  const shared: OrganizerSport[] = [];
  const all: OrganizerSport[] = [];
  for (const [id, info] of bySport) {
    const entry: OrganizerSport = { id, name: info.name, displayName: info.displayName };
    all.push(entry);
    if (info.players.size === uniqueIds.length) {
      shared.push(entry);
    }
  }

  return shared.length > 0 ? shared : all;
}

// ============================================================================
// CARD POSTING
// ============================================================================

/**
 * Post a match_organizer card into a conversation. The options are snapshotted
 * into the message metadata so an option_index is stable for everyone voting.
 */
export async function postMatchOrganizerCard(params: {
  conversationId: string;
  organizerId: string;
  sportId: string;
  sportName: string | null;
  format: 'singles' | 'doubles';
  participantIds: string[];
  options: MatchOrganizerOption[];
  /** Plain-text fallback used in conversation-list previews / push. */
  previewText?: string;
}): Promise<MessageWithSender> {
  const metadata: MatchOrganizerMetadata = {
    kind: 'match_organizer',
    sport_id: params.sportId,
    sport_name: params.sportName,
    format: params.format,
    participant_ids: Array.from(new Set(params.participantIds)),
    organizer_id: params.organizerId,
    options: params.options,
    created_match_id: null,
    confirmed_option_index: null,
  };

  return sendMessage({
    conversation_id: params.conversationId,
    sender_id: params.organizerId,
    content: params.previewText ?? 'Suggested some times to play',
    message_type: 'match_organizer',
    metadata,
  });
}

// ============================================================================
// VOTES
// ============================================================================

export interface MatchTimeVote {
  player_id: string;
  option_index: number;
}

/** All votes on a single organizer card. */
export async function getMatchTimeVotes(messageId: string): Promise<MatchTimeVote[]> {
  const { data, error } = await supabase
    .from('match_time_vote')
    .select('player_id, option_index')
    .eq('message_id', messageId);

  if (error) {
    console.error('Error fetching match time votes:', error);
    throw error;
  }

  return data ?? [];
}

export async function addMatchTimeVote(
  messageId: string,
  playerId: string,
  optionIndex: number
): Promise<void> {
  const { error } = await supabase.from('match_time_vote').insert({
    message_id: messageId,
    player_id: playerId,
    option_index: optionIndex,
  });

  // Ignore duplicate (already voted for this option).
  if (error && error.code !== '23505') {
    console.error('Error adding match time vote:', error);
    throw error;
  }
}

export async function removeMatchTimeVote(
  messageId: string,
  playerId: string,
  optionIndex: number
): Promise<void> {
  const { error } = await supabase
    .from('match_time_vote')
    .delete()
    .eq('message_id', messageId)
    .eq('player_id', playerId)
    .eq('option_index', optionIndex);

  if (error) {
    console.error('Error removing match time vote:', error);
    throw error;
  }
}

/** Toggle a vote: remove if the player already voted for this option, else add. */
export async function toggleMatchTimeVote(
  messageId: string,
  playerId: string,
  optionIndex: number,
  hasVoted: boolean
): Promise<{ voted: boolean }> {
  if (hasVoted) {
    await removeMatchTimeVote(messageId, playerId, optionIndex);
    return { voted: false };
  }
  await addMatchTimeVote(messageId, playerId, optionIndex);
  return { voted: true };
}

// ============================================================================
// MATCH CREATION
// ============================================================================

/**
 * Create a private casual match from a mutually-agreed option. Every chosen
 * player is dropped in as a joined participant. Idempotent on the source card.
 * Returns the match id.
 */
export async function createCasualMatch(params: {
  sportId: string;
  slotStart: string;
  playerIds: string[];
  format?: 'singles' | 'doubles';
  facilityId?: string | null;
  durationMinutes?: number;
  sourceMessageId?: string;
  optionIndex?: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_casual_match', {
    p_sport_id: params.sportId,
    p_slot_start: params.slotStart,
    p_player_ids: params.playerIds,
    p_format: params.format ?? 'singles',
    p_duration_minutes: params.durationMinutes ?? 60,
    ...(params.facilityId ? { p_facility_id: params.facilityId } : {}),
    ...(params.sourceMessageId ? { p_source_message_id: params.sourceMessageId } : {}),
    ...(params.optionIndex != null ? { p_option_index: params.optionIndex } : {}),
  });

  if (error) {
    console.error('Error creating casual match:', error);
    throw error;
  }

  return data as string;
}
