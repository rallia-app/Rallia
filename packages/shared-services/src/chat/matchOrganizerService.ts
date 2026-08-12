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
  free_count?: number | null;
  option_key?: string | null;
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
    ...(row.free_count != null ? { free_count: row.free_count } : {}),
    ...(row.option_key ? { option_key: row.option_key } : {}),
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

  // Graceful degradation: keep both tiers. Confirmed-court slots lead (each tier
  // chronological), with usually-free favorite-facility slots as the fallback so
  // shared times still get suggested when no court feed reaches that far out.
  const mapped: MatchOrganizerOption[] = (data ?? []).map(toOption);
  return mapped.sort((a, b) => {
    if (a.court_confirmed !== b.court_confirmed) return a.court_confirmed ? -1 : 1;
    return new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime();
  });
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

/**
 * The sport of the tournament behind a round chat (via its tournament_match_id),
 * so the organizer flow can force the tournament's sport instead of guessing a
 * shared one. Returns null when it can't be resolved.
 */
export async function getTournamentMatchSportId(tournamentMatchId: string): Promise<string | null> {
  const { data: tm, error: tmError } = await supabase
    .from('tournament_matches')
    .select('tournament_id')
    .eq('id', tournamentMatchId)
    .single();
  if (tmError || !tm?.tournament_id) {
    if (tmError) console.error('Error resolving tournament match:', tmError);
    return null;
  }

  const { data: tournament, error: tError } = await supabase
    .from('tournaments')
    .select('sport_id')
    .eq('id', tm.tournament_id)
    .single();
  if (tError) {
    console.error('Error resolving tournament sport:', tError);
    return null;
  }
  return tournament?.sport_id ?? null;
}

/**
 * The sport of the league behind a session pairing chat (via its
 * session_match_id), so the organizer flow can force the league's sport instead
 * of guessing a shared one. Returns null when it can't be resolved.
 */
export async function getSessionMatchSportId(sessionMatchId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('session_matches')
    .select('sessions!inner ( seasons!inner ( leagues!inner ( sport_id ) ) )')
    .eq('id', sessionMatchId)
    .single();
  if (error) {
    console.error('Error resolving session match sport:', error);
    return null;
  }
  // These are all to-one embeds, so PostgREST nests objects; the generated
  // types widen them to arrays, hence the narrowing.
  const row = data as unknown as {
    sessions?: { seasons?: { leagues?: { sport_id?: string | null } | null } | null } | null;
  } | null;
  return row?.sessions?.seasons?.leagues?.sport_id ?? null;
}

/**
 * Re-run the suggestion engine for a pairing's auto-posted card and rewrite it
 * in place. Called after a player edits their availability from the round chat,
 * so widening your hours immediately turns "no shared times" into real options.
 *
 * Votes follow their time slot (re-anchored on option_key); a voted option the
 * engine no longer returns is kept and flagged stale rather than dropped. Cards
 * that already produced a game are left alone. Returns the card's message id, or
 * null when the pairing has no system card.
 */
export async function regenerateRoundChatSuggestions(
  tournamentMatchId: string,
  actorId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('lt_regenerate_system_organizer_card', {
    p_tournament_match_id: tournamentMatchId,
    p_actor_id: actorId,
  });

  if (error) {
    console.error('Error regenerating organizer card:', error);
    throw error;
  }

  return (data as string | null) ?? null;
}

/**
 * Propose your own time (and optionally a place) on a card. This is the
 * degradation floor: when the engine has nothing to offer because two players
 * share no free hours, or neither has a facility the app knows, a participant
 * can still put a slot on the card and the normal vote/create flow takes over.
 *
 * Proposing counts as agreeing, so the proposer is voted onto it. Proposing a
 * slot that already exists on the card just records the vote. Returns the
 * option's index.
 */
export async function addCustomOrganizerOption(params: {
  messageId: string;
  /** ISO instant of the proposed start. */
  slotStart: string;
  facilityId?: string | null;
  /** Free-text place, used when no facility is picked. Both may be omitted. */
  placeName?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc('match_organizer_add_custom_option', {
    p_message_id: params.messageId,
    p_slot_start: params.slotStart,
    ...(params.facilityId ? { p_facility_id: params.facilityId } : {}),
    ...(params.placeName ? { p_place_name: params.placeName } : {}),
  });

  if (error) {
    console.error('Error proposing a custom organizer option:', error);
    throw error;
  }

  return data as number;
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
    posted_by: 'player',
    options: params.options,
    created_match_id: null,
    confirmed_option_index: null,
  };

  const message = await sendMessage({
    conversation_id: params.conversationId,
    sender_id: params.organizerId,
    content: params.previewText ?? 'Suggested some times to play',
    message_type: 'match_organizer',
    metadata,
  });

  // The organizer's selection IS their thumbs-up — pre-vote every posted option
  // so they don't have to tap them again on their own card.
  if (params.options.length > 0) {
    const { error } = await supabase.from('match_time_vote').insert(
      params.options.map((_, index) => ({
        message_id: message.id,
        player_id: params.organizerId,
        option_index: index,
      }))
    );
    // Non-fatal: the card still works; the organizer can thumbs-up manually.
    if (error && error.code !== '23505') {
      console.error('Error pre-voting organizer options:', error);
    }
  }

  return message;
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
  /** Free-text place from a custom option (ignored when a facility is chosen). */
  locationName?: string | null;
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
    ...(params.locationName ? { p_location_name: params.locationName } : {}),
  });

  if (error) {
    console.error('Error creating casual match:', error);
    throw error;
  }

  return data as string;
}
