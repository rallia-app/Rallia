-- ============================================================================
-- Migration: get_morning_digest_suggestions RPC
-- Created: 2026-04-28
-- Description:
--   Server-side variant of pickSlotForSuggestion (apps/mobile … useUnifiedMatchFeed.ts):
--   for each opponent surfaced by get_match_suggestions_scored, produces ONE
--   concrete (facility, match_date, start_time, end_time) so the morning
--   digest email can render match-style cards instead of abstract day/period
--   bands.
--
--   Pipeline:
--     1. Pull scored (opponent, facility) rows from get_match_suggestions_scored.
--     2. Expand overlapping_days_periods → candidate (date, hour) pairs over
--        the next 7 days.
--     3. Strict-future filter.
--     4. Anti-join against match_participant × match to drop hours where
--        caller or opponent is busy.
--     5. Per opponent: keep the highest-affinity facility, soonest day with
--        a viable slot, deterministic random hour seeded by hashtext().
--     6. Compute end_time = start_time + match_duration.
--     7. Order by matchup_score, LIMIT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_morning_digest_suggestions(
  p_player_id UUID,
  p_sport_id  UUID,
  p_limit     INT DEFAULT 3
)
RETURNS TABLE (
  opponent_id              UUID,
  opponent_first_name      TEXT,
  opponent_last_name       TEXT,
  opponent_rating_label    TEXT,
  opponent_badge_status    badge_status_enum,
  opponent_reputation_tier reputation_tier,
  facility_id              UUID,
  facility_name            TEXT,
  facility_city            TEXT,
  match_date               DATE,
  start_time               TIME,
  end_time                 TIME,
  matchup_score            NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  -- Pull a generous sample from the scored RPC; we'll filter heavily below.
  scored AS (
    SELECT
      s.opponent_id,
      s.opponent_first_name,
      s.opponent_last_name,
      s.opponent_rating_label,
      s.opponent_badge_status,
      s.opponent_reputation_tier,
      s.facility_id,
      s.facility_name,
      s.facility_city,
      s.facility_affinity,
      s.match_duration,
      s.overlapping_days_periods,
      s.matchup_score
    FROM public.get_match_suggestions_scored(p_player_id, p_sport_id, GREATEST(50, p_limit * 8)) s
  ),

  -- Static lookup: which hours are in each period.
  period_hours(period, hour) AS (
    VALUES
      ('morning'::TEXT,  8), ('morning',  9), ('morning', 10), ('morning', 11), ('morning', 12),
      ('afternoon'::TEXT, 13), ('afternoon', 14), ('afternoon', 15), ('afternoon', 16), ('afternoon', 17),
      ('evening'::TEXT,   18), ('evening',   19), ('evening',   20), ('evening',   21)
  ),

  -- Static lookup: day-name → ISO dow (1 Mon .. 7 Sun).
  day_dow(day_name, dow) AS (
    VALUES
      ('monday'::TEXT, 1), ('tuesday', 2), ('wednesday', 3),
      ('thursday', 4), ('friday', 5), ('saturday', 6), ('sunday', 7)
  ),

  -- Convert match_duration_enum → INTERVAL.
  duration_minutes AS (
    SELECT
      s.*,
      (CASE s.match_duration::TEXT
         WHEN '30'  THEN 30
         WHEN '60'  THEN 60
         WHEN '90'  THEN 90
         WHEN '120' THEN 120
         ELSE 60
       END)::INT AS dur_min
    FROM scored s
  ),

  -- Expand each (opponent, facility) row's overlapping_days_periods into
  -- one candidate (match_date, start_time) per (day, hour) over next 7 days.
  candidates AS (
    SELECT
      d.opponent_id,
      d.opponent_first_name,
      d.opponent_last_name,
      d.opponent_rating_label,
      d.opponent_badge_status,
      d.opponent_reputation_tier,
      d.facility_id,
      d.facility_name,
      d.facility_city,
      d.facility_affinity,
      d.matchup_score,
      d.dur_min,
      ((CURRENT_DATE
        + ((dd.dow - EXTRACT(ISODOW FROM CURRENT_DATE)::INT + 7) % 7)
       )::DATE) AS match_date,
      make_time(ph.hour, 0, 0) AS start_time
    FROM duration_minutes d
    CROSS JOIN LATERAL jsonb_array_elements(d.overlapping_days_periods) AS slot
    JOIN day_dow dd
      ON dd.day_name = (slot->>'day')
    JOIN period_hours ph
      ON ph.period = (slot->>'period')
  ),

  -- Strict-future filter (combines date + start_time in the local server tz —
  -- good enough for digest scheduling; the digest itself surfaces these as
  -- match.timezone-aware later).
  future_candidates AS (
    SELECT *
    FROM candidates
    WHERE (match_date + start_time) > NOW()
  ),

  -- Caller's busy slots (any active participation that could conflict).
  caller_busy AS (
    SELECT m.match_date, m.start_time, m.end_time
    FROM public.match_participant mp
    JOIN public.match m ON m.id = mp.match_id
    WHERE mp.player_id = p_player_id
      AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
      AND m.cancelled_at IS NULL
      AND m.match_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
  ),

  -- Opponent busy slots, indexed by opponent_id for fast lookup.
  opponent_busy AS (
    SELECT mp.player_id, m.match_date, m.start_time, m.end_time
    FROM public.match_participant mp
    JOIN public.match m ON m.id = mp.match_id
    WHERE mp.player_id IN (SELECT DISTINCT opponent_id FROM future_candidates)
      AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
      AND m.cancelled_at IS NULL
      AND m.match_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
  ),

  -- Drop candidates that overlap with caller or opponent busy windows.
  -- Two slots [a_start, a_end) and [b_start, b_end) overlap iff
  --   a_start < b_end AND b_start < a_end.
  available_candidates AS (
    SELECT fc.*
    FROM future_candidates fc
    WHERE NOT EXISTS (
      SELECT 1 FROM caller_busy cb
      WHERE cb.match_date = fc.match_date
        AND cb.start_time < (fc.start_time + (fc.dur_min * INTERVAL '1 minute'))
        AND fc.start_time < cb.end_time
    )
    AND NOT EXISTS (
      SELECT 1 FROM opponent_busy ob
      WHERE ob.player_id = fc.opponent_id
        AND ob.match_date = fc.match_date
        AND ob.start_time < (fc.start_time + (fc.dur_min * INTERVAL '1 minute'))
        AND fc.start_time < ob.end_time
    )
  ),

  -- Per opponent: keep the soonest day, then deterministically pick one
  -- (facility, hour) seeded by a stable hash. Within the soonest day, prefer
  -- highest-affinity facility (matchup_score DESC) before the random tiebreak.
  picked AS (
    SELECT *
    FROM (
      SELECT
        ac.*,
        ROW_NUMBER() OVER (
          PARTITION BY ac.opponent_id
          ORDER BY
            ac.match_date ASC,
            ac.matchup_score DESC,
            hashtext(ac.opponent_id::TEXT || ac.start_time::TEXT) ASC
        ) AS rn
      FROM available_candidates ac
    ) ranked
    WHERE ranked.rn = 1
  )

  SELECT
    p.opponent_id,
    p.opponent_first_name,
    p.opponent_last_name,
    p.opponent_rating_label,
    p.opponent_badge_status,
    p.opponent_reputation_tier,
    p.facility_id,
    p.facility_name,
    p.facility_city,
    p.match_date,
    p.start_time,
    (p.start_time + (p.dur_min * INTERVAL '1 minute'))::TIME AS end_time,
    p.matchup_score
  FROM picked p
  ORDER BY p.matchup_score DESC, p.match_date ASC, p.start_time ASC
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_morning_digest_suggestions(UUID, UUID, INT)
  TO service_role;

COMMENT ON FUNCTION public.get_morning_digest_suggestions IS
  'Server-side mirror of pickSlotForSuggestion: one concrete (facility, '
  'match_date, start_time, end_time) per opponent for the morning digest. '
  'Drops opponents where every candidate hour over the next 7 days is past '
  'or busy. Used by send-morning-digest edge function.';
