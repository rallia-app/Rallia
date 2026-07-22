-- get_user_demographics: single aggregate payload powering the admin Analytics > Users tab.
-- Returns aggregate-only counts (no per-user PII). SECURITY DEFINER + broad execute grant,
-- matching the other public.get_* analytics RPCs; access is gated at the admin page (RBAC layout).
CREATE OR REPLACE FUNCTION public.get_user_demographics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH
-- Primary sport + active rating per player (one row per player).
primary_sport AS (
  SELECT DISTINCT ON (ps.player_id)
    ps.player_id,
    s.name AS sport_name,
    rs.value AS rating_value,
    rs.label AS rating_label,
    rs.skill_level::text AS skill_level
  FROM player_sport ps
  JOIN sport s ON s.id = ps.sport_id
  LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
  LEFT JOIN rating_score rs ON rs.id = prs.rating_score_id
  WHERE ps.is_primary
  ORDER BY ps.player_id, ps.updated_at DESC
),
-- Distinct past games actually played (joined participant, match date in the past).
games AS (
  SELECT mp.player_id, count(DISTINCT mp.match_id) AS games
  FROM match_participant mp
  JOIN match m ON m.id = mp.match_id
  WHERE mp.status = 'joined' AND m.match_date < current_date
  GROUP BY mp.player_id
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'totals', (
    SELECT jsonb_build_object(
      'profiles', (SELECT count(*) FROM profile),
      'players', (SELECT count(*) FROM player),
      'onboarded', (SELECT count(*) FROM profile WHERE onboarding_completed),
      'active_today', (SELECT count(*) FROM player WHERE last_seen_at >= current_date),
      'active_week', (SELECT count(*) FROM player WHERE last_seen_at >= current_date - interval '7 days'),
      'active_month', (SELECT count(*) FROM player WHERE last_seen_at >= current_date - interval '30 days'),
      'new_week', (SELECT count(*) FROM profile WHERE created_at >= now() - interval '7 days'),
      'new_month', (SELECT count(*) FROM profile WHERE created_at >= now() - interval '30 days')
    )
  ),
  'signups_by_week', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', week, 'count', n) ORDER BY week), '[]'::jsonb)
    FROM (
      SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*) AS n
      FROM profile
      WHERE created_at >= date_trunc('week', now()) - interval '15 weeks'
      GROUP BY 1
    ) w
  ),
  'age_bands', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY sort), '[]'::jsonb)
    FROM (
      SELECT bucket, min(sort) AS sort, count(*) AS n FROM (
        SELECT
          CASE
            WHEN pr.birth_date IS NULL THEN 'Unknown'
            WHEN date_part('year', age(pr.birth_date)) < 25 THEN '18-24'
            WHEN date_part('year', age(pr.birth_date)) < 35 THEN '25-34'
            WHEN date_part('year', age(pr.birth_date)) < 45 THEN '35-44'
            WHEN date_part('year', age(pr.birth_date)) < 55 THEN '45-54'
            WHEN date_part('year', age(pr.birth_date)) < 65 THEN '55-64'
            ELSE '65+'
          END AS bucket,
          CASE
            WHEN pr.birth_date IS NULL THEN 99
            WHEN date_part('year', age(pr.birth_date)) < 25 THEN 1
            WHEN date_part('year', age(pr.birth_date)) < 35 THEN 2
            WHEN date_part('year', age(pr.birth_date)) < 45 THEN 3
            WHEN date_part('year', age(pr.birth_date)) < 55 THEN 4
            WHEN date_part('year', age(pr.birth_date)) < 65 THEN 5
            ELSE 6
          END AS sort
        FROM player p JOIN profile pr ON pr.id = p.id
      ) a GROUP BY bucket
    ) x
  ),
  'gender', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (SELECT COALESCE(gender::text, 'unknown') AS bucket, count(*) AS n FROM player GROUP BY 1) g
  ),
  'locale', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (
      SELECT COALESCE(pr.preferred_locale::text, 'unknown') AS bucket, count(*) AS n
      FROM player p JOIN profile pr ON pr.id = p.id GROUP BY 1
    ) l
  ),
  'geography', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('zone', zone, 'count', n) ORDER BY sort), '[]'::jsonb)
    FROM (
      SELECT zone, min(sort) AS sort, count(*) AS n FROM (
        SELECT
          CASE
            WHEN postal_code IS NULL THEN 'Unknown'
            WHEN upper(left(postal_code, 1)) = 'H' THEN 'Montréal Island'
            WHEN upper(left(postal_code, 1)) = 'J' THEN 'Greater Montréal (off-island)'
            ELSE 'Other'
          END AS zone,
          CASE
            WHEN postal_code IS NULL THEN 99
            WHEN upper(left(postal_code, 1)) = 'H' THEN 1
            WHEN upper(left(postal_code, 1)) = 'J' THEN 2
            ELSE 3
          END AS sort
        FROM player
      ) z GROUP BY zone
    ) g
  ),
  'top_cities', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('city', city, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (
      SELECT initcap(trim(city)) AS city, count(*) AS n
      FROM player
      WHERE city IS NOT NULL AND trim(city) <> ''
      GROUP BY initcap(trim(city))
      ORDER BY n DESC
      LIMIT 8
    ) c
  ),
  'sports', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sport', sport_name, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (SELECT sport_name, count(*) AS n FROM primary_sport GROUP BY sport_name) s
  ),
  'skill_levels', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sport', sport_name, 'skill', skill, 'count', n) ORDER BY sport_name, sort), '[]'::jsonb)
    FROM (
      SELECT sport_name, skill, min(sort) AS sort, count(*) AS n FROM (
        SELECT sport_name,
          COALESCE(skill_level, 'unrated') AS skill,
          CASE skill_level WHEN 'beginner' THEN 1 WHEN 'intermediate' THEN 2 WHEN 'advanced' THEN 3 ELSE 9 END AS sort
        FROM primary_sport
      ) sk GROUP BY sport_name, skill
    ) x
  ),
  'rating_histogram', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sport', sport_name, 'label', rating_label, 'value', rating_value, 'count', n) ORDER BY sport_name, rating_value), '[]'::jsonb)
    FROM (
      SELECT sport_name, rating_label, rating_value, count(*) AS n
      FROM primary_sport
      WHERE rating_value IS NOT NULL
      GROUP BY sport_name, rating_label, rating_value
    ) r
  ),
  'match_type', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (SELECT COALESCE(preferred_match_type::text, 'unset') AS bucket, count(*) AS n FROM player_sport WHERE is_primary GROUP BY 1) m
  ),
  'match_duration', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY bucket), '[]'::jsonb)
    FROM (SELECT COALESCE(preferred_match_duration::text, 'unset') AS bucket, count(*) AS n FROM player_sport WHERE is_primary GROUP BY 1) d
  ),
  'playing_hand', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (SELECT COALESCE(playing_hand::text, 'unknown') AS bucket, count(*) AS n FROM player GROUP BY 1) h
  ),
  'games_played', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY sort), '[]'::jsonb)
    FROM (
      SELECT bucket, min(sort) AS sort, count(*) AS n FROM (
        SELECT
          CASE
            WHEN COALESCE(g.games, 0) = 0 THEN '0'
            WHEN g.games <= 2 THEN '1-2'
            WHEN g.games <= 5 THEN '3-5'
            WHEN g.games <= 10 THEN '6-10'
            ELSE '11+'
          END AS bucket,
          CASE
            WHEN COALESCE(g.games, 0) = 0 THEN 0
            WHEN g.games <= 2 THEN 1
            WHEN g.games <= 5 THEN 2
            WHEN g.games <= 10 THEN 3
            ELSE 4
          END AS sort
        FROM player p LEFT JOIN games g ON g.player_id = p.id
      ) gp GROUP BY bucket
    ) x
  ),
  'engagement', (
    SELECT jsonb_build_object(
      'ever_checked_in', (SELECT count(DISTINCT player_id) FROM player_weekly_checkin),
      'active_streaks', (SELECT count(DISTINCT player_id) FROM player_streak WHERE current_streak > 0),
      'avg_active_streak', (SELECT COALESCE(round(avg(current_streak), 1), 0) FROM player_streak WHERE current_streak > 0),
      'max_streak', (SELECT COALESCE(max(longest_streak), 0) FROM player_streak),
      'have_fav_facility', (SELECT count(DISTINCT player_id) FROM player_favorite_facility),
      'have_availability', (SELECT count(DISTINCT player_id) FROM player_availability),
      'auto_invite_on', (SELECT count(*) FROM player_check_in_preferences WHERE auto_invite_players)
    )
  ),
  'acquisition', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('channel', channel, 'count', n) ORDER BY n DESC), '[]'::jsonb)
    FROM (SELECT COALESCE(acquisition_channel, 'unknown') AS channel, count(*) AS n FROM profile GROUP BY 1) a
  ),
  'referred', (
    SELECT jsonb_build_object(
      'referred', (SELECT count(*) FROM profile WHERE referred_by IS NOT NULL),
      'not_referred', (SELECT count(*) FROM profile WHERE referred_by IS NULL)
    )
  )
);
$function$;

GRANT EXECUTE ON FUNCTION public.get_user_demographics() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_demographics() IS
  'Aggregate user/persona breakdown for the admin Analytics > Users tab. Aggregate counts only (no PII). Access gated at the admin RBAC layout.';
