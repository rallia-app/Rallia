import { getTierForScore, type ReputationTier } from '@rallia/shared-services';

import { createServiceRoleClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicPlayerRating {
  sportName: string;
  isPrimary: boolean;
  label: string;
  value: number | null;
  isCertified: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  city: string | null;
  joinedAt: string | null;
  ratings: PublicPlayerRating[];
  /** Null when the player's reputation is not public yet (< min events or hidden). */
  reputation: { score: number; tier: ReputationTier } | null;
  showStats: boolean;
  stats: { gamesPlayed: number; hoursPlayed: number; weekStreak: number };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Monday-anchored local week start, as a timestamp (mirrors mobile PlayerProfile).
const getWeekStart = (date: Date): number => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.getTime();
};

const parseYMDLocal = (ymd: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const calculateWeekStreak = (matchDates: string[]): number => {
  const playedWeeks = new Set<number>();
  for (const dateStr of matchDates) {
    const d = parseYMDLocal(dateStr);
    if (d) playedWeeks.add(getWeekStart(d));
  }
  if (playedWeeks.size === 0) return 0;
  const currentWeekStart = getWeekStart(new Date());
  let cursor: number;
  if (playedWeeks.has(currentWeekStart)) {
    cursor = currentWeekStart;
  } else if (playedWeeks.has(currentWeekStart - WEEK_MS)) {
    cursor = currentWeekStart - WEEK_MS;
  } else {
    return 0;
  }
  let streak = 0;
  while (playedWeeks.has(cursor)) {
    streak++;
    cursor -= WEEK_MS;
  }
  return streak;
};

const matchDurationMinutes = (m: {
  duration: string | null;
  custom_duration_minutes: number | null;
}): number => {
  if (m.duration === 'custom') return m.custom_duration_minutes ?? 0;
  if (m.duration == null) return 0;
  const n = Number(m.duration);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Assembles the public share view of a player. Uses the service-role client
 * (page is server-rendered for anon visitors) and applies the player's privacy
 * settings server-side: city gated on privacy_show_location, rating/stats on
 * privacy_show_stats, reputation on player_reputation.is_public.
 */
export async function getPlayer(id: string): Promise<PublicPlayer | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = createServiceRoleClient();

  const [profileRes, playerRes, sportsRes, reputationRes, playedRes] = await Promise.all([
    supabase
      .from('profile')
      .select(
        'id, display_name, first_name, last_name, bio, profile_picture_url, created_at, account_status, is_active'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('player')
      .select('city, privacy_show_location, privacy_show_stats')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('player_sport')
      .select(
        'is_primary, sport:sport_id (name), active_rating:active_rating_score_id (is_certified, rating_score:rating_score_id (label, value))'
      )
      .eq('player_id', id)
      .eq('is_active', true),
    supabase
      .from('player_reputation')
      .select('reputation_score, total_events, is_public')
      .eq('player_id', id)
      .maybeSingle(),
    supabase.rpc('get_player_played_games', { p_player_id: id }),
  ]);

  const profile = profileRes.data;
  const player = playerRes.data;
  if (!profile || !player) return null;
  if (profile.is_active === false) return null;
  if (profile.account_status === 'suspended' || profile.account_status === 'deleted') return null;

  const name =
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    profile.display_name ||
    'Rallia player';

  const ratings: PublicPlayerRating[] = (sportsRes.data ?? [])
    .map(row => {
      const sport = row.sport as { name: string } | null;
      const active = row.active_rating as {
        is_certified: boolean | null;
        rating_score: { label: string; value: number | null } | null;
      } | null;
      if (!sport || !active?.rating_score) return null;
      return {
        sportName: sport.name,
        isPrimary: row.is_primary ?? false,
        label: active.rating_score.label,
        value: active.rating_score.value,
        isCertified: active.is_certified ?? false,
      };
    })
    .filter((r): r is PublicPlayerRating => r !== null)
    .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));

  const rep = reputationRes.data;
  const tier = rep ? getTierForScore(rep.reputation_score, rep.total_events) : 'unknown';
  const reputation =
    rep && rep.is_public && tier !== 'unknown'
      ? { score: Math.round(rep.reputation_score), tier }
      : null;

  const playedGames = playedRes.data ?? [];
  const totalMinutes = playedGames.reduce((sum, g) => sum + matchDurationMinutes(g), 0);
  const playedDates = playedGames.map(g => g.match_date).filter((d): d is string => !!d);

  return {
    id: profile.id,
    name,
    bio: profile.bio,
    avatarUrl: profile.profile_picture_url,
    city: player.privacy_show_location === false ? null : player.city,
    joinedAt: profile.created_at,
    ratings: player.privacy_show_stats === false ? [] : ratings,
    reputation,
    showStats: player.privacy_show_stats !== false,
    stats: {
      gamesPlayed: playedGames.length,
      hoursPlayed: Math.round(totalMinutes / 60),
      weekStreak: calculateWeekStreak(playedDates),
    },
  };
}
