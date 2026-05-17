/**
 * Match Time Suggestion Service
 *
 * Counter-proposal flow: invitees and joined participants can suggest a
 * different start time on a match without leaving the invite hanging. The
 * creator accepts, declines, or lets the suggestion expire alongside any
 * direct host edit (handled in matchService.updateMatch).
 *
 * Time-of-day only — the date and timezone stay pinned to the parent match.
 * Duration is preserved server-side when the host accepts.
 */

import type { MatchTimeSuggestion, MatchTimeSuggestionStatus } from '@rallia/shared-types';

import { supabase } from '../supabase';
import { Logger } from '../logger';
import {
  notifyMatchTimeSuggested,
  notifyMatchTimeSuggestionAccepted,
  notifyMatchTimeSuggestionDeclined,
  notifyMatchUpdated,
} from '../notifications/notificationFactory';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MatchTimeSuggestionWithSuggester extends MatchTimeSuggestion {
  suggester?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    profile_picture_url: string | null;
    display_name?: string | null;
  } | null;
}

interface AcceptRpcResult {
  match_id: string;
  suggestion_id: string;
  suggester_id: string;
  suggester_was_pending: boolean;
  previous_start_time: string;
  previous_end_time: string;
  new_start_time: string;
  new_end_time: string;
  match_date: string;
  timezone: string;
  superseded_suggestion_ids: string[];
  participant_ids_to_notify: string[];
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

/**
 * Fetch all time suggestions for a match. RLS filters: the match creator sees
 * everything; everyone else sees only their own row(s).
 *
 * Pending rows always come first, then most-recently-resolved.
 */
export async function listTimeSuggestionsForMatch(
  matchId: string
): Promise<MatchTimeSuggestionWithSuggester[]> {
  // `player` and `profile` share the same UUID (`player.id = profile.id`,
  // no separate `profile_id` FK), so PostgREST can't auto-embed profile via
  // player. We fetch the suggestions first, then batch-fetch the suggester
  // profiles by id.
  const { data: rows, error } = await supabase
    .from('match_time_suggestion')
    .select(
      'id, match_id, suggester_id, suggested_start_time, note, status, created_at, resolved_at, resolved_by'
    )
    .eq('match_id', matchId)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list time suggestions: ${error.message}`);
  }

  const suggestionRows = (rows ?? []) as MatchTimeSuggestion[];
  if (suggestionRows.length === 0) return [];

  const uniqueSuggesterIds = Array.from(new Set(suggestionRows.map(r => r.suggester_id)));
  const { data: profileRows, error: profileError } = await supabase
    .from('profile')
    .select('id, first_name, last_name, profile_picture_url, display_name')
    .in('id', uniqueSuggesterIds);

  if (profileError) {
    // Surface as an empty profile rather than failing — the suggestions are
    // still the source of truth; missing names just degrade the UI.
    Logger.error('Failed to batch-fetch suggester profiles', new Error(profileError.message));
  }

  const profileById = new Map<
    string,
    {
      first_name: string | null;
      last_name: string | null;
      profile_picture_url: string | null;
      display_name: string | null;
    }
  >();
  for (const p of (profileRows ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    profile_picture_url: string | null;
    display_name: string | null;
  }>) {
    profileById.set(p.id, {
      first_name: p.first_name,
      last_name: p.last_name,
      profile_picture_url: p.profile_picture_url,
      display_name: p.display_name,
    });
  }

  return suggestionRows.map(row => {
    const prof = profileById.get(row.suggester_id) ?? null;
    return {
      ...row,
      suggester: prof
        ? {
            id: row.suggester_id,
            first_name: prof.first_name,
            last_name: prof.last_name,
            profile_picture_url: prof.profile_picture_url,
            display_name: prof.display_name,
          }
        : null,
    };
  });
}

/** The caller's own active suggestion (if any) for a given match. */
export async function getMyPendingTimeSuggestion(
  matchId: string,
  playerId: string
): Promise<MatchTimeSuggestion | null> {
  const { data, error } = await supabase
    .from('match_time_suggestion')
    .select('*')
    .eq('match_id', matchId)
    .eq('suggester_id', playerId)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load your time suggestion: ${error.message}`);
  }
  return data as MatchTimeSuggestion | null;
}

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

export interface SuggestMatchTimeParams {
  matchId: string;
  suggestedStartTime: string; // HH:MM or HH:MM:SS, interpreted in match.timezone
  note?: string | null;
}

/**
 * Create a pending time suggestion. The partial-unique index enforces one
 * pending row per (match, suggester) — if a row already exists, the caller
 * should withdraw it first.
 *
 * Returns the inserted row and fires the host-side push notification (best
 * effort — failure is logged, not surfaced).
 */
export async function suggestMatchTime(
  params: SuggestMatchTimeParams
): Promise<MatchTimeSuggestion> {
  const { matchId, suggestedStartTime, note } = params;

  const { data: caller } = await supabase.auth.getUser();
  const callerId = caller.user?.id;
  if (!callerId) {
    throw new Error('Not authenticated');
  }

  const { data, error } = await supabase
    .from('match_time_suggestion')
    .insert({
      match_id: matchId,
      suggester_id: callerId,
      suggested_start_time: suggestedStartTime,
      note: note?.trim() ? note.trim() : null,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation — partial index on (match_id, suggester_id) WHERE status='pending'.
    if (error.code === '23505') {
      throw new Error('already_pending');
    }
    // Trigger-raised exception when the suggested time equals the parent
    // match.start_time. Race case (host edited mid-flight) — client already
    // disables submit for the no-race version.
    if (error.message?.includes('suggested_time_matches_current_time')) {
      throw new Error('same_as_current_time');
    }
    throw new Error(`Failed to send time suggestion: ${error.message}`);
  }

  const inserted = data as MatchTimeSuggestion;

  // Side effect: notify the host. Best-effort — do not block the caller on
  // notification delivery, but log so we can debug missed pushes.
  void fireSuggestedNotification(matchId, callerId, inserted).catch(err => {
    Logger.error('Failed to fire match_time_suggested notification:', err);
  });

  return inserted;
}

async function fireSuggestedNotification(
  matchId: string,
  callerId: string,
  inserted: MatchTimeSuggestion
): Promise<void> {
  // We need: host's player.id (target user for the notification) + sport name
  // + match_date + suggester display name.
  const { data: matchRow } = await supabase
    .from('match')
    .select(
      `
        created_by,
        match_date,
        sport:sport_id ( name )
      `
    )
    .eq('id', matchId)
    .maybeSingle();

  if (!matchRow) return;

  const { data: callerProfile } = await supabase
    .from('profile')
    .select('first_name, last_name, display_name')
    .eq('id', callerId)
    .maybeSingle();

  const suggesterName =
    (callerProfile as { display_name?: string | null } | null)?.display_name ||
    `${(callerProfile as { first_name?: string | null } | null)?.first_name ?? ''} ${(
      (callerProfile as { last_name?: string | null } | null)?.last_name ?? ''
    ).charAt(0)}`.trim() ||
    'A player';

  const sportName = (matchRow.sport as { name?: string } | null)?.name;
  const hostUserId = (matchRow as { created_by?: string } | null)?.created_by;
  if (!hostUserId) return;

  await notifyMatchTimeSuggested(
    hostUserId,
    matchId,
    suggesterName,
    inserted.suggested_start_time,
    (matchRow as { match_date?: string } | null)?.match_date ?? undefined,
    sportName,
    inserted.note ?? undefined
  );
}

export interface RespondToTimeSuggestionParams {
  suggestionId: string;
  accept: boolean;
}

export type RespondToTimeSuggestionResult =
  | { kind: 'accepted'; result: AcceptRpcResult }
  | { kind: 'declined'; matchId: string; suggesterId: string }
  | { kind: 'error'; reason: 'match_full_after_suggestion' | string };

/**
 * Host responds to a pending suggestion.
 *
 *  - On accept: invokes the atomic `accept_match_time_suggestion` RPC which
 *    updates the match window, supersedes other pending suggestions, and
 *    auto-joins the suggester if they were a pending invitee. We then fan
 *    out the `match_updated` broadcast (matching the path used by
 *    matchService.updateMatch) and DM the suggester.
 *  - On decline: plain RLS UPDATE — the suggester is notified separately.
 */
export async function respondToTimeSuggestion(
  params: RespondToTimeSuggestionParams
): Promise<RespondToTimeSuggestionResult> {
  const { suggestionId, accept } = params;

  // Load the suggestion + parent match details up-front so we can DM the
  // suggester and broadcast to participants without re-fetching afterward.
  const { data: suggestionRow, error: loadErr } = await supabase
    .from('match_time_suggestion')
    .select(
      `
        id,
        match_id,
        suggester_id,
        suggested_start_time,
        status,
        match:match_id (
          id,
          match_date,
          start_time,
          created_by,
          sport:sport_id ( name )
        )
      `
    )
    .eq('id', suggestionId)
    .maybeSingle();

  if (loadErr) {
    throw new Error(`Failed to load suggestion: ${loadErr.message}`);
  }
  if (!suggestionRow) {
    throw new Error('Suggestion not found');
  }

  const matchDetails = (suggestionRow as { match?: unknown }).match as {
    id: string;
    match_date: string;
    start_time: string;
    created_by: string;
    sport: { name?: string } | null;
  } | null;

  const matchId = matchDetails?.id ?? (suggestionRow as { match_id: string }).match_id;
  const suggesterId = (suggestionRow as { suggester_id: string }).suggester_id;
  const sportName = matchDetails?.sport?.name;
  const matchDate = matchDetails?.match_date;
  const originalStartTime = matchDetails?.start_time;

  if (accept) {
    const { data, error } = await supabase.rpc('accept_match_time_suggestion', {
      p_suggestion_id: suggestionId,
    });

    if (error) {
      if (error.message?.includes('match_full_after_suggestion')) {
        return { kind: 'error', reason: 'match_full_after_suggestion' };
      }
      throw new Error(`Failed to accept suggestion: ${error.message}`);
    }

    const result = data as unknown as AcceptRpcResult;

    // Fan-out — best effort, never block the host's UI on notification I/O.
    void (async () => {
      try {
        // Personal notification to the suggester.
        await notifyMatchTimeSuggestionAccepted(
          result.suggester_id,
          result.match_id,
          result.new_start_time,
          result.match_date,
          sportName,
          await getHostDisplayName(matchDetails?.created_by)
        );

        // Broadcast match-updated to every other joined participant
        // (excludes host AND the suggester since the suggester has their own
        // accepted notification).
        const recipients = (result.participant_ids_to_notify ?? []).filter(
          id => id !== result.suggester_id
        );
        if (recipients.length > 0) {
          await notifyMatchUpdated(recipients, result.match_id, ['startTime', 'endTime'], {
            sportName,
            matchDate: result.match_date,
            // Use the previous start time so the body references what
            // recipients originally knew about, mirroring the matchService
            // convention.
            startTime: result.previous_start_time,
          });
        }
      } catch (err) {
        Logger.error(
          'Failed to fan-out accept notifications:',
          err instanceof Error ? err : new Error(String(err))
        );
      }
    })();

    return { kind: 'accepted', result };
  }

  // Decline path — plain RLS UPDATE via the creator's policy.
  const { error: updateErr } = await supabase
    .from('match_time_suggestion')
    .update({
      status: 'declined' as MatchTimeSuggestionStatus,
      resolved_at: new Date().toISOString(),
      resolved_by: (await supabase.auth.getUser()).data.user?.id,
    })
    .eq('id', suggestionId)
    .eq('status', 'pending');

  if (updateErr) {
    throw new Error(`Failed to decline suggestion: ${updateErr.message}`);
  }

  void (async () => {
    try {
      await notifyMatchTimeSuggestionDeclined(
        suggesterId,
        matchId,
        matchDate,
        sportName,
        await getHostDisplayName(matchDetails?.created_by)
      );
    } catch (err) {
      Logger.error(
        'Failed to send decline notification:',
        err instanceof Error ? err : new Error(String(err))
      );
    }
  })();

  return { kind: 'declined', matchId, suggesterId };
}

/** Suggester withdraws their own pending row. */
export async function withdrawTimeSuggestion(suggestionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('withdraw_match_time_suggestion', {
    p_suggestion_id: suggestionId,
  });
  if (error) {
    throw new Error(`Failed to withdraw suggestion: ${error.message}`);
  }
  return data as string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function getHostDisplayName(hostUserId?: string): Promise<string | undefined> {
  if (!hostUserId) return undefined;
  const { data } = await supabase
    .from('profile')
    .select('first_name, last_name, display_name')
    .eq('id', hostUserId)
    .maybeSingle();
  if (!data) return undefined;
  const row = data as {
    first_name?: string | null;
    last_name?: string | null;
    display_name?: string | null;
  };
  if (row.display_name) return row.display_name;
  const first = row.first_name ?? '';
  const lastInitial = row.last_name ? `${row.last_name.charAt(0)}.` : '';
  return `${first} ${lastInitial}`.trim() || undefined;
}
