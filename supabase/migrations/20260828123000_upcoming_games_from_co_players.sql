-- ============================================================================
-- Migration: Upcoming open games from the people you just played with
-- Created: 2026-08-28
-- Description: Feeds the post-feedback "what's next" step. After rating the
--              people from a game, the strongest next action is not "create a
--              game" in the abstract — it is "your partner already has one next
--              Thursday, join it". Recurring series make this reliable: the
--              next occurrence is generated the moment the previous game ends,
--              so it exists by the time feedback is given.
--
-- Returns only games the caller could actually join: public, upcoming, with a
-- free spot, passing the same rating and gender gates the public search
-- applies, and not one the caller is already on.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_upcoming_games_from_co_players(uuid, integer);

CREATE OR REPLACE FUNCTION public.get_upcoming_games_from_co_players(
  p_match_id uuid,
  p_limit    integer DEFAULT 5
)
RETURNS TABLE (
  match_id       uuid,
  match_date     date,
  start_time     time,
  end_time       time,
  timezone       text,
  format         match_format_enum,
  sport_id       uuid,
  sport_name     text,
  location_type  location_type_enum,
  facility_id    uuid,
  location_label text,
  court_status   court_status_enum,
  join_mode      match_join_mode_enum,
  is_recurring   boolean,
  spots_open     integer,
  host_id        uuid,
  host_name      text,
  host_avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller        uuid := auth.uid();
  v_caller_gender gender_enum;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- The caller has to have been on the game they are giving feedback for.
  IF NOT EXISTS (
    SELECT 1 FROM public.match_participant mp
    WHERE mp.match_id = p_match_id
      AND mp.player_id = v_caller
      AND mp.status = 'joined'
  ) THEN
    RAISE EXCEPTION 'Caller is not a participant of this match' USING ERRCODE = '42501';
  END IF;

  SELECT p.gender INTO v_caller_gender
  FROM public.player p
  WHERE p.id = v_caller;

  RETURN QUERY
  WITH co_players AS (
    SELECT mp.player_id
    FROM public.match_participant mp
    WHERE mp.match_id = p_match_id
      AND mp.status = 'joined'
      AND mp.player_id <> v_caller
  ),
  -- DISTINCT ON: a game several co-players are on still shows once.
  candidates AS (
  SELECT DISTINCT ON (m.id)
    m.id                                          AS c_match_id,
    m.match_date                                  AS c_match_date,
    m.start_time                                  AS c_start_time,
    m.end_time                                    AS c_end_time,
    m.timezone::text                              AS c_timezone,
    m.format                                      AS c_format,
    m.sport_id                                    AS c_sport_id,
    sp.name::text                                 AS c_sport_name,
    m.location_type                               AS c_location_type,
    m.facility_id                                 AS c_facility_id,
    COALESCE(f.name, m.location_name)::text       AS c_location_label,
    m.court_status                                AS c_court_status,
    m.join_mode                                   AS c_join_mode,
    (m.recurrence_id IS NOT NULL)                 AS c_is_recurring,
    (CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END - joined.n)::integer AS c_spots_open,
    m.created_by                                  AS c_host_id,
    COALESCE(hp.display_name, hp.first_name)::text AS c_host_name,
    hp.profile_picture_url::text                  AS c_host_avatar_url
  FROM public.match m
  JOIN public.match_participant cop
    ON cop.match_id = m.id
   AND cop.status = 'joined'
   AND cop.player_id IN (SELECT player_id FROM co_players)
  JOIN public.sport sp ON sp.id = m.sport_id
  JOIN public.profile hp ON hp.id = m.created_by
  LEFT JOIN public.facility f ON f.id = m.facility_id
  LEFT JOIN public.rating_score mrs ON mrs.id = m.min_rating_score_id
  JOIN LATERAL (
    SELECT COUNT(*)::integer AS n
    FROM public.match_participant mp2
    WHERE mp2.match_id = m.id
      AND mp2.status = 'joined'
  ) joined ON TRUE
  WHERE m.id <> p_match_id
    AND m.cancelled_at IS NULL
    AND m.closed_at IS NULL
    AND m.visibility = 'public'
    AND (m.match_date + m.start_time) AT TIME ZONE COALESCE(m.timezone, 'UTC') > now()
    -- Still has room.
    AND joined.n < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
    -- Caller isn't already on it, in any state.
    AND NOT EXISTS (
      SELECT 1 FROM public.match_participant mine
      WHERE mine.match_id = m.id AND mine.player_id = v_caller
    )
    -- Same gates the public search applies, so nothing surfaces that the
    -- caller would be turned away from.
    AND (
      m.preferred_opponent_gender IS NULL
      OR v_caller_gender IS NULL
      OR m.preferred_opponent_gender = v_caller_gender
    )
    AND (
      m.min_rating_score_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.player_sport ps
        JOIN public.player_rating_score prs ON prs.id = ps.active_rating_score_id
        JOIN public.rating_score rs ON rs.id = prs.rating_score_id
        WHERE ps.player_id = v_caller
          AND ps.sport_id = m.sport_id
          AND rs.value >= mrs.value - 0.5
      )
    )
  ORDER BY m.id, m.match_date, m.start_time
  )
  SELECT
    c.c_match_id, c.c_match_date, c.c_start_time, c.c_end_time, c.c_timezone,
    c.c_format, c.c_sport_id, c.c_sport_name, c.c_location_type, c.c_facility_id,
    c.c_location_label, c.c_court_status, c.c_join_mode, c.c_is_recurring,
    c.c_spots_open, c.c_host_id, c.c_host_name, c.c_host_avatar_url
  FROM candidates c
  ORDER BY c.c_match_date, c.c_start_time
  LIMIT p_limit;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_upcoming_games_from_co_players(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_upcoming_games_from_co_players(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_upcoming_games_from_co_players(uuid, integer) IS
  'Upcoming public games with an open spot hosted or joined by the other participants of p_match_id, filtered to ones the caller can actually join. Powers the post-feedback next-step list.';
