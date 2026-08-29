/**
 * Match Recurrence Service
 * Turns a game into a weekly series and stops one. The system re-creates the
 * game once the previous occurrence has ended (generate_recurring_matches).
 */

import { supabase } from '../supabase';
import { Logger } from '../logger';
import type { Database, Tables } from '@rallia/shared-types';

export type MatchRecurrence = Tables<'match_recurrence'>;

type CoPlayerGameRow =
  Database['public']['Functions']['get_upcoming_games_from_co_players']['Returns'][number];

/** Games returned by get_upcoming_games_from_co_players. */
export interface CoPlayerUpcomingGame {
  matchId: string;
  matchDate: string;
  startTime: string;
  endTime: string | null;
  timezone: string | null;
  format: string | null;
  sportId: string;
  sportName: string | null;
  locationType: string | null;
  facilityId: string | null;
  locationLabel: string | null;
  courtStatus: string | null;
  joinMode: string | null;
  isRecurring: boolean;
  spotsOpen: number;
  hostId: string;
  hostName: string | null;
  hostAvatarUrl: string | null;
}

/**
 * Marks a game as the template of a weekly series and stamps the game with it.
 */
export async function startRecurrence(
  matchId: string,
  createdBy: string,
  intervalWeeks = 1
): Promise<MatchRecurrence> {
  const { data, error } = await supabase
    .from('match_recurrence')
    .insert({ template_match_id: matchId, created_by: createdBy, interval_weeks: intervalWeeks })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to start recurrence: ${error.message}`);
  }

  const { error: stampError } = await supabase
    .from('match')
    .update({ recurrence_id: data.id })
    .eq('id', matchId);

  if (stampError) {
    // The series exists but the template is not attached to it, so the
    // generator would never see an occurrence to follow. Roll it back rather
    // than leaving a series that silently produces nothing.
    await supabase.from('match_recurrence').delete().eq('id', data.id);
    throw new Error(`Failed to attach recurrence to game: ${stampError.message}`);
  }

  return data;
}

/**
 * Stops a series. Games already generated stay; no new ones are created.
 */
export async function stopRecurrence(recurrenceId: string, stoppedBy: string): Promise<void> {
  const { error } = await supabase
    .from('match_recurrence')
    .update({ stopped_at: new Date().toISOString(), stopped_by: stoppedBy })
    .eq('id', recurrenceId)
    .is('stopped_at', null);

  if (error) {
    throw new Error(`Failed to stop recurrence: ${error.message}`);
  }
}

/**
 * The series a game belongs to, or null. Only the series owner can read it.
 */
export async function getRecurrence(recurrenceId: string): Promise<MatchRecurrence | null> {
  const { data, error } = await supabase
    .from('match_recurrence')
    .select('*')
    .eq('id', recurrenceId)
    .maybeSingle();

  if (error) {
    Logger.error('recurrenceService: failed to load recurrence', new Error(error.message));
    return null;
  }

  return data;
}

/**
 * Upcoming open games hosted or joined by the other participants of a game the
 * caller played. Powers the post-feedback next-step list.
 */
export async function getUpcomingGamesFromCoPlayers(
  matchId: string,
  limit = 5
): Promise<CoPlayerUpcomingGame[]> {
  const { data, error } = await supabase.rpc('get_upcoming_games_from_co_players', {
    p_match_id: matchId,
    p_limit: limit,
  });

  if (error) {
    Logger.error('recurrenceService: failed to load co-player games', new Error(error.message));
    return [];
  }

  return ((data ?? []) as CoPlayerGameRow[]).map(row => ({
    matchId: row.match_id,
    matchDate: row.match_date,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone,
    format: row.format,
    sportId: row.sport_id,
    sportName: row.sport_name,
    locationType: row.location_type,
    facilityId: row.facility_id,
    locationLabel: row.location_label,
    courtStatus: row.court_status,
    joinMode: row.join_mode,
    isRecurring: row.is_recurring,
    spotsOpen: row.spots_open,
    hostId: row.host_id,
    hostName: row.host_name,
    hostAvatarUrl: row.host_avatar_url,
  }));
}
