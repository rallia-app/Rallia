import { createServiceRoleClient } from '@/lib/supabase/server';

export type WebJoinMatchParticipant = {
  id: string;
  status: string;
  is_host: boolean;
  player_id: string;
  player: {
    profile: {
      first_name: string | null;
      last_name: string | null;
      profile_picture_url: string | null;
    } | null;
  } | null;
};

export type WebJoinMatchContext = {
  id: string;
  sport_id: string;
  format: string;
  join_mode: 'direct' | 'request' | null;
  match_date: string;
  start_time: string;
  end_time: string | null;
  timezone: string | null;
  location_name: string | null;
  location_address: string | null;
  notes: string | null;
  player_expectation: string | null;
  court_status: string | null;
  is_court_free: boolean | null;
  estimated_cost: number | null;
  preferred_opponent_gender: string | null;
  custom_latitude: number | null;
  custom_longitude: number | null;
  sport: { name: string; slug: string } | null;
  facility: {
    name: string;
    city: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  court: { name: string } | null;
  min_rating_score: { label: string } | null;
  participants: WebJoinMatchParticipant[] | null;
};

export async function getMatchForWebJoin(matchId: string): Promise<WebJoinMatchContext | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('match')
    .select(
      `id, sport_id, format, join_mode, match_date, start_time, end_time, timezone,
       location_name, location_address, notes, cancelled_at,
       player_expectation, court_status, is_court_free, estimated_cost,
       preferred_opponent_gender, custom_latitude, custom_longitude,
       sport:sport_id (name, slug),
       facility:facility_id (name, city, address, latitude, longitude),
       court:court_id (name),
       min_rating_score:min_rating_score_id (label),
       participants:match_participant (
         id, status, is_host, player_id,
         player:player_id (profile!player_id_fkey (first_name, last_name, profile_picture_url))
       )`
    )
    .eq('id', matchId)
    .single();

  if (!data || data.cancelled_at || !data.sport_id || !data.format) return null;

  return {
    id: data.id,
    sport_id: data.sport_id,
    format: data.format,
    join_mode: data.join_mode,
    match_date: data.match_date,
    start_time: data.start_time,
    end_time: data.end_time,
    timezone: data.timezone,
    location_name: data.location_name,
    location_address: data.location_address,
    notes: data.notes,
    player_expectation: data.player_expectation,
    court_status: data.court_status,
    is_court_free: data.is_court_free,
    estimated_cost: data.estimated_cost,
    preferred_opponent_gender: data.preferred_opponent_gender,
    custom_latitude: data.custom_latitude,
    custom_longitude: data.custom_longitude,
    sport: data.sport as WebJoinMatchContext['sport'],
    facility: data.facility as WebJoinMatchContext['facility'],
    court: data.court as WebJoinMatchContext['court'],
    min_rating_score: data.min_rating_score as WebJoinMatchContext['min_rating_score'],
    participants: data.participants as WebJoinMatchContext['participants'],
  };
}
