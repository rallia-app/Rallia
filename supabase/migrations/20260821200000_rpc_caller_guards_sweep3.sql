-- =============================================================================
-- Caller guards, sweep 3: player-, admin- and organizer-scoped RPCs, plus
-- direct-execution revokes for internal / edge-only / unused functions.
--
-- Every function below is SECURITY DEFINER and took a player / admin /
-- season id without checking the caller. Bodies are copied verbatim from the
-- migration whose definition matches the live catalog; each gets SET
-- search_path = public and a guard:
--   "self"      the id must be auth.uid() when a JWT is present (service_role
--               and definer-internal calls carry no uid and pass; anon is revoked)
--   "admin"     is_admin(auth.uid()) when a JWT is present (+ p_admin_id must
--               be the caller where the function takes one)
--   "members"   get_or_create_group_invite_code: caller must be an active member
--   "organizer" session_create_series: is_league_organizer(season.league_id)
--               OR is_admin(), P0001 NOT_ORGANIZER like its session_* siblings
-- Revoked from PUBLIC, anon, authenticated (service_role keeps EXECUTE):
--   tournament / season internals only called from SECURITY DEFINER functions
--   and triggers, edge-function-only helpers, and functions no code references.
-- lt_match_result_propagation_tg becomes SECURITY DEFINER so the two
-- lt_propagate_* functions it calls can be revoked.
-- insert_notification / insert_notifications are deliberately NOT touched:
-- the web booking-cancel route reaches them through the shared anon client.
-- =============================================================================

CREATE OR REPLACE FUNCTION accept_rebuttal_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
  v_rebuttal_sets JSONB;
  v_rebuttal_t1 INTEGER;
  v_rebuttal_t2 INTEGER;
  v_rebuttal_winner INTEGER;
  v_set JSONB;
  v_set_number INTEGER := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Verify rebuttal exists and isn't already processed
  SELECT mr.match_id, mr.rebuttal_sets, mr.rebuttal_team1_score,
         mr.rebuttal_team2_score, mr.rebuttal_winning_team
  INTO v_match_id, v_rebuttal_sets, v_rebuttal_t1, v_rebuttal_t2, v_rebuttal_winner
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.rebuttal_submitted_by IS NOT NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Rebuttal not found or already processed';
  END IF;

  -- Get original submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get accepting player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only original team (same team as submitter) can accept the rebuttal
  IF v_player_team != v_submitter_team THEN
    RAISE EXCEPTION 'Only the original submitting team can accept a rebuttal';
  END IF;

  -- Delete old match_set rows
  DELETE FROM match_set WHERE match_result_id = p_match_result_id;

  -- Insert new sets from rebuttal
  FOR v_set IN SELECT * FROM jsonb_array_elements(v_rebuttal_sets)
  LOOP
    v_set_number := v_set_number + 1;
    INSERT INTO match_set (match_result_id, set_number, team1_score, team2_score)
    VALUES (
      p_match_result_id,
      COALESCE((v_set->>'set_number')::INTEGER, v_set_number),
      (v_set->>'team1_score')::INTEGER,
      (v_set->>'team2_score')::INTEGER
    );
  END LOOP;

  -- Copy rebuttal scores to main scores and mark verified
  UPDATE match_result
  SET
    team1_score = v_rebuttal_t1,
    team2_score = v_rebuttal_t2,
    winning_team = v_rebuttal_winner,
    is_verified = TRUE,
    verified_at = NOW(),
    confirmed_by = p_player_id
  WHERE id = p_match_result_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.accept_rebuttal_score(p_match_result_id uuid, p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_rebuttal_score(p_match_result_id uuid, p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION attribute_referral(
  p_referral_code VARCHAR(12),
  p_new_player_id UUID,
  p_new_player_email TEXT DEFAULT NULL,
  p_invitation_type TEXT DEFAULT 'referral',
  p_target_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_referrer_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND p_new_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_new_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Channel attribution (flyer / poster / social): no referring user
  IF p_invitation_type IN ('flyer', 'poster', 'social') THEN
    IF EXISTS(SELECT 1 FROM public.profile WHERE id = p_new_player_id AND referred_by IS NOT NULL) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Already referred');
    END IF;

    UPDATE public.profile
    SET referral_invitation_type = p_invitation_type
    WHERE id = p_new_player_id;

    RETURN jsonb_build_object('success', true, 'referrer_id', NULL);
  END IF;

  -- Referral attribution (referral / match / group / community): tied to a user
  SELECT id INTO v_referrer_id
  FROM public.profile
  WHERE referral_code = UPPER(p_referral_code);

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  IF v_referrer_id = p_new_player_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  IF EXISTS(SELECT 1 FROM public.profile WHERE id = p_new_player_id AND referred_by IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already referred');
  END IF;

  UPDATE public.profile
  SET referred_by = v_referrer_id,
      referral_invitation_type = COALESCE(p_invitation_type, 'referral'),
      referral_target_id = p_target_id
  WHERE id = p_new_player_id;

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.attribute_referral(p_referral_code character varying, p_new_player_id uuid, p_new_player_email text, p_invitation_type text, p_target_id text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attribute_referral(p_referral_code character varying, p_new_player_id uuid, p_new_player_email text, p_invitation_type text, p_target_id text) TO authenticated;

CREATE OR REPLACE FUNCTION confirm_match_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Get match_id and verify score exists and isn't already processed
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.submitted_by != p_player_id
    AND mr.rebuttal_submitted_by IS NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;

  -- Get submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get confirming player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only opponents (different team) can confirm
  IF v_player_team = v_submitter_team THEN
    RAISE EXCEPTION 'Only opponents can confirm the score';
  END IF;

  -- Record the confirmation
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'confirmed')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  -- Single opponent confirmation is enough → verify immediately
  UPDATE match_result
  SET
    is_verified = TRUE,
    verified_at = NOW(),
    confirmed_by = p_player_id
  WHERE id = p_match_result_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.confirm_match_score(p_match_result_id uuid, p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_match_score(p_match_result_id uuid, p_player_id uuid) TO authenticated;

create or replace function public.disable_all_email_notifications(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_user_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  insert into notification_preference (user_id, notification_type, channel, enabled)
  select p_user_id, e.enumlabel::notification_type_enum, 'email'::delivery_channel_enum, false
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'notification_type_enum'
  on conflict (user_id, notification_type, channel)
  do update set enabled = false, updated_at = now();
end;
$$;

REVOKE ALL ON FUNCTION public.disable_all_email_notifications(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disable_all_email_notifications(p_user_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION dispute_rebuttal_score(
  p_match_result_id UUID,
  p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Verify rebuttal exists and isn't already processed
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.rebuttal_submitted_by IS NOT NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Rebuttal not found or already processed';
  END IF;

  -- Get original submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get disputing player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only original team can dispute the rebuttal
  IF v_player_team != v_submitter_team THEN
    RAISE EXCEPTION 'Only the original submitting team can dispute a rebuttal';
  END IF;

  -- Mark as disputed (unsettled)
  UPDATE match_result
  SET disputed = TRUE
  WHERE id = p_match_result_id;

  -- Record in score_confirmation
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'disputed')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.dispute_rebuttal_score(p_match_result_id uuid, p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_rebuttal_score(p_match_result_id uuid, p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_broadcast_recipients(p_sport_ids uuid[] DEFAULT NULL::uuid[], p_locales text[] DEFAULT NULL::text[], p_city text DEFAULT NULL::text, p_province text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_active_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_inactive_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_joined_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_joined_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_subscription text DEFAULT NULL::text, p_genders text[] DEFAULT NULL::text[], p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer)
 RETURNS TABLE(user_id uuid, email text, first_name text, preferred_locale text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY

  SELECT
    p.id                                        AS user_id,
    p.email,
    p.first_name,
    COALESCE(p.preferred_locale::text, 'en-US') AS preferred_locale
  FROM public.profile p
  LEFT JOIN public.player pl ON pl.id = p.id
  WHERE p.onboarding_completed = TRUE
    AND p.email IS NOT NULL
    AND p.email_status = 'ok'
    AND (p.account_status IS NULL OR p.account_status = 'active')
    -- Locale (multi)
    AND (p_locales IS NULL OR p.preferred_locale::text = ANY(p_locales))
    -- Location
    AND (p_city IS NULL OR pl.city ILIKE p_city)
    AND (p_province IS NULL OR pl.province ILIKE p_province)
    AND (p_country IS NULL OR pl.country ILIKE p_country)
    -- Activity window
    AND (p_active_since IS NULL OR p.last_active_at >= p_active_since)
    AND (p_inactive_before IS NULL OR p.last_active_at < p_inactive_before)
    -- Signup window
    AND (p_joined_since IS NULL OR p.created_at >= p_joined_since)
    AND (p_joined_before IS NULL OR p.created_at < p_joined_before)
    -- Demographics
    AND (p_genders IS NULL OR pl.gender::text = ANY(p_genders))
    AND (
      p_min_age IS NULL
      OR (p.birth_date IS NOT NULL
          AND p.birth_date <= (CURRENT_DATE - make_interval(years => p_min_age)))
    )
    AND (
      p_max_age IS NULL
      OR (p.birth_date IS NOT NULL
          AND p.birth_date > (CURRENT_DATE - make_interval(years => p_max_age + 1)))
    )
    -- Sport (multi, OR)
    AND (
      p_sport_ids IS NULL OR EXISTS (
        SELECT 1 FROM public.player_sport ps
        WHERE ps.player_id = p.id AND ps.sport_id = ANY(p_sport_ids)
      )
    )
    -- Subscription state
    AND (
      p_subscription IS NULL
      OR (p_subscription = 'subscribers' AND EXISTS (
            SELECT 1 FROM public.player_subscription sub
            WHERE sub.player_id = p.id AND sub.status = 'active'))
      OR (p_subscription = 'non_subscribers' AND NOT EXISTS (
            SELECT 1 FROM public.player_subscription sub
            WHERE sub.player_id = p.id AND sub.status = 'active'))
    )
    -- Consent
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_preference np
      WHERE np.user_id           = p.id
        AND np.notification_type = 'admin_broadcast'
        AND np.channel           = 'email'
        AND np.enabled           = FALSE
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_broadcast_recipients(p_sport_ids uuid[], p_locales text[], p_city text, p_province text, p_country text, p_active_since timestamp with time zone, p_inactive_before timestamp with time zone, p_joined_since timestamp with time zone, p_joined_before timestamp with time zone, p_subscription text, p_genders text[], p_min_age integer, p_max_age integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_recipients(p_sport_ids uuid[], p_locales text[], p_city text, p_province text, p_country text, p_active_since timestamp with time zone, p_inactive_before timestamp with time zone, p_joined_since timestamp with time zone, p_joined_before timestamp with time zone, p_subscription text, p_genders text[], p_min_age integer, p_max_age integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_just_for_you(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text DEFAULT NULL::text, p_limit integer DEFAULT 5, p_include_suggestions boolean DEFAULT false)
 RETURNS TABLE(kind text, score numeric, match_payload jsonb, suggestion_payload jsonb, player_compatibility numeric, facility_affinity numeric, score_history numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
SET search_path = public
 SET work_mem TO '32MB'
 SET jit TO 'off'
AS $function$
DECLARE
  v_caller_location        extensions.geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
  v_now                    TIMESTAMPTZ := NOW();
  v_pool_size              INT := GREATEST(p_limit * 4, 12);
BEGIN
  IF auth.uid() IS NOT NULL AND p_caller_id IS NOT NULL AND p_caller_id <> auth.uid() THEN
    RAISE EXCEPTION 'p_caller_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- ── Caller context (location, travel cap, sport prefs) ────────────────
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_caller_id;

  -- Location override from RPC params (GPS / different area than stored home)
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_caller_location :=
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  END IF;

  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  -- ── Caller's effective rating + badge (cert > self > disputed; recency tiebreak) ──
  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_sport cps
    JOIN player_rating_score prs ON prs.id = cps.active_rating_score_id
    JOIN rating_score   rs   ON rs.id   = prs.rating_score_id
   WHERE cps.player_id = p_caller_id
     AND cps.sport_id  = p_sport_id;

  RETURN QUERY
  WITH
  -- ── Per-player effective rating for this sport ─────────────────────
  effective_rating AS (
    SELECT
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_sport eps
    JOIN player_rating_score prs ON prs.id = eps.active_rating_score_id
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE eps.sport_id = p_sport_id
  ),

  -- ── Caller's active hourly availability cells ──────────────────────
  caller_avail AS (
    SELECT ca.day, ca.hour_of_day
      FROM player_availability ca
     WHERE ca.player_id = p_caller_id
       AND ca.is_active  = TRUE
  ),

  -- ── Bidirectional blocklist ────────────────────────────────────────
  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_caller_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_caller_id
  ),

  -- ── [FIX #1] Caller's favorited facilities for this sport, and the set of
  --    opponents who share ≥1 of them. The suggestion pool can only ever
  --    surface opponents the caller shares a favorited facility with (the
  --    `matchups` join enforces this), so we prune to that set BEFORE the
  --    expensive per-opponent scoring instead of after. ─────────────────
  caller_fav_facilities AS (
    SELECT pff.facility_id
      FROM player_favorite_facility pff
     WHERE pff.player_id = p_caller_id
       AND pff.sport_id  = p_sport_id
  ),
  shared_fac_opponents AS (
    SELECT DISTINCT pff.player_id AS opp_id
      FROM player_favorite_facility pff
      JOIN caller_fav_facilities cff ON cff.facility_id = pff.facility_id
     WHERE pff.sport_id  = p_sport_id
       AND pff.player_id <> p_caller_id
       -- Matches-only gate: empties the suggestion pool at its root. Every
       -- suggestion CTE descends from here (caller_opp_overlap → overlap_counts
       -- → opponents → matchups → slots), so 0 rows here = no suggestion work.
       AND p_include_suggestions
  ),

  -- ── [FIX #2] Caller↔opponent availability overlap, computed ONCE. Joins
  --    the caller's active cells against opponents' active cells a single
  --    time (restricted to the shared-facility set) so the overlap filter,
  --    the overlap score, and slot expansion all reuse the same rows rather
  --    than re-probing player_availability per opponent. ─────────────────
  caller_opp_overlap AS (
    SELECT oa.player_id AS opp_id, ca.day, ca.hour_of_day
      FROM caller_avail ca
      JOIN player_availability oa
        ON oa.day         = ca.day
       AND oa.hour_of_day = ca.hour_of_day
       AND oa.is_active   = TRUE
       AND oa.player_id  <> p_caller_id
      -- Matches-only gate (also here so the player_availability scan itself is
      -- pruned when suggestions are off, not just emptied via the IN-subquery).
     WHERE p_include_suggestions
       AND oa.player_id IN (SELECT opp_id FROM shared_fac_opponents)
  ),
  overlap_counts AS (
    SELECT opp_id, COUNT(*) AS cells
      FROM caller_opp_overlap
     GROUP BY opp_id
  ),

  -- ── [FIX #3] Per-facility bookability score, computed ONCE for the caller's
  --    favorited facilities. MATERIALIZED so the planner can't inline it and
  --    re-run the snapshot aggregate per matchup row; the inner scan is
  --    restricted to caller facilities so it's a single grouped pass over
  --    facility_availability_snapshot instead of a per-row correlated COUNT.
  --    Replaces the old inline subquery that did ~50k heap fetches/request. ──
  facility_bookable AS MATERIALIZED (
    SELECT
      cff.facility_id,
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.facility_refresh_log frl WHERE frl.facility_id = cff.facility_id
        ) THEN 0.5
        ELSE LEAST(1.0, COALESCE(s.c, 0)::numeric / 30.0)
      END AS score_bookability
    FROM caller_fav_facilities cff
    LEFT JOIN (
      SELECT fas.facility_id, COUNT(*)::numeric AS c
        FROM public.facility_availability_snapshot fas
       WHERE fas.is_available = TRUE
         AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
         AND fas.facility_id IN (SELECT facility_id FROM caller_fav_facilities)
       GROUP BY fas.facility_id
    ) s ON s.facility_id = cff.facility_id
  ),

  -- ── Responsiveness (90-day window — applied to both creators and
  --    opponents; the join in each pool picks the relevant player_id) ──
  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= v_now - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < v_now - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

  -- ── Caller↔opponent history components (identical to both existing
  --    RPCs; the join in each pool keys on opp_id = creator/opponent) ──
  history_fb AS (
    SELECT mf.opponent_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END * ((mf.star_rating - 3)::numeric / 2.0)
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_signed_weighted,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_weight_sum,
      COUNT(*) FILTER (WHERE mf.showed_up = FALSE) AS no_shows,
      COUNT(*) FILTER (WHERE mf.was_late = TRUE)   AS lates,
      COUNT(*) AS fb_events
    FROM match_feedback mf
    JOIN match m ON m.id = mf.match_id
    WHERE mf.reviewer_id = p_caller_id
    GROUP BY mf.opponent_id
  ),
  history_pm AS (
    SELECT other.player_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) AS pair_match_weight,
      COUNT(*) AS pair_match_count
    FROM match_participant me
    JOIN match m ON m.id = me.match_id
    JOIN match_participant other
      ON other.match_id = me.match_id
     AND other.player_id <> p_caller_id
     AND other.status = 'joined'
    WHERE me.player_id = p_caller_id
      AND me.status = 'joined'
      AND m.cancelled_at IS NULL
      AND m.match_date < CURRENT_DATE
    GROUP BY other.player_id
  ),
  history_fav AS (
    SELECT pf.favorite_player_id AS opp_id,
      TRUE AS caller_fav,
      EXISTS (
        SELECT 1 FROM player_favorite pf2
         WHERE pf2.player_id = pf.favorite_player_id
           AND pf2.favorite_player_id = p_caller_id
      ) AS mutual_fav
    FROM player_favorite pf
    WHERE pf.player_id = p_caller_id
  ),
  history_net AS (
    SELECT nm2.player_id AS opp_id,
      MAX(CASE nt.name
            WHEN 'friends'      THEN 0.20::numeric
            WHEN 'player_group' THEN 0.20::numeric
            WHEN 'club'         THEN 0.12::numeric
            WHEN 'community'    THEN 0.08::numeric
            WHEN 'private'      THEN 0.06::numeric
            WHEN 'public'       THEN 0.04::numeric
            ELSE 0.0::numeric
          END) AS net_weight,
      COUNT(*) AS net_events
    FROM network_member nm1
    JOIN network n          ON n.id = nm1.network_id
    JOIN network_type nt    ON nt.id = n.network_type_id
    JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                           AND nm2.player_id <> p_caller_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = p_caller_id
      AND nm1.status = 'active'
    GROUP BY nm2.player_id
  ),
  history_conv AS (
    SELECT cp2.player_id AS opp_id,
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= v_now - INTERVAL '30 days'
      ) AS recent_msgs
    FROM conversation_participant cp1
    JOIN conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id <> p_caller_id
    LEFT JOIN message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_caller_id
    GROUP BY cp2.player_id
  ),
  history_prep AS (
    SELECT pr.reported_player_id AS opp_id, COUNT(*) AS rep_count
    FROM player_report pr
    WHERE pr.reporter_id = p_caller_id
      AND pr.status::text <> 'dismissed'
    GROUP BY pr.reported_player_id
  ),
  history_mrep AS (
    SELECT mr.reported_id AS opp_id, COUNT(*) AS mrep_count
    FROM match_report mr
    WHERE mr.reporter_id = p_caller_id
    GROUP BY mr.reported_id
  ),
  history_universe AS (
    SELECT opp_id FROM history_fb
    UNION SELECT opp_id FROM history_pm
    UNION SELECT opp_id FROM history_fav
    UNION SELECT opp_id FROM history_net
    UNION SELECT opp_id FROM history_conv
    UNION SELECT opp_id FROM history_prep
    UNION SELECT opp_id FROM history_mrep
  ),
  history AS (
    SELECT
      u.opp_id,
      CASE
        WHEN (
          COALESCE(pm.pair_match_count, 0)
          + COALESCE(fb.fb_events, 0)
          + (CASE WHEN fav.caller_fav THEN 1 ELSE 0 END)
          + COALESCE(net.net_events, 0)
          + COALESCE(conv.convo_count, 0)
          + COALESCE(prep.rep_count, 0)
          + COALESCE(mrep.mrep_count, 0)
        ) < 2 THEN 0::numeric
        ELSE GREATEST(-0.5::numeric, LEAST(0.5::numeric,
            LEAST(0.40::numeric, COALESCE(pm.pair_match_weight, 0) * 0.10)
          + CASE
              WHEN fb.star_weight_sum IS NOT NULL AND fb.star_weight_sum > 0
              THEN GREATEST(-0.30::numeric, LEAST(0.30::numeric,
                     (fb.star_signed_weighted / fb.star_weight_sum) * 0.30))
              ELSE 0::numeric
            END
          + CASE WHEN fav.caller_fav THEN 0.15::numeric ELSE 0::numeric END
          + CASE WHEN fav.mutual_fav THEN 0.10::numeric ELSE 0::numeric END
          + LEAST(0.20::numeric, COALESCE(net.net_weight, 0))
          + LEAST(0.10::numeric,
              (CASE WHEN COALESCE(conv.convo_count, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            + (CASE WHEN COALESCE(conv.recent_msgs, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            )
          - LEAST(0.30::numeric, COALESCE(prep.rep_count, 0) * 0.20)
          - LEAST(0.20::numeric, COALESCE(mrep.mrep_count, 0) * 0.10)
          - LEAST(0.40::numeric, COALESCE(fb.no_shows, 0) * 0.25)
          - LEAST(0.10::numeric, COALESCE(fb.lates, 0) * 0.05)
        ))
      END::numeric(6,4) AS score_history
    FROM history_universe u
    LEFT JOIN history_pm   pm   ON pm.opp_id   = u.opp_id
    LEFT JOIN history_fb   fb   ON fb.opp_id   = u.opp_id
    LEFT JOIN history_fav  fav  ON fav.opp_id  = u.opp_id
    LEFT JOIN history_net  net  ON net.opp_id  = u.opp_id
    LEFT JOIN history_conv conv ON conv.opp_id = u.opp_id
    LEFT JOIN history_prep prep ON prep.opp_id = u.opp_id
    LEFT JOIN history_mrep mrep ON mrep.opp_id = u.opp_id
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- MATCH POOL — mirrors get_upcoming_matches_scored, ranked + capped
  -- ═══════════════════════════════════════════════════════════════════
  candidate_matches AS (
    SELECT
      m.id                        AS m_id,
      m.created_by                AS creator_id,
      m.facility_id               AS m_facility_id,
      m.location_type             AS m_location_type,
      m.match_date                AS m_date,
      m.start_time                AS m_start_time,
      m.end_time                  AS m_end_time,
      m.duration                  AS m_duration,
      m.player_expectation        AS m_match_type,
      m.format                    AS m_format,
      m.court_status              AS m_court_status,
      m.is_court_free             AS m_is_court_free,
      m.estimated_cost            AS m_estimated_cost,
      m.preferred_opponent_gender AS m_preferred_gender,
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
        WHEN m.location_type = 'custom'
          AND m.custom_latitude IS NOT NULL
          AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        ELSE NULL
      END                          AS m_location,
      f.location                   AS facility_location,
      extensions.ST_Distance(
        CASE
          WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
          WHEN m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL THEN
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
              4326
            )::extensions.geography
          ELSE NULL
        END,
        v_caller_location
      )                            AS m_distance_meters
    FROM match m
    LEFT JOIN facility f      ON f.id      = m.facility_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id    = p_sport_id
      AND m.created_by <> p_caller_id
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp
         WHERE mp.match_id  = m.id
           AND mp.player_id = p_caller_id
           AND mp.status IN ('joined', 'requested', 'waitlisted')
      )
      AND (
        CASE
          WHEN m.timezone IS NOT NULL THEN
            timezone(m.timezone, (m.match_date + m.start_time)::timestamp) > v_now
          ELSE
            (m.match_date + m.start_time)::timestamp > (v_now AT TIME ZONE 'UTC')::timestamp
        END
      )
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL)
      )
      AND extensions.ST_DWithin(
        CASE
          WHEN m.location_type = 'facility' THEN f.location
          ELSE extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        END,
        v_caller_location,
        p_max_distance_km * 1000
      )
      AND (
        p_user_gender IS NULL
        OR m.preferred_opponent_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
      AND m.created_by NOT IN (SELECT pid FROM blocked_ids)
  ),

  match_scored_base AS (
    SELECT
      cm.m_id,
      cm.m_distance_meters,
      cm.creator_id,
      cm.m_format,
      cm.m_court_status,
      cm.m_is_court_free,
      cm.m_estimated_cost,
      cm.m_preferred_gender,
      cm.m_date,
      er.badge_status AS creator_badge_status,
      CASE
        WHEN cm.m_match_type IS NULL THEN 0.5
        WHEN v_caller_match_type = cm.m_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR cm.m_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,
      CASE
        WHEN v_caller_rating_value IS NULL OR er.rating_value IS NULL THEN 0.5
        WHEN ABS(v_caller_rating_value - er.rating_value) = 0    THEN 1.0
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 0.5 THEN 0.7
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      *
      CASE
        WHEN v_caller_badge_status IS NULL THEN
          CASE er.badge_status WHEN 'certified' THEN 0.5 WHEN 'self_declared' THEN 0.5 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status WHEN 'certified' THEN 1.0 WHEN 'self_declared' THEN 0.6 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.6 WHEN 'self_declared' THEN 0.4 WHEN 'disputed' THEN 0.2 ELSE 0.5 END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.3 WHEN 'self_declared' THEN 0.2 WHEN 'disputed' THEN 0.1 ELSE 0.3 END
        ELSE 0.5
      END AS score_skill,
      CASE
        WHEN v_caller_match_duration IS NULL OR cm.m_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = cm.m_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,
      CASE
        WHEN cm.m_start_time IS NULL OR cm.m_end_time IS NULL THEN 0.5
        ELSE COALESCE((
          SELECT
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM caller_avail ca
               WHERE ca.day::TEXT = LOWER(TO_CHAR(cm.m_date, 'FMday'))
                 AND ca.hour_of_day = h.hr::smallint
            ) THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0)
          FROM generate_series(
            EXTRACT(HOUR FROM cm.m_start_time)::int,
            GREATEST(
              EXTRACT(HOUR FROM cm.m_start_time)::int,
              EXTRACT(HOUR FROM cm.m_end_time)::int - 1
            )
          ) AS h(hr)
        ), 0.0)
      END AS score_availability_fit,
      CASE
        WHEN COALESCE(rep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(rep.reputation_score, 50.0) / 100.0
      END AS score_reputation,
      COALESCE(
        CASE
          WHEN rs.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (rs.responded::NUMERIC / NULLIF(rs.received, 0))
            + 0.3 * (CASE WHEN rs.responded > 0 THEN rs.accepted::NUMERIC / rs.responded ELSE 0.5 END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,
      public.player_activity_score(cm.creator_id)::DECIMAL(6,4) AS score_activity,
      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS pair_score_history,
      CASE
        WHEN cm.m_facility_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_caller_id
             AND cpff.facility_id = cm.m_facility_id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30
        ELSE 0.0
      END AS fac_shared_fav_bonus,
      CASE
        WHEN cm.m_location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.m_location, v_caller_location)
                       / (COALESCE(v_caller_max_distance, 25) * 1000)))
      END AS fac_dist_caller,
      CASE
        WHEN cm.m_facility_id IS NULL
          OR cm.facility_location IS NULL
          OR creator_player.location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.facility_location, creator_player.location)
                       / (COALESCE(creator_player.max_travel_distance, 25) * 1000)))
      END AS fac_dist_creator
    FROM candidate_matches cm
    JOIN player creator_player      ON creator_player.id = cm.creator_id
    LEFT JOIN effective_rating er   ON er.player_id      = cm.creator_id
    LEFT JOIN player_reputation rep ON rep.player_id     = cm.creator_id
    LEFT JOIN responsiveness rs     ON rs.player_id      = cm.creator_id
    LEFT JOIN history h             ON h.opp_id          = cm.creator_id
  ),

  -- Composer-equivalent score for the carousel: server compatibility +
  -- facility affinity + the four TS-side actionability/tier/gender/cost
  -- signals (mirrors `scoreNearbyMatch` auth path in matchScoring.ts).
  -- Spots, tier, gender, cost are joined here against participants/cost so
  -- the ranking matches the legacy composer.
  match_signals AS (
    SELECT
      sb.*,
      LEAST(1.0, GREATEST(0.0,
        ( 0.18 * sb.score_match_type
        + 0.18 * sb.score_skill
        + 0.05 * sb.score_duration
        + 0.27 * sb.score_availability_fit
        + 0.05 * sb.score_reputation
        + 0.17 * sb.score_responsiveness
        + 0.10 * sb.score_activity
        )
        + 0.5 * sb.pair_score_history
        - (CASE WHEN sb.creator_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))::DECIMAL(6,4) AS player_compat,
      LEAST(1.0,
        sb.fac_shared_fav_bonus + sb.fac_dist_caller + sb.fac_dist_creator
      )::DECIMAL(6,4) AS fac_affinity,
      (
        CASE sb.m_format WHEN 'doubles' THEN 4 ELSE 2 END
        - COALESCE((
          SELECT COUNT(*) FROM match_participant pp
           WHERE pp.match_id = sb.m_id AND pp.status = 'joined'
        ), 0)
      ) AS spots_left,
      EXISTS (
        SELECT 1 FROM match_participant pp
        JOIN player_sport pps ON pps.player_id = pp.player_id AND pps.sport_id = p_sport_id
        JOIN player_rating_score prs ON prs.id = pps.active_rating_score_id
        WHERE pp.match_id = sb.m_id
          AND pp.status = 'joined'
          AND (
            prs.badge_status = 'certified'::badge_status_enum
            OR prs.is_certified
            OR prs.referrals_count >= 3
            OR prs.approved_proofs_count >= 1
          )
      ) AS has_certified_joined
    FROM match_scored_base sb
  ),

  match_with_cost AS (
    SELECT
      ms.*,
      -- Cost normalization is batch-relative; max() OVER () computes across
      -- the candidate pool so a 0..1 ratio falls out.
      (CASE
        WHEN ms.m_is_court_free OR ms.m_estimated_cost IS NULL OR ms.m_estimated_cost = 0 THEN 1.0
        WHEN COALESCE(MAX(ms.m_estimated_cost) OVER (), 0) <= 0 THEN 0.5
        ELSE GREATEST(0.1, 1.0 - ms.m_estimated_cost::numeric / MAX(ms.m_estimated_cost) OVER ())
      END)::numeric AS score_cost
    FROM match_signals ms
  ),

  scored_matches AS (
    SELECT
      mc.m_id,
      mc.creator_id,
      mc.m_distance_meters,
      mc.player_compat,
      mc.fac_affinity,
      mc.pair_score_history,
      -- Composer recipe (matchScoring.ts auth path): 0.55 pc + 0.20 fa + 0.10
      -- spots + 0.05 tier + 0.05 gender + 0.05 cost, plus REAL_ACTION_BONUS
      -- (0.05), urgency, and jitter.
      (
        0.55 * mc.player_compat
      + 0.20 * mc.fac_affinity
      + 0.10 * (CASE
          WHEN mc.spots_left <= 0 THEN 0.0
          WHEN mc.spots_left = 1  THEN 1.0
          WHEN mc.spots_left = 2  THEN 0.7
          WHEN mc.spots_left = 3  THEN 0.4
          ELSE 0.2
        END)
      + 0.05 * (CASE
          WHEN mc.has_certified_joined AND mc.m_court_status = 'reserved'::court_status_enum THEN 1.0
          WHEN mc.has_certified_joined OR  mc.m_court_status = 'reserved'::court_status_enum THEN 0.6
          ELSE 0.2
        END)
      + 0.05 * (CASE
          WHEN mc.m_preferred_gender IS NULL THEN 0.7
          WHEN p_user_gender IS NULL THEN 0.5
          WHEN mc.m_preferred_gender = p_user_gender::gender_enum THEN 1.0
          ELSE 0.3
        END)
      + 0.05 * mc.score_cost
      + 0.05  -- REAL_ACTION_BONUS (justForYouComposer.ts)
      + (CASE
          WHEN mc.m_date = CURRENT_DATE     THEN 0.05
          WHEN mc.m_date = CURRENT_DATE + 1 THEN 0.03
          WHEN mc.m_date = CURRENT_DATE + 2 THEN 0.01
          ELSE 0.0
        END)
      + ((random() - 0.5) * 0.06)  -- jitter ±0.03
      )::DECIMAL(8,4) AS final_score
    FROM match_with_cost mc
    ORDER BY (
      -- Pool ranking uses the player_compat × facility_affinity composite
      -- (without random) so the pre-filter cap is deterministic. The boosts
      -- only shape the final order across the merged top-N.
      0.70 * mc.player_compat + 0.30 * mc.fac_affinity
    ) DESC
    LIMIT v_pool_size
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- SUGGESTION POOL — mirrors get_match_suggestions_scored, then expands
  --                   into per-hour slots filtered by busy + snapshot
  -- ═══════════════════════════════════════════════════════════════════
  -- [FIX #1+#2] Opponents are now restricted to the shared-favorite-facility
  -- set via an INNER JOIN to overlap_counts (which is itself derived from
  -- shared_fac_opponents), and the overlap score reuses the precomputed
  -- overlap_counts.cells instead of a per-row correlated subquery. The old
  -- EXISTS availability filter is subsumed by the INNER JOIN.
  opponents AS (
    SELECT
      ps.player_id                  AS opp_id,
      COALESCE(pr.first_name, '')   AS opp_first_name,
      COALESCE(pr.last_name, '')    AS opp_last_name,
      pr.profile_picture_url        AS opp_avatar,
      opp.location                  AS opp_location,
      opp.max_travel_distance       AS opp_max_distance,
      ps.preferred_match_type       AS opp_match_type,
      ps.preferred_match_duration   AS opp_match_duration,
      COALESCE(prep.reputation_score, 0)        AS opp_rep_score,
      COALESCE(prep.reputation_tier, 'unknown') AS opp_rep_tier,
      COALESCE(prep.total_events, 0)            AS opp_rep_events,
      COALESCE(prep.is_public, FALSE)           AS opp_rep_public,
      er.rating_value                           AS opp_rating_value,
      er.rating_label                           AS opp_rating_label,
      er.badge_status                           AS opp_badge_status,
      CASE
        WHEN v_caller_match_type = ps.preferred_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR ps.preferred_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,
      CASE
        WHEN v_caller_rating_value IS NULL OR er.rating_value IS NULL THEN 0.5
        WHEN ABS(v_caller_rating_value - er.rating_value) = 0    THEN 1.0
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 0.5 THEN 0.7
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      *
      CASE
        WHEN v_caller_badge_status IS NULL THEN
          CASE er.badge_status WHEN 'certified' THEN 0.5 WHEN 'self_declared' THEN 0.5 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status WHEN 'certified' THEN 1.0 WHEN 'self_declared' THEN 0.6 WHEN 'disputed' THEN 0.3 ELSE 0.5 END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.6 WHEN 'self_declared' THEN 0.4 WHEN 'disputed' THEN 0.2 ELSE 0.5 END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status WHEN 'certified' THEN 0.3 WHEN 'self_declared' THEN 0.2 WHEN 'disputed' THEN 0.1 ELSE 0.3 END
        ELSE 0.5
      END AS score_skill,
      CASE
        WHEN v_caller_match_duration IS NULL OR ps.preferred_match_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = ps.preferred_match_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,
      LEAST(oc.cells::DECIMAL / 12.0, 1.0) AS score_overlap,
      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,
      COALESCE(
        CASE
          WHEN r.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (r.responded::NUMERIC / NULLIF(r.received, 0))
            + 0.3 * (CASE WHEN r.responded > 0 THEN r.accepted::NUMERIC / r.responded ELSE 0.5 END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,
      public.player_activity_score(ps.player_id)::DECIMAL(6,4) AS score_activity,
      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS opp_score_history
    FROM player_sport ps
    JOIN overlap_counts oc ON oc.opp_id = ps.player_id
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN effective_rating er    ON er.player_id   = ps.player_id
    LEFT JOIN responsiveness r       ON r.player_id    = ps.player_id
    LEFT JOIN history h              ON h.opp_id       = ps.player_id
   WHERE ps.sport_id    = p_sport_id
     AND ps.player_id  != p_caller_id
     AND opp.location   IS NOT NULL
     AND ps.player_id NOT IN (SELECT pid FROM blocked_ids)
     AND (
       v_caller_rating_value IS NULL
       OR er.rating_value IS NULL
       OR ABS(er.rating_value - v_caller_rating_value) <= 0.5
     )
   ORDER BY extensions.ST_Distance(opp.location, v_caller_location)
   LIMIT 200
  ),

  matchups AS (
    SELECT
      o.*,
      f.id              AS fac_id,
      f.name::TEXT      AS fac_name,
      COALESCE(f.address, '')::TEXT   AS fac_address,
      COALESCE(f.city, '')::TEXT      AS fac_city,
      f.timezone                AS fac_timezone,
      extensions.ST_Distance(f.location, v_caller_location) AS dist_caller,
      extensions.ST_Distance(f.location, o.opp_location)    AS dist_opponent,
      (
        CASE WHEN EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_caller_id
             AND cpff.facility_id = f.id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30 ELSE 0.0 END
        + GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        + GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, o.opp_location)   / (COALESCE(o.opp_max_distance, 25)    * 1000)))
      ) AS score_facility_geo,
      -- [FIX #3] precomputed once in facility_bookable (was a per-row COUNT
      -- subquery over the snapshot). COALESCE guards the (impossible) miss:
      -- every matchup facility is one the caller favorited, so it's always
      -- present; 0.5 mirrors the old "no refresh log" neutral default.
      COALESCE(fb.score_bookability, 0.5) AS score_bookability
    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id  = o.opp_id
     AND pff.sport_id   = p_sport_id
    -- Require the caller to ALSO have favorited this facility for this sport.
    JOIN player_favorite_facility cpff
      ON cpff.player_id   = p_caller_id
     AND cpff.sport_id    = p_sport_id
     AND cpff.facility_id = pff.facility_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN facility_bookable fb ON fb.facility_id = f.id
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, COALESCE(v_caller_max_distance, 25) * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location,   COALESCE(o.opp_max_distance, 25)    * 1000)
  ),

  ranked_suggestions AS MATERIALIZED (
    SELECT
      m.*,
      LEAST(1.0, GREATEST(0.0,
        ( 0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
        + 0.5 * m.opp_score_history
        - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))::DECIMAL(6,4) AS player_compat,
      LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)::DECIMAL(6,4) AS fac_affinity
    FROM matchups m
    ORDER BY (
      0.70 * LEAST(1.0, GREATEST(0.0,
        ( 0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
        + 0.5 * m.opp_score_history
        - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))
    + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
    ) DESC
    LIMIT v_pool_size
  ),

  -- ── Slot expansion (port of generateFixedHourSlots) ─────────────────
  -- Cross-join the 7-day window with the caller×opponent overlap cells,
  -- filter against busy slots + facility snapshot. Each row is a
  -- candidate (opponent, facility, slot_start) triplet.
  -- [FIX #2] Reuse the precomputed caller_opp_overlap rows instead of
  -- re-joining caller_avail to player_availability per opponent.
  date_window AS (
    SELECT generate_series(0, 6) AS day_offset
  ),
  candidate_slots AS (
    SELECT
      r.opp_id,
      r.opp_first_name, r.opp_last_name, r.opp_avatar,
      r.opp_rep_public, r.opp_rep_score, r.opp_rep_tier, r.opp_rep_events,
      r.opp_rating_value, r.opp_rating_label, r.opp_badge_status,
      r.opp_match_type, r.opp_match_duration,
      r.fac_id, r.fac_name, r.fac_address, r.fac_city, r.fac_timezone,
      r.player_compat, r.fac_affinity, r.opp_score_history,
      ov.day AS slot_day,
      ov.hour_of_day AS slot_hour,
      ((v_now AT TIME ZONE COALESCE(r.fac_timezone, 'UTC'))::date + dw.day_offset) AS slot_date,
      ((((v_now AT TIME ZONE COALESCE(r.fac_timezone, 'UTC'))::date + dw.day_offset)
         + (LPAD(ov.hour_of_day::text, 2, '0') || ':00:00')::time)
       AT TIME ZONE COALESCE(r.fac_timezone, 'UTC')) AS slot_start
    FROM ranked_suggestions r
    CROSS JOIN date_window dw
    JOIN caller_opp_overlap ov ON ov.opp_id = r.opp_id
    -- Weekday of the generated date must equal the overlap cell's day.
    WHERE LOWER(TO_CHAR((v_now AT TIME ZONE COALESCE(r.fac_timezone, 'UTC'))::date + dw.day_offset, 'FMday'))
          = ov.day::text
  ),
  filtered_slots AS (
    SELECT
      cs.*,
      cs.slot_start + INTERVAL '1 hour' AS slot_end
    FROM candidate_slots cs
    WHERE cs.slot_start > v_now
      -- Snapshot filter — only when facility has been refreshed at least
      -- once AND the slot is within the 3-day snapshot horizon.
      AND (
        NOT EXISTS (SELECT 1 FROM facility_refresh_log frl WHERE frl.facility_id = cs.fac_id)
        OR cs.slot_start > v_now + INTERVAL '3 days'
        OR EXISTS (
          SELECT 1 FROM facility_availability_snapshot fas
           WHERE fas.facility_id  = cs.fac_id
             AND fas.is_available = TRUE
             AND fas.slot_start   = cs.slot_start
        )
      )
      -- Busy-slot conflict for caller + opponent: any active participant row
      -- on a non-cancelled match whose [start,end) overlaps the candidate
      -- 1-hour window on the same calendar date.
      AND NOT EXISTS (
        SELECT 1
          FROM match_participant bmp
          JOIN match bm ON bm.id = bmp.match_id
         WHERE bmp.player_id IN (p_caller_id, cs.opp_id)
           AND bmp.status IN ('joined','requested','pending','waitlisted')
           AND bm.cancelled_at IS NULL
           AND bm.match_date = cs.slot_date
           AND (bm.start_time, bm.end_time) OVERLAPS
               ((LPAD(cs.slot_hour::text, 2, '0') || ':00:00')::time,
                (LPAD((cs.slot_hour + 1)::text, 2, '0') || ':00:00')::time)
      )
  ),

  -- Per-opponent slot counts for actionability boost (caps at 0.1).
  slots_with_counts AS (
    SELECT
      fs.*,
      COUNT(*) OVER (PARTITION BY fs.opp_id) AS opp_slot_count
    FROM filtered_slots fs
  ),

  -- Per-slot score = player_compat (RPC base) + actionability + urgency + jitter.
  -- Mirrors suggestionService.ts:638-644.
  scored_slots AS (
    SELECT
      sc.*,
      (sc.player_compat
       + LEAST(0.10::numeric, GREATEST(0::numeric, (sc.opp_slot_count - 1)::numeric * 0.012))
       + (CASE
            -- Urgency curve matches urgencyBoostForDate in suggestionService.ts.
            -- "Today" is the facility-local date so the bucket matches user
            -- expectation across timezone boundaries.
            WHEN (sc.slot_date - (v_now AT TIME ZONE COALESCE(sc.fac_timezone, 'UTC'))::date) <= 1 THEN 0.05
            WHEN (sc.slot_date - (v_now AT TIME ZONE COALESCE(sc.fac_timezone, 'UTC'))::date) = 2  THEN 0.03
            WHEN (sc.slot_date - (v_now AT TIME ZONE COALESCE(sc.fac_timezone, 'UTC'))::date) = 3  THEN 0.01
            ELSE 0.0
          END)
       + ((random() - 0.5) * 0.06)
      )::DECIMAL(8,4) AS slot_score
    FROM slots_with_counts sc
  ),

  -- Pick the best slot per opponent (mirrors pickTopGlobal's per-opponent
  -- dedup). DISTINCT ON keeps the first row per opp_id under the ORDER BY.
  best_slot_per_opponent AS (
    SELECT DISTINCT ON (ss.opp_id)
      ss.*
    FROM scored_slots ss
    ORDER BY ss.opp_id, ss.slot_score DESC
  ),

  -- Cross-pool dedup: drop suggestions for opponents whose match already
  -- won a slot in the match pool (justForYouComposer.ts:200-204).
  match_creator_ids AS (
    SELECT DISTINCT creator_id FROM scored_matches
  ),
  deduped_suggestions AS (
    SELECT bs.*
    FROM best_slot_per_opponent bs
    WHERE bs.opp_id NOT IN (SELECT creator_id FROM match_creator_ids)
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- JSONB PAYLOAD BUILDERS
  -- ═══════════════════════════════════════════════════════════════════

  -- Build full MatchWithDetails JSONB for each match — sport, facility,
  -- court, min_rating_score, created_by_player + profile + reputation +
  -- sport rating, participants[] with the same chain, result + sets +
  -- confirmations. Mirrors the embedded select in getMatchWithDetails.
  match_payloads AS (
    SELECT
      sm.m_id,
      sm.final_score AS score,
      sm.player_compat,
      sm.fac_affinity,
      sm.pair_score_history,
      to_jsonb(m.*)
        || jsonb_build_object(
          'distance_meters', sm.m_distance_meters,
          'player_compatibility', sm.player_compat,
          'facility_affinity', sm.fac_affinity,
          'score_history', sm.pair_score_history,
          'sport', to_jsonb(sp.*),
          'facility', CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f.*) END,
          'court', CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c.*) END,
          'min_rating_score', CASE WHEN mrs.id IS NULL THEN NULL ELSE to_jsonb(mrs.*) END,
          'created_by_player', (
            SELECT jsonb_build_object(
              'id', cp.id,
              'gender', cp.gender,
              'playing_hand', cp.playing_hand,
              'max_travel_distance', cp.max_travel_distance,
              'notification_match_requests', cp.notification_match_requests,
              'notification_messages', cp.notification_messages,
              'notification_reminders', cp.notification_reminders,
              'privacy_show_age', cp.privacy_show_age,
              'privacy_show_location', cp.privacy_show_location,
              'privacy_show_stats', cp.privacy_show_stats,
              'profile', to_jsonb(cprof.*),
              'player_reputation', CASE WHEN crep.player_id IS NULL THEN NULL
                                        ELSE jsonb_build_object(
                                          'reputation_score', crep.reputation_score,
                                          'total_events', crep.total_events
                                        ) END,
              'sportRatingLabel', cer.rating_label,
              'sportRatingValue', cer.rating_value,
              'sportCertificationStatus', cer.badge_status
            )
            FROM player cp
            LEFT JOIN profile cprof ON cprof.id = cp.id
            LEFT JOIN player_reputation crep ON crep.player_id = cp.id
            LEFT JOIN effective_rating cer ON cer.player_id = cp.id
            WHERE cp.id = m.created_by
          ),
          'participants', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', mp.id,
                'match_id', mp.match_id,
                'player_id', mp.player_id,
                'status', mp.status,
                'is_host', mp.is_host,
                'score', mp.score,
                'team_number', mp.team_number,
                'feedback_completed', mp.feedback_completed,
                'has_paid', mp.has_paid,
                'payment_intent_id', mp.payment_intent_id,
                'checked_in_at', mp.checked_in_at,
                'joined_at', mp.joined_at,
                'created_at', mp.created_at,
                'updated_at', mp.updated_at,
                'player', jsonb_build_object(
                  'id', pp.id,
                  'gender', pp.gender,
                  'playing_hand', pp.playing_hand,
                  'max_travel_distance', pp.max_travel_distance,
                  'notification_match_requests', pp.notification_match_requests,
                  'notification_messages', pp.notification_messages,
                  'notification_reminders', pp.notification_reminders,
                  'privacy_show_age', pp.privacy_show_age,
                  'privacy_show_location', pp.privacy_show_location,
                  'privacy_show_stats', pp.privacy_show_stats,
                  'profile', to_jsonb(pprof.*),
                  'player_reputation', CASE WHEN prep2.player_id IS NULL THEN NULL
                                            ELSE jsonb_build_object(
                                              'reputation_score', prep2.reputation_score,
                                              'total_events', prep2.total_events
                                            ) END,
                  'sportRatingLabel', per.rating_label,
                  'sportRatingValue', per.rating_value,
                  'sportCertificationStatus', per.badge_status
                )
              )
            )
            FROM match_participant mp
            LEFT JOIN player pp ON pp.id = mp.player_id
            LEFT JOIN profile pprof ON pprof.id = mp.player_id
            LEFT JOIN player_reputation prep2 ON prep2.player_id = mp.player_id
            LEFT JOIN effective_rating per ON per.player_id = mp.player_id
            WHERE mp.match_id = m.id
          ), '[]'::jsonb),
          'result', (
            SELECT jsonb_build_object(
              'id', mr.id,
              'winning_team', mr.winning_team,
              'team1_score', mr.team1_score,
              'team2_score', mr.team2_score,
              'is_verified', mr.is_verified,
              'disputed', mr.disputed,
              'submitted_by', mr.submitted_by,
              'confirmation_deadline', mr.confirmation_deadline,
              'confirmed_by', mr.confirmed_by,
              'verified_at', mr.verified_at,
              'created_at', mr.created_at,
              'updated_at', mr.updated_at,
              'rebuttal_team1_score', mr.rebuttal_team1_score,
              'rebuttal_team2_score', mr.rebuttal_team2_score,
              'rebuttal_winning_team', mr.rebuttal_winning_team,
              'rebuttal_sets', mr.rebuttal_sets,
              'rebuttal_submitted_by', mr.rebuttal_submitted_by,
              'rebuttal_submitted_at', mr.rebuttal_submitted_at,
              'rebuttal_deadline', mr.rebuttal_deadline,
              'sets', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'set_number', ms.set_number,
                  'team1_score', ms.team1_score,
                  'team2_score', ms.team2_score
                ) ORDER BY ms.set_number)
                FROM match_set ms WHERE ms.match_result_id = mr.id
              ), '[]'::jsonb),
              'confirmations', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'player_id', sc.player_id,
                  'action', sc.action
                ))
                FROM score_confirmation sc WHERE sc.match_result_id = mr.id
              ), '[]'::jsonb)
            )
            FROM match_result mr WHERE mr.match_id = m.id
            LIMIT 1
          )
        ) AS payload
    FROM scored_matches sm
    JOIN match m              ON m.id   = sm.m_id
    LEFT JOIN sport sp        ON sp.id  = m.sport_id
    LEFT JOIN facility f      ON f.id   = m.facility_id
    LEFT JOIN court c         ON c.id   = m.court_id
    LEFT JOIN rating_score mrs ON mrs.id = m.min_rating_score_id
  ),

  suggestion_payloads AS (
    SELECT
      ds.opp_id,
      ds.slot_score AS score,
      ds.player_compat,
      ds.fac_affinity,
      ds.opp_score_history,
      jsonb_build_object(
        'opponentId', ds.opp_id,
        'opponentFirstName', ds.opp_first_name,
        'opponentLastName', ds.opp_last_name,
        'opponentAvatar', ds.opp_avatar,
        'opponentReputationScore', CASE WHEN ds.opp_rep_public THEN ds.opp_rep_score ELSE NULL END,
        'opponentReputationTier', CASE WHEN ds.opp_rep_events < 5 THEN 'unknown'
                                       ELSE ds.opp_rep_tier::text END,
        'opponentRatingScoreValue', ds.opp_rating_value,
        'opponentRatingLabel', ds.opp_rating_label,
        'opponentBadgeStatus', ds.opp_badge_status,
        'matchType', ds.opp_match_type,
        'matchDuration', ds.opp_match_duration,
        'facility', jsonb_build_object(
          'facilityId', ds.fac_id,
          'facilityName', ds.fac_name,
          'facilityAddress', ds.fac_address,
          'facilityCity', ds.fac_city,
          'facilityAffinity', ds.fac_affinity,
          'hasAvailabilitySource', FALSE
        ),
        'slot', jsonb_build_object(
          'datetime', ds.slot_start,
          'endDatetime', ds.slot_end,
          'bookingUrl', NULL
        ),
        'score', ds.slot_score,
        'playerCompatibility', ds.player_compat,
        'scoreHistory', ds.opp_score_history
      ) AS payload
    FROM deduped_suggestions ds
  ),

  -- ═══════════════════════════════════════════════════════════════════
  -- FINAL MERGE — UNION ALL, ORDER BY score DESC, LIMIT p_limit
  -- ═══════════════════════════════════════════════════════════════════
  merged AS (
    SELECT
      'match'::text                    AS kind,
      mp.score                         AS score,
      mp.payload                       AS match_payload,
      NULL::jsonb                      AS suggestion_payload,
      mp.player_compat                 AS player_compatibility,
      mp.fac_affinity                  AS facility_affinity,
      mp.pair_score_history            AS score_history
    FROM match_payloads mp
    UNION ALL
    SELECT
      'suggestion'::text               AS kind,
      sp.score                         AS score,
      NULL::jsonb                      AS match_payload,
      sp.payload                       AS suggestion_payload,
      sp.player_compat                 AS player_compatibility,
      sp.fac_affinity                  AS facility_affinity,
      sp.opp_score_history             AS score_history
    FROM suggestion_payloads sp
  )

  SELECT
    merged.kind,
    merged.score::numeric,
    merged.match_payload,
    merged.suggestion_payload,
    merged.player_compatibility::numeric,
    merged.facility_affinity::numeric,
    merged.score_history::numeric
  FROM merged
  ORDER BY merged.score DESC
  LIMIT p_limit;

END;
$function$;

REVOKE ALL ON FUNCTION public.get_just_for_you(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text, p_limit integer, p_include_suggestions boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_just_for_you(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text, p_limit integer, p_include_suggestions boolean) TO authenticated;

CREATE OR REPLACE FUNCTION get_match_analytics(
  p_start_date date,
  p_end_date date,
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  date date,
  matches_created bigint,
  matches_completed bigint,
  completion_rate numeric,
  avg_participants numeric,
  cancellation_rate numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH daily_matches AS (
    SELECT 
      m.created_at::date AS match_date,
      COUNT(*) AS total_matches,
      COUNT(*) FILTER (WHERE m.closed_at IS NOT NULL AND m.cancelled_at IS NULL) AS completed_matches,
      COUNT(*) FILTER (WHERE m.cancelled_at IS NOT NULL) AS cancelled_matches
    FROM match m
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
      AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    GROUP BY m.created_at::date
  ),
  daily_participants AS (
    SELECT 
      m.created_at::date AS match_date,
      AVG(mp.participant_count) AS avg_participants
    FROM match m
    LEFT JOIN (
      SELECT match_id, COUNT(*) AS participant_count 
      FROM match_participant 
      GROUP BY match_id
    ) mp ON mp.match_id = m.id
    WHERE m.created_at::date BETWEEN p_start_date AND p_end_date
      AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    GROUP BY m.created_at::date
  )
  SELECT 
    dm.match_date AS date,
    dm.total_matches AS matches_created,
    dm.completed_matches AS matches_completed,
    CASE 
      WHEN dm.total_matches > 0 
      THEN ROUND((dm.completed_matches::numeric / dm.total_matches::numeric) * 100, 2)
      ELSE 0
    END AS completion_rate,
    ROUND(COALESCE(dp.avg_participants, 0), 1) AS avg_participants,
    CASE 
      WHEN dm.total_matches > 0 
      THEN ROUND((dm.cancelled_matches::numeric / dm.total_matches::numeric) * 100, 2)
      ELSE 0
    END AS cancellation_rate
  FROM daily_matches dm
  LEFT JOIN daily_participants dp ON dp.match_date = dm.match_date
  ORDER BY dm.match_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_analytics(p_start_date date, p_end_date date, p_sport_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_analytics(p_start_date date, p_end_date date, p_sport_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_match_suggestions_scored(p_player_id uuid, p_sport_id uuid, p_limit integer DEFAULT 50, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS TABLE(opponent_id uuid, opponent_first_name text, opponent_last_name text, opponent_avatar text, opponent_reputation_score numeric, opponent_reputation_tier reputation_tier, opponent_rating_value double precision, opponent_rating_label text, opponent_badge_status badge_status_enum, facility_id uuid, facility_name text, facility_address text, facility_city text, facility_data_provider_id uuid, facility_provider_type text, facility_external_id text, facility_booking_url_tpl text, facility_timezone text, overlapping_days_periods jsonb, match_type match_type_enum, match_duration match_duration_enum, player_compatibility numeric, facility_affinity numeric, matchup_score numeric, score_history numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path = public
 SET work_mem TO '32MB'
AS $function$
DECLARE
  v_caller_location        extensions.geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS NOT NULL AND p_player_id <> auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_player_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_caller_location :=
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography;
  END IF;

  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_sport cps
    JOIN player_rating_score prs ON prs.id = cps.active_rating_score_id
    JOIN rating_score   rs   ON rs.id   = prs.rating_score_id
   WHERE cps.player_id = p_player_id
     AND cps.sport_id  = p_sport_id;

  RETURN QUERY
  WITH
  effective_rating AS (
    SELECT
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_sport eps
    JOIN player_rating_score prs ON prs.id = eps.active_rating_score_id
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE eps.sport_id = p_sport_id
  ),

  caller_avail AS (
    SELECT ca.day, ca.hour_of_day
      FROM player_availability ca
     WHERE ca.player_id = p_player_id
       AND ca.is_active  = TRUE
  ),

  -- Caller↔opponent availability overlap, computed ONCE. One pass of
  -- caller_avail ⋈ player_availability grouped by player. Replaces the
  -- per-opponent EXISTS filter (Memoized index probes) AND the per-opponent
  -- score_overlap subquery in `opponents`.
  opp_overlap AS MATERIALIZED (
    SELECT oa.player_id AS opp_id, COUNT(*)::DECIMAL AS overlap_cnt
      FROM caller_avail ca
      JOIN player_availability oa
        ON oa.day         = ca.day
       AND oa.hour_of_day = ca.hour_of_day
       AND oa.is_active   = TRUE
     GROUP BY oa.player_id
  ),

  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_player_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_player_id
  ),

  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= NOW() - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < NOW() - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

  history_fb AS (
    SELECT mf.opponent_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END * ((mf.star_rating - 3)::numeric / 2.0)
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_signed_weighted,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_weight_sum,
      COUNT(*) FILTER (WHERE mf.showed_up = FALSE) AS no_shows,
      COUNT(*) FILTER (WHERE mf.was_late = TRUE)   AS lates,
      COUNT(*) AS fb_events
    FROM match_feedback mf
    JOIN match m ON m.id = mf.match_id
    WHERE mf.reviewer_id = p_player_id
    GROUP BY mf.opponent_id
  ),

  history_pm AS (
    SELECT other.player_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) AS pair_match_weight,
      COUNT(*) AS pair_match_count
    FROM match_participant me
    JOIN match m ON m.id = me.match_id
    JOIN match_participant other
      ON other.match_id = me.match_id
     AND other.player_id <> p_player_id
     AND other.status = 'joined'
    WHERE me.player_id = p_player_id
      AND me.status = 'joined'
      AND m.cancelled_at IS NULL
      AND m.match_date < CURRENT_DATE
    GROUP BY other.player_id
  ),

  history_fav AS (
    SELECT pf.favorite_player_id AS opp_id,
      TRUE AS caller_fav,
      EXISTS (
        SELECT 1 FROM player_favorite pf2
         WHERE pf2.player_id = pf.favorite_player_id
           AND pf2.favorite_player_id = p_player_id
      ) AS mutual_fav
    FROM player_favorite pf
    WHERE pf.player_id = p_player_id
  ),

  history_net AS (
    SELECT nm2.player_id AS opp_id,
      MAX(CASE nt.name
            WHEN 'friends'      THEN 0.20::numeric
            WHEN 'player_group' THEN 0.20::numeric
            WHEN 'club'         THEN 0.12::numeric
            WHEN 'community'    THEN 0.08::numeric
            WHEN 'private'      THEN 0.06::numeric
            WHEN 'public'       THEN 0.04::numeric
            ELSE 0.0::numeric
          END) AS net_weight,
      COUNT(*) AS net_events
    FROM network_member nm1
    JOIN network n          ON n.id = nm1.network_id
    JOIN network_type nt    ON nt.id = n.network_type_id
    JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                           AND nm2.player_id <> p_player_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = p_player_id
      AND nm1.status = 'active'
    GROUP BY nm2.player_id
  ),

  history_conv AS (
    SELECT cp2.player_id AS opp_id,
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= NOW() - INTERVAL '30 days'
      ) AS recent_msgs
    FROM conversation_participant cp1
    JOIN conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id <> p_player_id
    LEFT JOIN message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_player_id
    GROUP BY cp2.player_id
  ),

  history_prep AS (
    SELECT pr.reported_player_id AS opp_id, COUNT(*) AS rep_count
    FROM player_report pr
    WHERE pr.reporter_id = p_player_id
      AND pr.status::text <> 'dismissed'
    GROUP BY pr.reported_player_id
  ),

  history_mrep AS (
    SELECT mr.reported_id AS opp_id, COUNT(*) AS mrep_count
    FROM match_report mr
    WHERE mr.reporter_id = p_player_id
    GROUP BY mr.reported_id
  ),

  history_universe AS (
    SELECT opp_id FROM history_fb
    UNION SELECT opp_id FROM history_pm
    UNION SELECT opp_id FROM history_fav
    UNION SELECT opp_id FROM history_net
    UNION SELECT opp_id FROM history_conv
    UNION SELECT opp_id FROM history_prep
    UNION SELECT opp_id FROM history_mrep
  ),

  history AS (
    SELECT
      u.opp_id,
      CASE
        WHEN (
          COALESCE(pm.pair_match_count, 0)
          + COALESCE(fb.fb_events, 0)
          + (CASE WHEN fav.caller_fav THEN 1 ELSE 0 END)
          + COALESCE(net.net_events, 0)
          + COALESCE(conv.convo_count, 0)
          + COALESCE(prep.rep_count, 0)
          + COALESCE(mrep.mrep_count, 0)
        ) < 2 THEN 0::numeric
        ELSE GREATEST(-0.5::numeric, LEAST(0.5::numeric,
            LEAST(0.40::numeric, COALESCE(pm.pair_match_weight, 0) * 0.10)
          + CASE
              WHEN fb.star_weight_sum IS NOT NULL AND fb.star_weight_sum > 0
              THEN GREATEST(-0.30::numeric, LEAST(0.30::numeric,
                     (fb.star_signed_weighted / fb.star_weight_sum) * 0.30))
              ELSE 0::numeric
            END
          + CASE WHEN fav.caller_fav THEN 0.15::numeric ELSE 0::numeric END
          + CASE WHEN fav.mutual_fav THEN 0.10::numeric ELSE 0::numeric END
          + LEAST(0.20::numeric, COALESCE(net.net_weight, 0))
          + LEAST(0.10::numeric,
              (CASE WHEN COALESCE(conv.convo_count, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            + (CASE WHEN COALESCE(conv.recent_msgs, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            )
          - LEAST(0.30::numeric, COALESCE(prep.rep_count, 0) * 0.20)
          - LEAST(0.20::numeric, COALESCE(mrep.mrep_count, 0) * 0.10)
          - LEAST(0.40::numeric, COALESCE(fb.no_shows, 0) * 0.25)
          - LEAST(0.10::numeric, COALESCE(fb.lates, 0) * 0.05)
        ))
      END::numeric(6,4) AS score_history
    FROM history_universe u
    LEFT JOIN history_pm   pm   ON pm.opp_id   = u.opp_id
    LEFT JOIN history_fb   fb   ON fb.opp_id   = u.opp_id
    LEFT JOIN history_fav  fav  ON fav.opp_id  = u.opp_id
    LEFT JOIN history_net  net  ON net.opp_id  = u.opp_id
    LEFT JOIN history_conv conv ON conv.opp_id = u.opp_id
    LEFT JOIN history_prep prep ON prep.opp_id = u.opp_id
    LEFT JOIN history_mrep mrep ON mrep.opp_id = u.opp_id
  ),

  opponents AS (
    SELECT
      ps.player_id                  AS opp_id,
      COALESCE(pr.first_name, '')   AS opp_first_name,
      COALESCE(pr.last_name, '')    AS opp_last_name,
      pr.profile_picture_url        AS opp_avatar,
      opp.location                  AS opp_location,
      opp.max_travel_distance       AS opp_max_distance,
      ps.preferred_match_type       AS opp_match_type,
      ps.preferred_match_duration   AS opp_match_duration,
      COALESCE(prep.reputation_score, 0)        AS opp_rep_score,
      COALESCE(prep.reputation_tier, 'unknown') AS opp_rep_tier,
      COALESCE(prep.total_events, 0)            AS opp_rep_events,
      COALESCE(prep.is_public, FALSE)           AS opp_rep_public,
      er.rating_value                           AS opp_rating_value,
      er.rating_label                           AS opp_rating_label,
      er.badge_status                           AS opp_badge_status,

      CASE
        WHEN v_caller_match_type = ps.preferred_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR ps.preferred_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,

      CASE
        WHEN v_caller_rating_value IS NULL OR er.rating_value IS NULL THEN 0.5
        WHEN ABS(v_caller_rating_value - er.rating_value) = 0    THEN 1.0
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 0.5 THEN 0.7
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      *
      CASE
        WHEN v_caller_badge_status IS NULL THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.5
            WHEN 'self_declared' THEN 0.5
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 1.0
            WHEN 'self_declared' THEN 0.6
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.6
            WHEN 'self_declared' THEN 0.4
            WHEN 'disputed'      THEN 0.2
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.3
            WHEN 'self_declared' THEN 0.2
            WHEN 'disputed'      THEN 0.1
            ELSE 0.3
          END
        ELSE 0.5
      END AS score_skill,

      CASE
        WHEN v_caller_match_duration IS NULL OR ps.preferred_match_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = ps.preferred_match_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '60')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND ps.preferred_match_duration = '90')
          OR (v_caller_match_duration = '90'  AND ps.preferred_match_duration = '30')
          OR (v_caller_match_duration = '60'  AND ps.preferred_match_duration = '120')
          OR (v_caller_match_duration = '120' AND ps.preferred_match_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,

      -- Hourly re-tune: saturate at 12 overlapping (day, hour) cells. Read
      -- from the precomputed opp_overlap CTE instead of a per-row subquery.
      LEAST(ov.overlap_cnt / 12.0, 1.0) AS score_overlap,

      CASE
        WHEN COALESCE(prep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(prep.reputation_score, 50.0) / 100.0
      END AS score_reputation,

      COALESCE(
        CASE
          WHEN r.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (r.responded::NUMERIC / NULLIF(r.received, 0))
            + 0.3 * (CASE
                       WHEN r.responded > 0
                       THEN r.accepted::NUMERIC / r.responded
                       ELSE 0.5
                     END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,

      public.player_activity_score(ps.player_id)::DECIMAL(6,4) AS score_activity,

      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS opp_score_history

    FROM player_sport ps
    JOIN player opp     ON opp.id = ps.player_id
    JOIN profile pr     ON pr.id  = ps.player_id
    -- Inner join enforces the availability-overlap requirement (presence in
    -- opp_overlap ⟺ overlap_cnt >= 1), replacing the old EXISTS filter.
    JOIN opp_overlap ov ON ov.opp_id = ps.player_id
    LEFT JOIN player_reputation prep ON prep.player_id = ps.player_id
    LEFT JOIN effective_rating er    ON er.player_id   = ps.player_id
    LEFT JOIN responsiveness r       ON r.player_id    = ps.player_id
    LEFT JOIN history h              ON h.opp_id       = ps.player_id
   WHERE ps.sport_id    = p_sport_id
     AND ps.player_id  != p_player_id
     AND opp.location   IS NOT NULL
     AND ps.player_id NOT IN (SELECT pid FROM blocked_ids)
     AND (
       v_caller_rating_value IS NULL
       OR er.rating_value IS NULL
       OR ABS(er.rating_value - v_caller_rating_value) <= 0.5
     )
   ORDER BY extensions.ST_Distance(opp.location, v_caller_location)
   LIMIT 500
  ),

  -- The caller's favorited facilities for this sport — the only facilities
  -- `matchups` can emit (it inner-joins caller-favorited cpff). Used to scope
  -- the bookability snapshot scan to a single grouped pass.
  caller_fac AS MATERIALIZED (
    SELECT cpff.facility_id AS fac_id
    FROM player_favorite_facility cpff
    WHERE cpff.player_id = p_player_id
      AND cpff.sport_id  = p_sport_id
  ),

  facility_bookable AS MATERIALIZED (
    SELECT fas.facility_id AS fac_id, COUNT(*)::numeric AS avail_cnt
    FROM public.facility_availability_snapshot fas
    WHERE fas.facility_id IN (SELECT fac_id FROM caller_fac)
      AND fas.is_available = TRUE
      AND fas.slot_start BETWEEN now() AND now() + interval '3 days'
    GROUP BY fas.facility_id
  ),

  facility_refreshed AS MATERIALIZED (
    SELECT DISTINCT frl.facility_id AS fac_id
    FROM public.facility_refresh_log frl
    WHERE frl.facility_id IN (SELECT fac_id FROM caller_fac)
  ),

  matchups AS (
    SELECT
      o.*,
      f.id              AS fac_id,
      f.name::TEXT      AS fac_name,
      COALESCE(f.address, '')::TEXT   AS fac_address,
      COALESCE(f.city, '')::TEXT      AS fac_city,
      f.external_provider_id    AS fac_external_id,
      f.timezone                AS fac_timezone,
      COALESCE(f.data_provider_id, org.data_provider_id) AS fac_dp_id,
      COALESCE(fp.provider_type, op_dp.provider_type)    AS fac_dp_type,
      COALESCE(fp.booking_url_template, op_dp.booking_url_template) AS fac_booking_tpl,

      extensions.ST_Distance(f.location, v_caller_location) AS dist_caller,
      extensions.ST_Distance(f.location, o.opp_location)    AS dist_opponent,

      -- Bookability from the precomputed per-facility CTEs (arithmetic
      -- unchanged vs the old per-row correlated subquery).
      CASE
        WHEN COALESCE(f.data_provider_id, org.data_provider_id) IS NULL THEN 0.5
        WHEN fr.fac_id IS NULL THEN 0.5
        ELSE LEAST(1.0, COALESCE(fb.avail_cnt, 0) / 30.0)
      END AS score_bookability,

      (
        -- The matchups cpff join already guarantees the caller favorited this
        -- facility for this sport, so the old EXISTS(...) is always true → 0.30.
        0.30
        +
        GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, v_caller_location) / (COALESCE(v_caller_max_distance, 25) * 1000)))
        +
        GREATEST(0, 0.25 * (1.0 - extensions.ST_Distance(f.location, o.opp_location) / (COALESCE(o.opp_max_distance, 25) * 1000)))
      ) AS score_facility_geo

    FROM opponents o
    JOIN player_favorite_facility pff
      ON pff.player_id  = o.opp_id
     AND pff.sport_id   = p_sport_id
    -- Require the caller to ALSO have favorited this facility for this sport.
    JOIN player_favorite_facility cpff
      ON cpff.player_id   = p_player_id
     AND cpff.sport_id    = p_sport_id
     AND cpff.facility_id = pff.facility_id
    JOIN facility f ON f.id = pff.facility_id
    LEFT JOIN organization org ON org.id = f.organization_id
    LEFT JOIN data_provider fp ON fp.id = f.data_provider_id AND fp.is_active = TRUE
    LEFT JOIN data_provider op_dp ON op_dp.id = org.data_provider_id AND op_dp.is_active = TRUE
    LEFT JOIN facility_bookable fb ON fb.fac_id = f.id
    LEFT JOIN facility_refreshed fr ON fr.fac_id = f.id
   WHERE f.location IS NOT NULL
     AND extensions.ST_DWithin(f.location, v_caller_location, COALESCE(v_caller_max_distance, 25) * 1000)
     AND extensions.ST_DWithin(f.location, o.opp_location, COALESCE(o.opp_max_distance, 25) * 1000)
  ),

  ranked AS MATERIALIZED (
    SELECT
      m.*,
      LEAST(1.0, GREATEST(0.0,
        ( 0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
        + 0.5 * m.opp_score_history
        - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))::DECIMAL(6,4) AS player_compat,
      LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)::DECIMAL(6,4) AS fac_affinity,
      (
        0.70 * LEAST(1.0, GREATEST(0.0,
          ( 0.18 * m.score_match_type
          + 0.18 * m.score_skill
          + 0.05 * m.score_duration
          + 0.22 * m.score_overlap
          + 0.10 * m.score_reputation
          + 0.17 * m.score_responsiveness
          + 0.10 * m.score_activity
          )
          + 0.5 * m.opp_score_history
          - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
        ))
      + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
      )::DECIMAL(8,4) AS total_score
    FROM matchups m
    ORDER BY (
      0.70 * LEAST(1.0, GREATEST(0.0,
        ( 0.18 * m.score_match_type
        + 0.18 * m.score_skill
        + 0.05 * m.score_duration
        + 0.22 * m.score_overlap
        + 0.10 * m.score_reputation
        + 0.17 * m.score_responsiveness
        + 0.10 * m.score_activity
        )
        + 0.5 * m.opp_score_history
        - (CASE WHEN m.opp_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))
    + 0.30 * LEAST(m.score_facility_geo + 0.20 * m.score_bookability, 1.0)
    ) DESC
    LIMIT p_limit
  )

  SELECT
    r.opp_id, r.opp_first_name, r.opp_last_name, r.opp_avatar,
    CASE WHEN r.opp_rep_public THEN r.opp_rep_score ELSE NULL END,
    CASE WHEN r.opp_rep_events < 5 THEN 'unknown'::reputation_tier ELSE r.opp_rep_tier END,
    r.opp_rating_value, r.opp_rating_label, r.opp_badge_status,
    r.fac_id, r.fac_name, r.fac_address, r.fac_city,
    r.fac_dp_id, r.fac_dp_type, r.fac_external_id, r.fac_booking_tpl, r.fac_timezone,
    (
      -- Hourly overlap JSON: {day, hour} pairs for the caller×opponent
      -- intersection. Output column name unchanged for diffability; the TS
      -- layer renames downstream.
      SELECT COALESCE(json_agg(json_build_object('day', ca3.day, 'hour', ca3.hour_of_day)), '[]'::json)
        FROM caller_avail ca3
        JOIN player_availability oa2
          ON oa2.day         = ca3.day
         AND oa2.hour_of_day = ca3.hour_of_day
         AND oa2.player_id   = r.opp_id
         AND oa2.is_active   = TRUE
    )::JSONB AS overlap_json,
    r.opp_match_type, r.opp_match_duration,
    r.player_compat, r.fac_affinity, r.total_score,
    r.opp_score_history
  FROM ranked r
  ORDER BY r.total_score DESC;

END;
$function$;

REVOKE ALL ON FUNCTION public.get_match_suggestions_scored(p_player_id uuid, p_sport_id uuid, p_limit integer, p_lat double precision, p_lng double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_suggestions_scored(p_player_id uuid, p_sport_id uuid, p_limit integer, p_lat double precision, p_lng double precision) TO authenticated;

create or replace function public.get_my_contest_rank(
  p_contest_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
SET search_path = public
stable
as $$
declare
  v_rank          bigint;
  v_count         bigint;
  v_total         bigint;
begin
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  with ranked as (
    select
      referrer.id                                          as referrer_id,
      count(referred.id)                                   as referral_count,
      row_number() over (order by count(referred.id) desc) as rank
    from public.profile referrer
    join public.profile referred on referred.referred_by = referrer.id
    join public.referral_contest rc on rc.id = p_contest_id
    where referred.created_at between rc.start_at and rc.end_at
    group by referrer.id
  )
  select
    coalesce((select rank          from ranked where referrer_id = p_player_id), 0),
    coalesce((select referral_count from ranked where referrer_id = p_player_id), 0),
    count(*)
  into v_rank, v_count, v_total
  from ranked;

  return jsonb_build_object(
    'rank',               v_rank,
    'referral_count',     v_count,
    'total_participants', v_total
  );
end;
$$;

REVOKE ALL ON FUNCTION public.get_my_contest_rank(p_contest_id uuid, p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_contest_rank(p_contest_id uuid, p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_or_create_group_invite_code(group_id UUID)
RETURNS VARCHAR(12) AS $$
DECLARE
  existing_code VARCHAR(12);
  new_code VARCHAR(12);
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_network_member(group_id, auth.uid()) THEN
    RAISE EXCEPTION 'members only' USING ERRCODE = '42501';
  END IF;
  -- Check for existing code
  SELECT invite_code INTO existing_code 
  FROM public.network 
  WHERE id = group_id;
  
  -- Return existing code if present
  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;
  
  -- Generate new code
  new_code := generate_unique_invite_code();
  
  -- Update network with new code
  UPDATE public.network 
  SET invite_code = new_code 
  WHERE id = group_id;
  
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_or_create_group_invite_code(group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_group_invite_code(group_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_or_create_player_referral_code(p_player_id UUID)
RETURNS VARCHAR(12) AS $$
DECLARE
  existing_code VARCHAR(12);
  new_code VARCHAR(12);
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Check for existing code
  SELECT referral_code INTO existing_code
  FROM public.profile
  WHERE id = p_player_id;

  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;

  -- Generate new code
  new_code := generate_unique_referral_code();

  -- Update profile with new code
  UPDATE public.profile
  SET referral_code = new_code
  WHERE id = p_player_id;

  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_or_create_player_referral_code(p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_player_referral_code(p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_pending_score_confirmations(p_player_id UUID)
RETURNS TABLE (
  match_result_id UUID,
  match_id UUID,
  match_date DATE,
  sport_name TEXT,
  sport_icon_url TEXT,
  winning_team INTEGER,
  team1_score INTEGER,
  team2_score INTEGER,
  submitted_by_id UUID,
  submitted_by_name TEXT,
  submitted_by_avatar TEXT,
  confirmation_deadline TIMESTAMPTZ,
  opponent_name TEXT,
  opponent_avatar TEXT,
  player_team INTEGER,
  network_id UUID,
  network_name TEXT
) AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM (
    SELECT DISTINCT ON (mr.id)
      mr.id as match_result_id,
      m.id as match_id,
      m.match_date as match_date,
      s.name::TEXT as sport_name,
      s.icon_url::TEXT as sport_icon_url,
      mr.winning_team,
      mr.team1_score,
      mr.team2_score,
      mr.submitted_by as submitted_by_id,
      COALESCE(sub_profile.display_name, sub_profile.first_name || ' ' || COALESCE(sub_profile.last_name, ''))::TEXT as submitted_by_name,
      sub_profile.profile_picture_url::TEXT as submitted_by_avatar,
      mr.confirmation_deadline,
      COALESCE(opp_profile.display_name, opp_profile.first_name || ' ' || COALESCE(opp_profile.last_name, ''))::TEXT as opponent_name,
      opp_profile.profile_picture_url::TEXT as opponent_avatar,
      my_part.team_number as player_team,
      mn.network_id,
      n.name::TEXT as network_name
    FROM match_result mr
    JOIN match m ON m.id = mr.match_id
    JOIN sport s ON s.id = m.sport_id
    JOIN match_participant my_part ON my_part.match_id = m.id AND my_part.player_id = p_player_id
    -- Get submitter's team number to filter opponents only
    JOIN match_participant sub_part ON sub_part.match_id = m.id AND sub_part.player_id = mr.submitted_by
    LEFT JOIN player sub_player ON sub_player.id = mr.submitted_by
    LEFT JOIN profile sub_profile ON sub_profile.id = sub_player.id
    LEFT JOIN match_participant opp_part ON opp_part.match_id = m.id
      AND opp_part.player_id != p_player_id
      AND opp_part.player_id != mr.submitted_by
    LEFT JOIN player opp_player ON opp_player.id = opp_part.player_id
    LEFT JOIN profile opp_profile ON opp_profile.id = opp_player.id
    LEFT JOIN match_network mn ON mn.match_id = m.id
    LEFT JOIN network n ON n.id = mn.network_id
    WHERE
      mr.is_verified = FALSE
      AND mr.disputed = FALSE
      AND mr.submitted_by != p_player_id
      AND mr.rebuttal_submitted_by IS NULL
      AND mr.confirmation_deadline > NOW()
      -- Only show to opponents (different team than submitter)
      AND my_part.team_number != sub_part.team_number
      -- Exclude scores this player has already individually responded to
      AND NOT EXISTS (
        SELECT 1 FROM score_confirmation sc
        WHERE sc.match_result_id = mr.id AND sc.player_id = p_player_id
      )
    ORDER BY mr.id, mr.confirmation_deadline ASC
  ) sub
  ORDER BY confirmation_deadline ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_pending_score_confirmations(p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_score_confirmations(p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_player_matches(
  p_player_id UUID,
  p_time_filter TEXT DEFAULT 'upcoming', -- 'upcoming' or 'past'
  p_sport_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_status_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  match_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_time_utc TIMESTAMPTZ := NOW();
  forty_eight_hours_ago TIMESTAMPTZ := NOW() - INTERVAL '48 hours';
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id AS match_id
  FROM match m
  LEFT JOIN match_participant mp ON mp.match_id = m.id AND mp.player_id = p_player_id
  WHERE
    (
      m.created_by = p_player_id
      OR mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
    )
    AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
    AND (
      CASE
        WHEN p_status_filter = 'cancelled' THEN m.cancelled_at IS NOT NULL
        ELSE m.cancelled_at IS NULL
      END
    )
    AND (
      CASE p_status_filter
        WHEN 'all' THEN TRUE
        WHEN 'hosting' THEN
          m.created_by = p_player_id
        WHEN 'confirmed' THEN
          mp.status = 'joined'
        WHEN 'waiting' THEN
          mp.status IN ('pending', 'requested', 'waitlisted')
        WHEN 'pending' THEN
          mp.status = 'pending'
        WHEN 'requested' THEN
          mp.status = 'requested'
        WHEN 'waitlisted' THEN
          mp.status = 'waitlisted'
        WHEN 'needs_players' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'feedback_needed' THEN
          mp.status = 'joined'
          AND mp.feedback_completed = false
          AND (SELECT COUNT(*) FROM match_participant mp2
               WHERE mp2.match_id = m.id AND mp2.status = 'joined')
              >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          AND (
            CASE
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= forty_eight_hours_ago
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= forty_eight_hours_ago
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (forty_eight_hours_ago AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp >= (forty_eight_hours_ago AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
        WHEN 'completed' THEN
          EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
        WHEN 'played' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'hosted' THEN
          m.created_by = p_player_id
        WHEN 'unfilled' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'expired' THEN
          (SELECT COUNT(*) FROM match_participant mp2
           WHERE mp2.match_id = m.id AND mp2.status = 'joined')
          < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
        WHEN 'cancelled' THEN
          TRUE
        WHEN 'private' THEN
          m.visibility = 'private'
        ELSE TRUE
      END
    )
    AND (
      CASE
        WHEN p_time_filter = 'upcoming' THEN
          NOT EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
          AND (
            CASE
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) >= current_time_utc
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) >= current_time_utc
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
          AND (
            -- Still scheduled (start_time in future)
            (CASE
              WHEN m.timezone IS NOT NULL THEN
                timezone(m.timezone, (m.match_date + m.start_time)::timestamp) >= current_time_utc
              ELSE
                (m.match_date + m.start_time)::timestamp >= (current_time_utc AT TIME ZONE 'UTC')::timestamp
            END)
            OR
            -- Ongoing (start_time passed, match is full): show to confirmed participants and creators
            -- Expired matches (not full) are excluded from upcoming entirely
            (
              (mp.status = 'joined' OR m.created_by = p_player_id)
              AND (SELECT COUNT(*) FROM match_participant mp2
                   WHERE mp2.match_id = m.id AND mp2.status = 'joined')
                  >= CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
            )
          )
        WHEN p_time_filter = 'past' THEN
          (m.created_by = p_player_id OR mp.status = 'joined')
          AND (
          EXISTS (SELECT 1 FROM match_result mr WHERE mr.match_id = m.id)
          OR (
            -- Match end_time has passed (normal past match)
            CASE
              WHEN m.timezone IS NOT NULL THEN
                CASE
                  WHEN m.end_time < m.start_time THEN
                    timezone(m.timezone, ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp) < current_time_utc
                  ELSE
                    timezone(m.timezone, (m.match_date + m.end_time)::timestamp) < current_time_utc
                END
              ELSE
                CASE
                  WHEN m.end_time < m.start_time THEN
                    ((m.match_date + INTERVAL '1 day') + m.end_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
                  ELSE
                    (m.match_date + m.end_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
                END
            END
          )
          OR (
            -- Expired match: start_time has passed but match was not full
            (CASE
              WHEN m.timezone IS NOT NULL THEN
                timezone(m.timezone, (m.match_date + m.start_time)::timestamp) < current_time_utc
              ELSE
                (m.match_date + m.start_time)::timestamp < (current_time_utc AT TIME ZONE 'UTC')::timestamp
            END)
            AND (SELECT COUNT(*) FROM match_participant mp2
                 WHERE mp2.match_id = m.id AND mp2.status = 'joined')
                < CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END
          )
          )
        ELSE
          FALSE
      END
    )
  ORDER BY
    CASE WHEN p_time_filter = 'upcoming' THEN (m.match_date + m.start_time)::timestamp END ASC,
    CASE WHEN p_time_filter = 'past' THEN (m.match_date + m.start_time)::timestamp END DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_matches(p_player_id uuid, p_time_filter text, p_sport_id uuid, p_limit integer, p_offset integer, p_status_filter text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_matches(p_player_id uuid, p_time_filter text, p_sport_id uuid, p_limit integer, p_offset integer, p_status_filter text) TO authenticated;

CREATE OR REPLACE FUNCTION get_player_referral_stats(p_player_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_referral_code VARCHAR(12);
  v_total_clicked INT;
  v_total_converted INT;
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Get the player's referral code
  SELECT referral_code INTO v_referral_code
  FROM public.profile
  WHERE id = p_player_id;

  -- Count unique clicks on their referral link
  SELECT COUNT(*) INTO v_total_clicked
  FROM public.referral_link_click
  WHERE referral_code = v_referral_code;

  -- Count players who signed up via this referral
  SELECT COUNT(*) INTO v_total_converted
  FROM public.profile
  WHERE referred_by = p_player_id;

  RETURN jsonb_build_object(
    'total_clicked', COALESCE(v_total_clicked, 0),
    'total_converted', COALESCE(v_total_converted, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_player_referral_stats(p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_referral_stats(p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_player_reports(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_status report_status_enum DEFAULT NULL,
  p_report_type report_type_enum DEFAULT NULL,
  p_priority TEXT DEFAULT NULL,
  p_reported_player_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  reporter_id UUID,
  reporter_name TEXT,
  reporter_avatar TEXT,
  reported_player_id UUID,
  reported_player_name TEXT,
  reported_player_avatar TEXT,
  report_type report_type_enum,
  description TEXT,
  evidence_urls TEXT[],
  related_match_id UUID,
  status report_status_enum,
  priority TEXT,
  reviewed_by UUID,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  action_taken TEXT,
  admin_notes TEXT,
  resulting_ban_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    pr.id,
    pr.reporter_id,
    COALESCE(rp.first_name || ' ' || rp.last_name, rp.display_name, 'Unknown') AS reporter_name,
    rp.profile_picture_url AS reporter_avatar,
    pr.reported_player_id,
    COALESCE(rep.first_name || ' ' || rep.last_name, rep.display_name, 'Unknown') AS reported_player_name,
    rep.profile_picture_url AS reported_player_avatar,
    pr.report_type,
    pr.description,
    pr.evidence_urls,
    pr.related_match_id,
    pr.status,
    pr.priority,
    pr.reviewed_by,
    COALESCE(ap.first_name || ' ' || ap.last_name, ap.display_name, 'System') AS reviewer_name,
    pr.reviewed_at,
    pr.action_taken,
    pr.admin_notes,
    pr.resulting_ban_id,
    pr.created_at,
    pr.updated_at
  FROM public.player_report pr
  LEFT JOIN public.profile rp ON pr.reporter_id = rp.id
  LEFT JOIN public.profile rep ON pr.reported_player_id = rep.id
  LEFT JOIN public.profile ap ON pr.reviewed_by = ap.id
  WHERE
    (p_status IS NULL OR pr.status = p_status)
    AND (p_report_type IS NULL OR pr.report_type = p_report_type)
    AND (p_priority IS NULL OR pr.priority = p_priority)
    AND (p_reported_player_id IS NULL OR pr.reported_player_id = p_reported_player_id)
  ORDER BY
    CASE pr.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END,
    pr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_reports(p_limit integer, p_offset integer, p_status report_status_enum, p_report_type report_type_enum, p_priority text, p_reported_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_reports(p_limit integer, p_offset integer, p_status report_status_enum, p_report_type report_type_enum, p_priority text, p_reported_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_rating_distribution(
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  rating_label text,
  player_count bigint,
  certified_count bigint,
  percentage numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_players bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(DISTINCT prs.player_id) INTO total_players
  FROM player_rating_score prs
  JOIN rating_score rs ON rs.id = prs.rating_score_id
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  WHERE p_sport_id IS NULL OR rsys.sport_id = p_sport_id;
  
  RETURN QUERY
  SELECT 
    rs.label::text AS rating_label,
    COUNT(DISTINCT prs.player_id)::bigint AS player_count,
    COUNT(DISTINCT prs.player_id) FILTER (WHERE prs.is_certified)::bigint AS certified_count,
    CASE WHEN total_players > 0 
      THEN ROUND((COUNT(DISTINCT prs.player_id)::numeric / total_players::numeric) * 100, 2)
      ELSE 0 
    END AS percentage
  FROM rating_score rs
  JOIN rating_system rsys ON rsys.id = rs.rating_system_id
  LEFT JOIN player_rating_score prs ON prs.rating_score_id = rs.id
  WHERE (p_sport_id IS NULL OR rsys.sport_id = p_sport_id)
    AND rsys.is_active = true
  GROUP BY rs.label, rs.value
  ORDER BY rs.value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_rating_distribution(p_sport_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rating_distribution(p_sport_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_sport_facility_data(
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  sport_id uuid,
  sport_name text,
  facility_count bigint,
  court_count bigint,
  cities_count bigint,
  avg_utilization numeric,
  peak_hours text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH facility_stats AS (
    SELECT 
      s.id,
      s.name::text AS s_name,
      COUNT(DISTINCT fs.facility_id) AS f_count,
      COUNT(DISTINCT cs.court_id) AS c_count,
      COUNT(DISTINCT f.city) AS city_count,
      -- Calculate utilization based on bookings for this sport's courts
      COALESCE(
        ROUND(
          (COUNT(DISTINCT b.id) FILTER (WHERE b.booking_date > CURRENT_DATE - 30))::numeric / 
          NULLIF(COUNT(DISTINCT cs.court_id) * 30, 0) * 100,
          1
        ),
        0
      ) AS utilization
    FROM sport s
    LEFT JOIN facility_sport fs ON fs.sport_id = s.id
    LEFT JOIN facility f ON f.id = fs.facility_id AND f.is_active = true
    LEFT JOIN court_sport cs ON cs.sport_id = s.id
    LEFT JOIN court c ON c.id = cs.court_id AND c.is_active = true
    LEFT JOIN booking b ON b.court_id = c.id AND b.status = 'confirmed'
    WHERE s.is_active = true
      AND (p_sport_id IS NULL OR s.id = p_sport_id)
    GROUP BY s.id, s.name
  ),
  peak_hours_calc AS (
    SELECT 
      s.id,
      COALESCE(
        (
          SELECT EXTRACT(HOUR FROM b2.start_time)::text || ':00-' || 
                 (EXTRACT(HOUR FROM b2.start_time) + 1)::text || ':00'
          FROM booking b2
          JOIN court c2 ON c2.id = b2.court_id
          JOIN court_sport cs2 ON cs2.court_id = c2.id AND cs2.sport_id = s.id
          WHERE b2.booking_date > CURRENT_DATE - 30
          GROUP BY b2.start_time
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ),
        '17:00-18:00'
      ) AS peak
    FROM sport s
    WHERE s.is_active = true
      AND (p_sport_id IS NULL OR s.id = p_sport_id)
  )
  SELECT 
    fs.id AS sport_id,
    fs.s_name AS sport_name,
    fs.f_count AS facility_count,
    fs.c_count AS court_count,
    fs.city_count AS cities_count,
    fs.utilization AS avg_utilization,
    COALESCE(ph.peak, '17:00-18:00')::text AS peak_hours
  FROM facility_stats fs
  LEFT JOIN peak_hours_calc ph ON ph.id = fs.id
  ORDER BY fs.f_count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sport_facility_data(p_sport_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sport_facility_data(p_sport_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_sport_growth_trends(
  p_start_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_end_date date DEFAULT CURRENT_DATE,
  p_sport_id uuid DEFAULT NULL
) RETURNS TABLE (
  trend_date date,
  sport_id uuid,
  sport_name text,
  new_players bigint,
  new_matches bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH date_series AS (
    SELECT d::date AS series_date
    FROM generate_series(p_start_date::timestamp, p_end_date::timestamp, '1 day'::interval) AS d
  ),
  daily_data AS (
    SELECT 
      ds.series_date,
      s.id AS s_id,
      s.name::text AS s_name,
      COUNT(DISTINCT ps.id) FILTER (WHERE ps.created_at::date = ds.series_date) AS daily_players,
      COUNT(DISTINCT m.id) FILTER (WHERE m.created_at::date = ds.series_date) AS daily_matches
    FROM date_series ds
    CROSS JOIN sport s
    LEFT JOIN player_sport ps ON ps.sport_id = s.id 
      AND ps.created_at::date BETWEEN p_start_date AND p_end_date
    LEFT JOIN match m ON m.sport_id = s.id 
      AND m.created_at::date BETWEEN p_start_date AND p_end_date
    WHERE s.is_active = true
      AND (p_sport_id IS NULL OR s.id = p_sport_id)
    GROUP BY ds.series_date, s.id, s.name
  )
  SELECT 
    dd.series_date AS trend_date,
    dd.s_id AS sport_id,
    dd.s_name AS sport_name,
    COALESCE(dd.daily_players, 0)::bigint AS new_players,
    COALESCE(dd.daily_matches, 0)::bigint AS new_matches
  FROM daily_data dd
  ORDER BY dd.series_date, dd.s_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sport_growth_trends(p_start_date date, p_end_date date, p_sport_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sport_growth_trends(p_start_date date, p_end_date date, p_sport_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_upcoming_matches_scored(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(match_id uuid, distance_meters double precision, player_compatibility numeric, facility_affinity numeric, score_history numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path = public
 SET work_mem TO '32MB'
AS $function$
DECLARE
  v_caller_location        extensions.geography;
  v_caller_max_distance    INT;
  v_caller_match_type      match_type_enum;
  v_caller_match_duration  match_duration_enum;
  v_caller_rating_value    NUMERIC;
  v_caller_badge_status    badge_status_enum;
  v_now                    TIMESTAMPTZ := NOW();
BEGIN
  IF auth.uid() IS NOT NULL AND p_caller_id IS NOT NULL AND p_caller_id <> auth.uid() THEN
    RAISE EXCEPTION 'p_caller_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Caller location + travel cap + sport preferences
  SELECT p.location, p.max_travel_distance,
         ps.preferred_match_type, ps.preferred_match_duration
    INTO v_caller_location, v_caller_max_distance,
         v_caller_match_type, v_caller_match_duration
    FROM player p
    JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = p_sport_id
   WHERE p.id = p_caller_id;

  -- Location override from RPC params (e.g. user querying a different area
  -- than their stored home, or GPS-derived position)
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_caller_location :=
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;
  END IF;

  IF v_caller_location IS NULL OR v_caller_match_type IS NULL THEN
    RETURN;
  END IF;

  -- Caller rating + badge: pick the best record using the same precedence as
  -- get_match_suggestions_scored (certified-or-equivalent > self-declared >
  -- disputed; most-recently-assigned breaks ties).
  SELECT rs.value, prs.badge_status
    INTO v_caller_rating_value, v_caller_badge_status
    FROM player_sport cps
    JOIN player_rating_score prs ON prs.id = cps.active_rating_score_id
    JOIN rating_score   rs   ON rs.id   = prs.rating_score_id
   WHERE cps.player_id = p_caller_id
     AND cps.sport_id  = p_sport_id;

  RETURN QUERY
  WITH
  -- ── Per-player effective rating for this sport ─────────────────────
  effective_rating AS (
    SELECT
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      prs.badge_status           AS badge_status
    FROM player_sport eps
    JOIN player_rating_score prs ON prs.id = eps.active_rating_score_id
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE eps.sport_id = p_sport_id
  ),

  -- ── Caller's hourly availability slots ─────────────────────────────
  caller_avail AS (
    SELECT ca.day, ca.hour_of_day
      FROM player_availability ca
     WHERE ca.player_id = p_caller_id
       AND ca.is_active  = TRUE
  ),

  -- ── Blocked players (either direction) ─────────────────────────────
  blocked_ids AS (
    SELECT b.blocked_player_id AS pid FROM player_block b WHERE b.player_id = p_caller_id
    UNION
    SELECT b.player_id          AS pid FROM player_block b WHERE b.blocked_player_id = p_caller_id
  ),

  -- ── Creator responsiveness (90-day window, same formula as the
  --    suggestion RPC). For matches, this signals whether the creator
  --    is likely to respond to a join request. ────────────────────────
  responsiveness AS (
    SELECT
      mp.player_id,
      COUNT(*) AS received,
      COUNT(*) FILTER (WHERE mp.status IN ('joined','declined','left','refused')) AS responded,
      COUNT(*) FILTER (WHERE mp.status = 'joined')                                  AS accepted
    FROM match_participant mp
    JOIN match m ON m.id = mp.match_id
    WHERE mp.created_at >= v_now - INTERVAL '90 days'
      AND mp.is_host = FALSE
      AND m.created_by != mp.player_id
      AND mp.status NOT IN ('cancelled', 'requested', 'waitlisted')
      AND (m.match_date < CURRENT_DATE OR mp.created_at < v_now - INTERVAL '3 days')
    GROUP BY mp.player_id
  ),

  -- ── Caller↔opponent history components (identical to suggestion RPC,
  --    keyed on opp_id which here will be the match creator) ──────────
  history_fb AS (
    SELECT mf.opponent_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END * ((mf.star_rating - 3)::numeric / 2.0)
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_signed_weighted,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) FILTER (WHERE mf.star_rating IS NOT NULL) AS star_weight_sum,
      COUNT(*) FILTER (WHERE mf.showed_up = FALSE) AS no_shows,
      COUNT(*) FILTER (WHERE mf.was_late = TRUE)   AS lates,
      COUNT(*) AS fb_events
    FROM match_feedback mf
    JOIN match m ON m.id = mf.match_id
    WHERE mf.reviewer_id = p_caller_id
    GROUP BY mf.opponent_id
  ),
  history_pm AS (
    SELECT other.player_id AS opp_id,
      SUM(
        CASE
          WHEN m.match_date >= CURRENT_DATE - 90  THEN 1.0
          WHEN m.match_date >= CURRENT_DATE - 180 THEN 0.5
          WHEN m.match_date >= CURRENT_DATE - 365 THEN 0.25
          ELSE 0.0
        END
      ) AS pair_match_weight,
      COUNT(*) AS pair_match_count
    FROM match_participant me
    JOIN match m ON m.id = me.match_id
    JOIN match_participant other
      ON other.match_id = me.match_id
     AND other.player_id <> p_caller_id
     AND other.status = 'joined'
    WHERE me.player_id = p_caller_id
      AND me.status = 'joined'
      AND m.cancelled_at IS NULL
      AND m.match_date < CURRENT_DATE
    GROUP BY other.player_id
  ),
  history_fav AS (
    SELECT pf.favorite_player_id AS opp_id,
      TRUE AS caller_fav,
      EXISTS (
        SELECT 1 FROM player_favorite pf2
         WHERE pf2.player_id = pf.favorite_player_id
           AND pf2.favorite_player_id = p_caller_id
      ) AS mutual_fav
    FROM player_favorite pf
    WHERE pf.player_id = p_caller_id
  ),
  history_net AS (
    SELECT nm2.player_id AS opp_id,
      MAX(CASE nt.name
            WHEN 'friends'      THEN 0.20::numeric
            WHEN 'player_group' THEN 0.20::numeric
            WHEN 'club'         THEN 0.12::numeric
            WHEN 'community'    THEN 0.08::numeric
            WHEN 'private'      THEN 0.06::numeric
            WHEN 'public'       THEN 0.04::numeric
            ELSE 0.0::numeric
          END) AS net_weight,
      COUNT(*) AS net_events
    FROM network_member nm1
    JOIN network n          ON n.id = nm1.network_id
    JOIN network_type nt    ON nt.id = n.network_type_id
    JOIN network_member nm2 ON nm2.network_id = nm1.network_id
                           AND nm2.player_id <> p_caller_id
                           AND nm2.status = 'active'
    WHERE nm1.player_id = p_caller_id
      AND nm1.status = 'active'
    GROUP BY nm2.player_id
  ),
  history_conv AS (
    SELECT cp2.player_id AS opp_id,
      COUNT(DISTINCT cp1.conversation_id) AS convo_count,
      COUNT(DISTINCT msg.id) FILTER (
        WHERE msg.created_at >= v_now - INTERVAL '30 days'
      ) AS recent_msgs
    FROM conversation_participant cp1
    JOIN conversation_participant cp2
      ON cp2.conversation_id = cp1.conversation_id
     AND cp2.player_id <> p_caller_id
    LEFT JOIN message msg
      ON msg.conversation_id = cp1.conversation_id
    WHERE cp1.player_id = p_caller_id
    GROUP BY cp2.player_id
  ),
  history_prep AS (
    SELECT pr.reported_player_id AS opp_id, COUNT(*) AS rep_count
    FROM player_report pr
    WHERE pr.reporter_id = p_caller_id
      AND pr.status::text <> 'dismissed'
    GROUP BY pr.reported_player_id
  ),
  history_mrep AS (
    SELECT mr.reported_id AS opp_id, COUNT(*) AS mrep_count
    FROM match_report mr
    WHERE mr.reporter_id = p_caller_id
    GROUP BY mr.reported_id
  ),
  history_universe AS (
    SELECT opp_id FROM history_fb
    UNION SELECT opp_id FROM history_pm
    UNION SELECT opp_id FROM history_fav
    UNION SELECT opp_id FROM history_net
    UNION SELECT opp_id FROM history_conv
    UNION SELECT opp_id FROM history_prep
    UNION SELECT opp_id FROM history_mrep
  ),
  history AS (
    SELECT
      u.opp_id,
      CASE
        WHEN (
          COALESCE(pm.pair_match_count, 0)
          + COALESCE(fb.fb_events, 0)
          + (CASE WHEN fav.caller_fav THEN 1 ELSE 0 END)
          + COALESCE(net.net_events, 0)
          + COALESCE(conv.convo_count, 0)
          + COALESCE(prep.rep_count, 0)
          + COALESCE(mrep.mrep_count, 0)
        ) < 2 THEN 0::numeric
        ELSE GREATEST(-0.5::numeric, LEAST(0.5::numeric,
            LEAST(0.40::numeric, COALESCE(pm.pair_match_weight, 0) * 0.10)
          + CASE
              WHEN fb.star_weight_sum IS NOT NULL AND fb.star_weight_sum > 0
              THEN GREATEST(-0.30::numeric, LEAST(0.30::numeric,
                     (fb.star_signed_weighted / fb.star_weight_sum) * 0.30))
              ELSE 0::numeric
            END
          + CASE WHEN fav.caller_fav THEN 0.15::numeric ELSE 0::numeric END
          + CASE WHEN fav.mutual_fav THEN 0.10::numeric ELSE 0::numeric END
          + LEAST(0.20::numeric, COALESCE(net.net_weight, 0))
          + LEAST(0.10::numeric,
              (CASE WHEN COALESCE(conv.convo_count, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            + (CASE WHEN COALESCE(conv.recent_msgs, 0) > 0 THEN 0.05::numeric ELSE 0::numeric END)
            )
          - LEAST(0.30::numeric, COALESCE(prep.rep_count, 0) * 0.20)
          - LEAST(0.20::numeric, COALESCE(mrep.mrep_count, 0) * 0.10)
          - LEAST(0.40::numeric, COALESCE(fb.no_shows, 0) * 0.25)
          - LEAST(0.10::numeric, COALESCE(fb.lates, 0) * 0.05)
        ))
      END::numeric(6,4) AS score_history
    FROM history_universe u
    LEFT JOIN history_pm   pm   ON pm.opp_id   = u.opp_id
    LEFT JOIN history_fb   fb   ON fb.opp_id   = u.opp_id
    LEFT JOIN history_fav  fav  ON fav.opp_id  = u.opp_id
    LEFT JOIN history_net  net  ON net.opp_id  = u.opp_id
    LEFT JOIN history_conv conv ON conv.opp_id = u.opp_id
    LEFT JOIN history_prep prep ON prep.opp_id = u.opp_id
    LEFT JOIN history_mrep mrep ON mrep.opp_id = u.opp_id
  ),

  -- ── Candidate matches with eligibility filters + resolved location ──
  candidate_matches AS (
    SELECT
      m.id                        AS m_id,
      m.created_by                AS creator_id,
      m.facility_id               AS m_facility_id,
      m.location_type             AS m_location_type,
      m.match_date                AS m_date,
      m.start_time                AS m_start_time,
      m.end_time                  AS m_end_time,
      m.duration                  AS m_duration,
      m.player_expectation        AS m_match_type,
      -- Resolved match location point (facility or custom).
      CASE
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
        WHEN m.location_type = 'custom'
          AND m.custom_latitude IS NOT NULL
          AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        ELSE NULL
      END                          AS m_location,
      f.location                   AS facility_location,
      extensions.ST_Distance(
        CASE
          WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
          WHEN m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL THEN
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
              4326
            )::extensions.geography
          ELSE NULL
        END,
        v_caller_location
      )                            AS m_distance_meters
    FROM match m
    LEFT JOIN facility f      ON f.id      = m.facility_id
    LEFT JOIN rating_score mr ON mr.id     = m.min_rating_score_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id    = p_sport_id
      AND m.created_by <> p_caller_id
      AND NOT EXISTS (
        SELECT 1 FROM match_participant mp
         WHERE mp.match_id  = m.id
           AND mp.player_id = p_caller_id
           AND mp.status IN ('joined', 'requested', 'waitlisted')
      )
      AND (
        CASE
          WHEN m.timezone IS NOT NULL THEN
            timezone(m.timezone, (m.match_date + m.start_time)::timestamp) > v_now
          ELSE
            (m.match_date + m.start_time)::timestamp > (v_now AT TIME ZONE 'UTC')::timestamp
        END
      )
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL)
      )
      AND extensions.ST_DWithin(
        CASE
          WHEN m.location_type = 'facility' THEN f.location
          ELSE extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
            4326
          )::extensions.geography
        END,
        v_caller_location,
        p_max_distance_km * 1000
      )
      AND (
        p_user_gender IS NULL
        OR m.preferred_opponent_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
      AND m.created_by NOT IN (SELECT pid FROM blocked_ids)
      AND (
        m.min_rating_score_id IS NULL
        OR v_caller_rating_value IS NULL
        OR v_caller_rating_value >= mr.value - 0.5
      )
  ),

  -- ── Per-match scoring (creator plays the role of "opponent") ────────
  scored AS (
    SELECT
      cm.m_id,
      cm.m_distance_meters,
      cm.creator_id,
      er.badge_status AS creator_badge_status,

      -- w1: Match-type alignment (caller pref ↔ match.match_type — the
      -- type the creator chose for this match, which may differ from
      -- the creator's general preference). NULL match_type → neutral.
      CASE
        WHEN cm.m_match_type IS NULL THEN 0.5
        WHEN v_caller_match_type = cm.m_match_type THEN 1.0
        WHEN v_caller_match_type = 'both' OR cm.m_match_type = 'both' THEN 0.7
        ELSE 0.0
      END AS score_match_type,

      -- w2: Skill proximity (caller ↔ creator) × rating-badge confidence.
      -- Reuses the suggestion RPC's matrix verbatim.
      CASE
        WHEN v_caller_rating_value IS NULL OR er.rating_value IS NULL THEN 0.5
        WHEN ABS(v_caller_rating_value - er.rating_value) = 0    THEN 1.0
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 0.5 THEN 0.7
        WHEN ABS(v_caller_rating_value - er.rating_value) <= 1.0 THEN 0.3
        ELSE 0.0
      END
      *
      CASE
        WHEN v_caller_badge_status IS NULL THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.5
            WHEN 'self_declared' THEN 0.5
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'certified' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 1.0
            WHEN 'self_declared' THEN 0.6
            WHEN 'disputed'      THEN 0.3
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'self_declared' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.6
            WHEN 'self_declared' THEN 0.4
            WHEN 'disputed'      THEN 0.2
            ELSE 0.5
          END
        WHEN v_caller_badge_status = 'disputed' THEN
          CASE er.badge_status
            WHEN 'certified'     THEN 0.3
            WHEN 'self_declared' THEN 0.2
            WHEN 'disputed'      THEN 0.1
            ELSE 0.3
          END
        ELSE 0.5
      END AS score_skill,

      -- w3: Duration alignment (caller pref ↔ match.duration — the
      -- concrete duration on the match, not the creator's general pref).
      CASE
        WHEN v_caller_match_duration IS NULL OR cm.m_duration IS NULL THEN 0.5
        WHEN v_caller_match_duration = cm.m_duration THEN 1.0
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '60')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '90')
          THEN 0.5
        WHEN (v_caller_match_duration = '30'  AND cm.m_duration = '90')
          OR (v_caller_match_duration = '90'  AND cm.m_duration = '30')
          OR (v_caller_match_duration = '60'  AND cm.m_duration = '120')
          OR (v_caller_match_duration = '120' AND cm.m_duration = '60')
          THEN 0.3
        ELSE 0.2
      END AS score_duration,

      -- w4: Availability FIT — % of the match's hour-range covered by the
      -- caller's active (day_of_week, hour_of_day) rows. Different shape
      -- from the suggestion RPC's *density* signal: density is meaningful
      -- when *generating* slot candidates; here the slot is fixed.
      CASE
        WHEN cm.m_start_time IS NULL OR cm.m_end_time IS NULL THEN 0.5
        ELSE COALESCE((
          SELECT
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM caller_avail ca
               WHERE ca.day::TEXT = LOWER(TO_CHAR(cm.m_date, 'FMday'))
                 AND ca.hour_of_day = h.hr::smallint
            ) THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0)
          FROM generate_series(
            EXTRACT(HOUR FROM cm.m_start_time)::int,
            GREATEST(
              EXTRACT(HOUR FROM cm.m_start_time)::int,
              EXTRACT(HOUR FROM cm.m_end_time)::int - 1
            )
          ) AS h(hr)
        ), 0.0)
      END AS score_availability_fit,

      -- w5: Creator reputation. Gated by is_public (which requires
      -- matches_completed ≥ 3).
      CASE
        WHEN COALESCE(rep.is_public, FALSE) = FALSE THEN 0.5
        ELSE COALESCE(rep.reputation_score, 50.0) / 100.0
      END AS score_reputation,

      -- w6: Creator responsiveness (90-day window).
      COALESCE(
        CASE
          WHEN rs.received >= 3 THEN
            LEAST(1.0::NUMERIC, GREATEST(0.0::NUMERIC,
              0.7 * (rs.responded::NUMERIC / NULLIF(rs.received, 0))
            + 0.3 * (CASE
                       WHEN rs.responded > 0
                       THEN rs.accepted::NUMERIC / rs.responded
                       ELSE 0.5
                     END)
            ))
          ELSE 0.5::NUMERIC
        END,
        0.5::NUMERIC
      )::DECIMAL(6,4) AS score_responsiveness,

      -- w7: Creator activity (existing helper).
      public.player_activity_score(cm.creator_id)::DECIMAL(6,4) AS score_activity,

      -- Caller↔creator history (signed ±0.5).
      COALESCE(h.score_history, 0::numeric)::DECIMAL(6,4) AS pair_score_history,

      -- Facility affinity components — capped via final LEAST().
      -- Shared favorite bonus (only meaningful for facility-located matches).
      CASE
        WHEN cm.m_facility_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM player_favorite_facility cpff
           WHERE cpff.player_id  = p_caller_id
             AND cpff.facility_id = cm.m_facility_id
             AND cpff.sport_id    = p_sport_id
        ) THEN 0.30
        ELSE 0.0
      END AS fac_shared_fav_bonus,

      -- Distance decay to caller's home (works for facility + custom).
      CASE
        WHEN cm.m_location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.m_location, v_caller_location)
                       / (COALESCE(v_caller_max_distance, 25) * 1000)))
      END AS fac_dist_caller,

      -- Distance decay to creator's home (only sensible for facility matches:
      -- a custom location doesn't tell us about the creator's convenience).
      CASE
        WHEN cm.m_facility_id IS NULL
          OR cm.facility_location IS NULL
          OR creator_player.location IS NULL THEN 0.0
        ELSE GREATEST(0,
          0.25 * (1.0 - extensions.ST_Distance(cm.facility_location, creator_player.location)
                       / (COALESCE(creator_player.max_travel_distance, 25) * 1000)))
      END AS fac_dist_creator

    FROM candidate_matches cm
    JOIN player creator_player      ON creator_player.id = cm.creator_id
    LEFT JOIN effective_rating er   ON er.player_id      = cm.creator_id
    LEFT JOIN player_reputation rep ON rep.player_id     = cm.creator_id
    LEFT JOIN responsiveness rs     ON rs.player_id      = cm.creator_id
    LEFT JOIN history h             ON h.opp_id          = cm.creator_id
  )

  SELECT
    s.m_id                  AS match_id,
    s.m_distance_meters     AS distance_meters,
    -- player_compatibility = clamp(base + 0.5×score_history − disputed_penalty, 0, 1)
    -- Weights (sum to 1.0): match_type 0.18, skill 0.18, duration 0.05,
    -- availability_fit 0.27, reputation 0.05, responsiveness 0.17, activity 0.10.
    -- Tilted relative to the suggestion RPC: +0.05 to availability (concrete
    -- fit beats generic density on this surface) and −0.05 from reputation.
    LEAST(1.0, GREATEST(0.0,
      ( 0.18 * s.score_match_type
      + 0.18 * s.score_skill
      + 0.05 * s.score_duration
      + 0.27 * s.score_availability_fit
      + 0.05 * s.score_reputation
      + 0.17 * s.score_responsiveness
      + 0.10 * s.score_activity
      )
      + 0.5 * s.pair_score_history
      - (CASE WHEN s.creator_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
    ))::DECIMAL(6,4) AS player_compatibility,
    -- facility_affinity ∈ [0, 1], capped.
    LEAST(1.0,
      s.fac_shared_fav_bonus + s.fac_dist_caller + s.fac_dist_creator
    )::DECIMAL(6,4) AS facility_affinity,
    s.pair_score_history    AS score_history
  FROM scored s
  ORDER BY
    -- Ranking score: 0.70 × player_compat + 0.30 × facility_affinity
    -- (mirror suggestion RPC's outer composition).
    (
      0.70 * LEAST(1.0, GREATEST(0.0,
        ( 0.18 * s.score_match_type
        + 0.18 * s.score_skill
        + 0.05 * s.score_duration
        + 0.27 * s.score_availability_fit
        + 0.05 * s.score_reputation
        + 0.17 * s.score_responsiveness
        + 0.10 * s.score_activity
        )
        + 0.5 * s.pair_score_history
        - (CASE WHEN s.creator_badge_status = 'disputed'::badge_status_enum THEN 0.15 ELSE 0.0 END)
      ))
    + 0.30 * LEAST(1.0, s.fac_shared_fav_bonus + s.fac_dist_caller + s.fac_dist_creator)
    ) DESC
  LIMIT p_limit;

END;
$function$;

REVOKE ALL ON FUNCTION public.get_upcoming_matches_scored(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text, p_limit integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_upcoming_matches_scored(p_caller_id uuid, p_sport_id uuid, p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_user_gender text, p_limit integer) TO authenticated;

CREATE OR REPLACE FUNCTION join_group_by_invite_code(p_invite_code VARCHAR(12), p_player_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_network_id UUID;
  v_network_type_id UUID;
  v_player_group_type_id UUID;
  v_is_member BOOLEAN;
  v_group_name VARCHAR(255);
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Get player_group network type id
  SELECT id INTO v_player_group_type_id 
  FROM public.network_type 
  WHERE name = 'player_group';
  
  -- Find the group by invite code
  SELECT id, network_type_id, name INTO v_network_id, v_network_type_id, v_group_name
  FROM public.network 
  WHERE invite_code = UPPER(p_invite_code);
  
  -- Check if group exists
  IF v_network_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid invite code'
    );
  END IF;
  
  -- Verify it's a player group (not a club)
  IF v_network_type_id != v_player_group_type_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid invite code'
    );
  END IF;
  
  -- Check if already a member
  SELECT EXISTS(
    SELECT 1 FROM public.network_member 
    WHERE network_id = v_network_id 
    AND player_id = p_player_id 
    AND status = 'active'
  ) INTO v_is_member;
  
  IF v_is_member THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You are already a member of this group'
    );
  END IF;
  
  -- Add player to group
  INSERT INTO public.network_member (network_id, player_id, role, status, added_by, joined_at)
  VALUES (v_network_id, p_player_id, 'member', 'active', NULL, NOW())
  ON CONFLICT (network_id, player_id) 
  DO UPDATE SET status = 'active', joined_at = NOW();
  
  -- Update member count
  UPDATE public.network 
  SET member_count = (
    SELECT COUNT(*) FROM public.network_member 
    WHERE network_id = v_network_id AND status = 'active'
  )
  WHERE id = v_network_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'group_id', v_network_id,
    'group_name', v_group_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.join_group_by_invite_code(p_invite_code character varying, p_player_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite_code(p_invite_code character varying, p_player_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION log_admin_action(
  p_admin_id UUID,
  p_action_type admin_action_type_enum,
  p_entity_type admin_entity_type_enum,
  p_entity_id UUID DEFAULT NULL,
  p_old_data JSONB DEFAULT NULL,
  p_new_data JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND (p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  INSERT INTO admin_audit_log (
    admin_id,
    action_type,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  ) VALUES (
    p_admin_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    p_metadata
  )
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.log_admin_action(p_admin_id uuid, p_action_type admin_action_type_enum, p_entity_type admin_entity_type_enum, p_entity_id uuid, p_old_data jsonb, p_new_data jsonb, p_metadata jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(p_admin_id uuid, p_action_type admin_action_type_enum, p_entity_type admin_entity_type_enum, p_entity_id uuid, p_old_data jsonb, p_new_data jsonb, p_metadata jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_admin_id uuid,
  p_action_type text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_entity_name text DEFAULT NULL,
  p_old_data jsonb DEFAULT NULL,
  p_new_data jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_severity text DEFAULT 'info'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND (p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_audit_log (
    admin_id,
    action_type,
    entity_type,
    entity_id,
    entity_name,
    old_data,
    new_data,
    metadata,
    severity
  ) VALUES (
    p_admin_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_entity_name,
    p_old_data,
    p_new_data,
    p_metadata,
    p_severity
  )
  RETURNING id INTO v_log_id;
  
  -- Auto-create alert for critical actions
  IF p_severity = 'critical' OR p_action_type IN ('ban', 'delete', 'config_change') THEN
    INSERT INTO public.admin_alert (
      alert_type,
      title,
      message,
      severity,
      source_type,
      source_id,
      target_roles,
      metadata
    ) VALUES (
      CASE 
        WHEN p_action_type = 'ban' THEN 'user_activity'
        WHEN p_action_type = 'delete' THEN 'system'
        WHEN p_action_type = 'config_change' THEN 'system'
        ELSE 'security'
      END,
      CASE 
        WHEN p_action_type = 'ban' THEN 'User Banned'
        WHEN p_action_type = 'delete' THEN 'Data Deleted'
        WHEN p_action_type = 'config_change' THEN 'Configuration Changed'
        ELSE 'Critical Action Performed'
      END,
      format('%s action on %s: %s', p_action_type, p_entity_type, COALESCE(p_entity_name, p_entity_id::text, 'unknown')),
      COALESCE(p_severity, 'warning'),
      'audit_log',
      v_log_id,
      ARRAY['super_admin']::text[],
      jsonb_build_object('admin_id', p_admin_id, 'action_type', p_action_type)
    );
  END IF;
  
  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_action(p_admin_id uuid, p_action_type text, p_entity_type text, p_entity_id uuid, p_entity_name text, p_old_data jsonb, p_new_data jsonb, p_metadata jsonb, p_severity text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(p_admin_id uuid, p_action_type text, p_entity_type text, p_entity_id uuid, p_entity_name text, p_old_data jsonb, p_new_data jsonb, p_metadata jsonb, p_severity text) TO authenticated;

CREATE OR REPLACE FUNCTION propose_rebuttal_score(
  p_match_result_id UUID,
  p_player_id UUID,
  p_winning_team INTEGER,
  p_sets JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  v_match_id UUID;
  v_submitter_team INTEGER;
  v_player_team INTEGER;
  v_team1_wins INTEGER := 0;
  v_team2_wins INTEGER := 0;
  v_set JSONB;
  v_needs_swap BOOLEAN;
  v_mapped_sets JSONB;
  v_mapped_winning_team INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND p_player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_player_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Verify score exists and isn't already processed or rebutted
  SELECT mr.match_id INTO v_match_id
  FROM match_result mr
  WHERE mr.id = p_match_result_id
    AND mr.is_verified = FALSE
    AND mr.disputed = FALSE
    AND mr.rebuttal_submitted_by IS NULL;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Score not found or already processed';
  END IF;

  -- Get submitter's team number
  SELECT mp.team_number INTO v_submitter_team
  FROM match_participant mp
  JOIN match_result mr ON mr.match_id = mp.match_id AND mr.id = p_match_result_id
  WHERE mp.match_id = v_match_id
    AND mp.player_id = mr.submitted_by
    AND mp.status = 'joined';

  -- Get rebutting player's team number
  SELECT mp.team_number INTO v_player_team
  FROM match_participant mp
  WHERE mp.match_id = v_match_id
    AND mp.player_id = p_player_id
    AND mp.status = 'joined';

  IF v_player_team IS NULL THEN
    RAISE EXCEPTION 'Player is not a participant of this match';
  END IF;

  -- Only opponents (different team) can propose a rebuttal
  IF v_player_team = v_submitter_team THEN
    RAISE EXCEPTION 'Only opponents can propose a rebuttal score';
  END IF;

  -- The UI sends scores where team1 = "me" (rebuttal submitter).
  -- If the rebuttal submitter is on match team 2, we need to swap
  -- team1/team2 so that rebuttal_team1_score always means match team 1.
  v_needs_swap := (v_player_team = 2);

  -- Remap sets: swap team1_score/team2_score if submitter is team 2
  IF v_needs_swap THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'team1_score', (elem->>'team2_score')::INTEGER,
        'team2_score', (elem->>'team1_score')::INTEGER
      )
    ) INTO v_mapped_sets
    FROM jsonb_array_elements(p_sets) AS elem;
  ELSE
    v_mapped_sets := p_sets;
  END IF;

  -- Remap winning_team
  IF v_needs_swap AND p_winning_team IS NOT NULL THEN
    v_mapped_winning_team := CASE WHEN p_winning_team = 1 THEN 2 ELSE 1 END;
  ELSE
    v_mapped_winning_team := p_winning_team;
  END IF;

  -- Compute team scores from mapped sets
  FOR v_set IN SELECT * FROM jsonb_array_elements(v_mapped_sets)
  LOOP
    IF (v_set->>'team1_score')::INTEGER > (v_set->>'team2_score')::INTEGER THEN
      v_team1_wins := v_team1_wins + 1;
    ELSIF (v_set->>'team2_score')::INTEGER > (v_set->>'team1_score')::INTEGER THEN
      v_team2_wins := v_team2_wins + 1;
    END IF;
  END LOOP;

  -- Store rebuttal data (team1/team2 now refers to actual match teams)
  UPDATE match_result
  SET
    rebuttal_team1_score = v_team1_wins,
    rebuttal_team2_score = v_team2_wins,
    rebuttal_winning_team = v_mapped_winning_team,
    rebuttal_sets = v_mapped_sets,
    rebuttal_submitted_by = p_player_id,
    rebuttal_submitted_at = NOW(),
    rebuttal_deadline = NOW() + INTERVAL '24 hours'
  WHERE id = p_match_result_id;

  -- Record in score_confirmation table
  INSERT INTO score_confirmation (match_result_id, player_id, action)
  VALUES (p_match_result_id, p_player_id, 'rebuttal')
  ON CONFLICT (match_result_id, player_id) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.propose_rebuttal_score(p_match_result_id uuid, p_player_id uuid, p_winning_team integer, p_sets jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_rebuttal_score(p_match_result_id uuid, p_player_id uuid, p_winning_team integer, p_sets jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION register_admin_device(
  p_admin_id UUID,
  p_push_token TEXT,
  p_platform TEXT,
  p_device_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_device_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND (p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  INSERT INTO admin_device (admin_id, push_token, platform, device_name, last_active)
  VALUES (p_admin_id, p_push_token, p_platform, p_device_name, NOW())
  ON CONFLICT (admin_id, push_token)
  DO UPDATE SET
    is_active = TRUE,
    last_active = NOW(),
    device_name = COALESCE(EXCLUDED.device_name, admin_device.device_name)
  RETURNING id INTO v_device_id;
  
  RETURN v_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.register_admin_device(p_admin_id uuid, p_push_token text, p_platform text, p_device_name text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_admin_device(p_admin_id uuid, p_push_token text, p_platform text, p_device_name text) TO authenticated;

CREATE OR REPLACE FUNCTION reset_group_invite_code(p_group_id UUID, p_moderator_id UUID)
RETURNS VARCHAR(12) AS $$
DECLARE
  v_is_moderator BOOLEAN;
  new_code VARCHAR(12);
BEGIN
  IF auth.uid() IS NOT NULL AND p_moderator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_moderator_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Check if user is a moderator
  SELECT EXISTS(
    SELECT 1 FROM public.network_member 
    WHERE network_id = p_group_id 
    AND player_id = p_moderator_id 
    AND status = 'active'
    AND role = 'moderator'
  ) INTO v_is_moderator;
  
  IF NOT v_is_moderator THEN
    RAISE EXCEPTION 'Only moderators can reset the invite code';
  END IF;
  
  -- Generate new code
  new_code := generate_unique_invite_code();
  
  -- Update network with new code
  UPDATE public.network 
  SET invite_code = new_code 
  WHERE id = p_group_id;
  
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.reset_group_invite_code(p_group_id uuid, p_moderator_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_group_invite_code(p_group_id uuid, p_moderator_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_player_report(
  p_report_id UUID,
  p_admin_id UUID,
  p_status report_status_enum,
  p_action_taken TEXT DEFAULT NULL,
  p_admin_notes TEXT DEFAULT NULL,
  p_ban_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  UPDATE public.player_report
  SET
    status = p_status,
    reviewed_by = p_admin_id,
    reviewed_at = NOW(),
    action_taken = COALESCE(p_action_taken, action_taken),
    admin_notes = COALESCE(p_admin_notes, admin_notes),
    resulting_ban_id = COALESCE(p_ban_id, resulting_ban_id)
  WHERE id = p_report_id;
  
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.review_player_report(p_report_id uuid, p_admin_id uuid, p_status report_status_enum, p_action_taken text, p_admin_notes text, p_ban_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_player_report(p_report_id uuid, p_admin_id uuid, p_status report_status_enum, p_action_taken text, p_admin_notes text, p_ban_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_players_nearby(p_sport_id uuid, p_current_user_id uuid DEFAULT NULL::uuid, p_search_query text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_gender text DEFAULT NULL::text, p_min_skill_value numeric DEFAULT NULL::numeric, p_min_travel_distance_km integer DEFAULT NULL::integer, p_availability text DEFAULT NULL::text, p_day text DEFAULT NULL::text, p_play_style text DEFAULT NULL::text, p_favorite_player_ids uuid[] DEFAULT NULL::uuid[], p_blocked_player_ids uuid[] DEFAULT NULL::uuid[], p_favorites_only boolean DEFAULT false, p_blocked_only boolean DEFAULT false, p_exclude_player_ids uuid[] DEFAULT NULL::uuid[], p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_rating_score_ids uuid[] DEFAULT NULL::uuid[], p_reputation_tier text DEFAULT NULL::text, p_certified_only boolean DEFAULT false, p_min_hour smallint DEFAULT NULL::smallint, p_max_hour smallint DEFAULT NULL::smallint)
 RETURNS TABLE(id uuid, first_name text, last_name text, display_name text, profile_picture_url text, city text, gender text, rating_label text, rating_value double precision, rating_is_certified boolean, rating_badge_status text, latitude double precision, longitude double precision, distance_meters double precision, total_count bigint, reputation_tier text, reputation_score double precision, reputation_is_public boolean, last_seen_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND p_current_user_id IS NOT NULL AND p_current_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'p_current_user_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY

  WITH effective_rating AS (
    SELECT
      prs.player_id,
      prs.rating_score_id,
      rs.label::TEXT AS rating_label,
      rs.value::DOUBLE PRECISION AS rating_value,
      prs.is_certified AS rating_is_certified,
      CASE
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 'disputed'
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 'certified'
        ELSE 'self_declared'
      END AS rating_badge_status
    FROM player_sport eps
    JOIN player_rating_score prs ON prs.id = eps.active_rating_score_id
    JOIN rating_score rs ON rs.id = prs.rating_score_id
    WHERE eps.sport_id = p_sport_id
  ),
  filtered AS (
    SELECT
      p.id,
      pr.first_name::TEXT AS first_name,
      pr.last_name::TEXT AS last_name,
      pr.display_name::TEXT AS display_name,
      pr.profile_picture_url::TEXT AS profile_picture_url,
      p.city::TEXT AS city,
      p.gender::TEXT AS gender,
      er.rating_label,
      er.rating_value,
      er.rating_is_certified,
      er.rating_badge_status,
      p.latitude::DOUBLE PRECISION AS latitude,
      p.longitude::DOUBLE PRECISION AS longitude,
      CASE
        WHEN p_latitude IS NULL OR p_longitude IS NULL OR p.location IS NULL THEN NULL
        ELSE extensions.ST_Distance(
          p.location,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography
        )
      END AS distance_meters,
      rep.reputation_tier::TEXT AS reputation_tier,
      rep.reputation_score::DOUBLE PRECISION AS reputation_score,
      rep.is_public AS reputation_is_public,
      p.last_seen_at
    FROM public.player p
    INNER JOIN public.player_sport ps
      ON ps.player_id = p.id
     AND ps.sport_id = p_sport_id
     AND (ps.is_active IS NULL OR ps.is_active = TRUE)
    INNER JOIN public.profile pr
      ON pr.id = p.id
     AND (pr.is_active IS NULL OR pr.is_active = TRUE)
    LEFT JOIN effective_rating er ON er.player_id = p.id
    LEFT JOIN public.player_reputation rep ON rep.player_id = p.id
    WHERE
      (p_current_user_id IS NULL OR p.id <> p_current_user_id)
      AND (p_exclude_player_ids IS NULL OR NOT (p.id = ANY(p_exclude_player_ids)))
      AND (
        NOT p_favorites_only
        OR (p_favorite_player_ids IS NOT NULL AND p.id = ANY(p_favorite_player_ids))
      )
      AND (
        CASE
          WHEN p_blocked_only THEN
            p_blocked_player_ids IS NOT NULL AND p.id = ANY(p_blocked_player_ids)
          WHEN p_blocked_player_ids IS NOT NULL THEN
            NOT (p.id = ANY(p_blocked_player_ids))
          ELSE TRUE
        END
      )
      AND (p_gender IS NULL OR p.gender::TEXT = p_gender)
      AND (p_min_skill_value IS NULL OR er.rating_value >= p_min_skill_value)
      AND (p_min_travel_distance_km IS NULL OR p.max_travel_distance >= p_min_travel_distance_km)
      AND (
        p_play_style IS NULL
        OR ps.preferred_play_style::TEXT = p_play_style
      )
      AND (
        (p_min_hour IS NULL AND p_max_hour IS NULL AND p_day IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.player_availability pa
          WHERE pa.player_id = p.id
            AND (pa.is_active IS NULL OR pa.is_active = TRUE)
            AND (p_day IS NULL OR pa.day::TEXT = p_day)
            AND (p_min_hour IS NULL OR pa.hour_of_day >= p_min_hour)
            AND (p_max_hour IS NULL OR pa.hour_of_day <= p_max_hour)
        )
      )
      AND (
        p_search_query IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
            btrim(regexp_replace(p_search_query, '\s+', ' ', 'g')), ' '
          )) AS word
          WHERE word <> ''
          AND NOT (
            extensions.unaccent(COALESCE(pr.first_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(pr.last_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(pr.display_name, '')) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(p.city, '')) ILIKE '%' || extensions.unaccent(word) || '%'
          )
        )
      )
      AND (p_rating_score_ids IS NULL OR er.rating_score_id = ANY(p_rating_score_ids))
      AND (p_reputation_tier IS NULL OR rep.reputation_tier::TEXT = p_reputation_tier)
      AND (NOT p_certified_only OR er.rating_badge_status = 'certified')
  )
  SELECT
    f.id,
    f.first_name,
    f.last_name,
    f.display_name,
    f.profile_picture_url,
    f.city,
    f.gender,
    f.rating_label,
    f.rating_value,
    f.rating_is_certified,
    f.rating_badge_status,
    f.latitude,
    f.longitude,
    f.distance_meters,
    COUNT(*) OVER ()::BIGINT AS total_count,
    f.reputation_tier,
    f.reputation_score,
    f.reputation_is_public,
    f.last_seen_at
  FROM filtered f
  ORDER BY
    CASE WHEN p_sort_by = 'distance' THEN f.distance_meters END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name_asc' THEN lower(COALESCE(f.first_name, f.display_name, '')) END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'name_desc' THEN lower(COALESCE(f.first_name, f.display_name, '')) END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'rating_high' THEN f.rating_value END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'rating_low' THEN f.rating_value END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'recently_active' THEN f.last_seen_at END DESC NULLS LAST,
    f.id ASC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.search_players_nearby(p_sport_id uuid, p_current_user_id uuid, p_search_query text, p_latitude double precision, p_longitude double precision, p_gender text, p_min_skill_value numeric, p_min_travel_distance_km integer, p_availability text, p_day text, p_play_style text, p_favorite_player_ids uuid[], p_blocked_player_ids uuid[], p_favorites_only boolean, p_blocked_only boolean, p_exclude_player_ids uuid[], p_sort_by text, p_limit integer, p_offset integer, p_rating_score_ids uuid[], p_reputation_tier text, p_certified_only boolean, p_min_hour smallint, p_max_hour smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_players_nearby(p_sport_id uuid, p_current_user_id uuid, p_search_query text, p_latitude double precision, p_longitude double precision, p_gender text, p_min_skill_value numeric, p_min_travel_distance_km integer, p_availability text, p_day text, p_play_style text, p_favorite_player_ids uuid[], p_blocked_player_ids uuid[], p_favorites_only boolean, p_blocked_only boolean, p_exclude_player_ids uuid[], p_sort_by text, p_limit integer, p_offset integer, p_rating_score_ids uuid[], p_reputation_tier text, p_certified_only boolean, p_min_hour smallint, p_max_hour smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.session_create_series(
    p_season_id        uuid,
    p_name             text,
    p_first_at         timestamptz,
    p_repeat_every_days integer,
    p_occurrences      integer,
    p_timezone         text DEFAULT NULL,
    p_duration_minutes smallint DEFAULT 90,
    p_facility_id      uuid DEFAULT NULL,
    p_venue_name       text DEFAULT NULL,
    p_capacity         smallint DEFAULT NULL,
    p_rounds           smallint DEFAULT 1,
    p_pairing_mode     pairing_mode DEFAULT 'by_rank',
    p_window_days      smallint DEFAULT NULL
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_season      seasons;
    v_tz          text := COALESCE(p_timezone, 'UTC');
    v_first_local timestamp;
    v_last_at     timestamptz;
    v_at          timestamptz;
    i             integer;
BEGIN
    -- Weekly, every two weeks, every four weeks. Anything else would need a
    -- real recurrence rule (nth weekday, month ends), which nobody has asked
    -- for and which the season window makes largely pointless.
    IF p_repeat_every_days NOT IN (7, 14, 28) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RECURRENCE';
    END IF;
    IF p_occurrences IS NULL OR p_occurrences NOT BETWEEN 2 AND 26 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_OCCURRENCES';
    END IF;

    -- A window longer than the gap would overlap the next occurrence, leaving
    -- members owing games to two sessions on the same days.
    IF p_window_days IS NOT NULL
       AND (p_window_days < 1 OR p_window_days > p_repeat_every_days) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_PLAY_WINDOW';
    END IF;

    BEGIN
        v_first_local := p_first_at AT TIME ZONE v_tz;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TIMEZONE';
    END;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;
    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- The last one has to land inside the season. end_date is a date, so the
    -- comparison is against the end of that day.
    v_last_at := (v_first_local
                  + ((p_occurrences - 1) * p_repeat_every_days) * interval '1 day')
                 AT TIME ZONE v_tz;
    IF v_last_at >= (v_season.end_date + 1)::timestamptz THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERIES_EXCEEDS_SEASON';
    END IF;

    FOR i IN 0..(p_occurrences - 1) LOOP
        -- Calendar-day arithmetic on the LOCAL timestamp: 18:00 stays 18:00 on
        -- both sides of a DST transition.
        v_at := (v_first_local + (i * p_repeat_every_days) * interval '1 day')
                AT TIME ZONE v_tz;
        RETURN QUERY
        SELECT * FROM public.session_create(
            p_season_id, p_name, v_at, p_timezone, p_duration_minutes,
            p_facility_id, p_venue_name, p_capacity, p_rounds, p_pairing_mode,
            CASE WHEN p_window_days IS NULL THEN NULL
                 ELSE v_at + (p_window_days * interval '1 day') END);
    END LOOP;

    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.session_create_series(p_season_id uuid, p_name text, p_first_at timestamp with time zone, p_repeat_every_days integer, p_occurrences integer, p_timezone text, p_duration_minutes smallint, p_facility_id uuid, p_venue_name text, p_capacity smallint, p_rounds smallint, p_pairing_mode pairing_mode, p_window_days smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_create_series(p_season_id uuid, p_name text, p_first_at timestamp with time zone, p_repeat_every_days integer, p_occurrences integer, p_timezone text, p_duration_minutes smallint, p_facility_id uuid, p_venue_name text, p_capacity smallint, p_rounds smallint, p_pairing_mode pairing_mode, p_window_days smallint) TO authenticated;

CREATE OR REPLACE FUNCTION unregister_admin_device(
  p_admin_id UUID,
  p_push_token TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (p_admin_id IS DISTINCT FROM auth.uid() OR NOT public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'p_admin_id must be the calling admin' USING ERRCODE = '42501';
  END IF;
  UPDATE admin_device
  SET is_active = FALSE
  WHERE admin_id = p_admin_id AND push_token = p_push_token;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.unregister_admin_device(p_admin_id uuid, p_push_token text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_admin_device(p_admin_id uuid, p_push_token text) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_and_create_match_from_email_invite(
  p_caller_id    UUID,
  p_opponent_id  UUID,
  p_sport_id     UUID,
  p_facility_id  UUID,
  p_match_date   DATE,
  p_start_time   TIME,
  p_end_time     TIME,
  p_timezone     TEXT DEFAULT 'America/Toronto'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_match_id UUID;
  v_caller_busy BOOLEAN;
  v_opponent_busy BOOLEAN;
  v_duration INT;
  v_duration_enum match_duration_enum;
BEGIN
  IF auth.uid() IS NOT NULL AND p_caller_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_caller_id must be the calling user' USING ERRCODE = '42501';
  END IF;
  -- Compute duration in minutes for the duration column.
  v_duration := EXTRACT(EPOCH FROM (p_end_time - p_start_time))::INT / 60;
  IF v_duration <= 0 THEN
    v_duration := v_duration + 24 * 60; -- handle midnight crossing
  END IF;

  -- Map to enum (closest match).
  v_duration_enum := CASE
    WHEN v_duration <= 30  THEN '30'
    WHEN v_duration <= 60  THEN '60'
    WHEN v_duration <= 90  THEN '90'
    ELSE '120'
  END;

  -- 1. Caller busy check.
  SELECT EXISTS (
    SELECT 1
    FROM public.match_participant mp
    JOIN public.match m ON m.id = mp.match_id
    WHERE mp.player_id = p_caller_id
      AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
      AND m.cancelled_at IS NULL
      AND m.match_date = p_match_date
      AND m.start_time < p_end_time
      AND p_start_time < m.end_time
  ) INTO v_caller_busy;

  IF v_caller_busy THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'caller_busy');
  END IF;

  -- 2. Opponent busy check.
  SELECT EXISTS (
    SELECT 1
    FROM public.match_participant mp
    JOIN public.match m ON m.id = mp.match_id
    WHERE mp.player_id = p_opponent_id
      AND mp.status IN ('joined', 'requested', 'pending', 'waitlisted')
      AND m.cancelled_at IS NULL
      AND m.match_date = p_match_date
      AND m.start_time < p_end_time
      AND p_start_time < m.end_time
  ) INTO v_opponent_busy;

  IF v_opponent_busy THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'opponent_busy');
  END IF;

  -- 3. Insert the match (caller is the host).
  INSERT INTO public.match (
    sport_id,
    created_by,
    match_date,
    start_time,
    end_time,
    timezone,
    format,
    player_expectation,
    duration,
    location_type,
    facility_id,
    court_status,
    visibility,
    join_mode
  ) VALUES (
    p_sport_id,
    p_caller_id,
    p_match_date,
    p_start_time,
    p_end_time,
    p_timezone,
    'singles',
    'both',
    v_duration_enum,
    'facility',
    p_facility_id,
    'to_reserve',
    'public',
    'request'
  )
  RETURNING id INTO v_match_id;

  -- The match_create_host_participant trigger inserts the caller's host
  -- participant row automatically, so we only insert the opponent.
  INSERT INTO public.match_participant (match_id, player_id, status, is_host)
  VALUES (v_match_id, p_opponent_id, 'requested', FALSE);

  RETURN jsonb_build_object('success', TRUE, 'match_id', v_match_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_and_create_match_from_email_invite(p_caller_id uuid, p_opponent_id uuid, p_sport_id uuid, p_facility_id uuid, p_match_date date, p_start_time time without time zone, p_end_time time without time zone, p_timezone text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_and_create_match_from_email_invite(p_caller_id uuid, p_opponent_id uuid, p_sport_id uuid, p_facility_id uuid, p_match_date date, p_start_time time without time zone, p_end_time time without time zone, p_timezone text) TO authenticated;

ALTER FUNCTION public.lt_match_result_propagation_tg() SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.award_tournament_ranking_points(p_tournament_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_tournament_ranking_points(p_tournament_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_active_player_ban(p_player_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_player_ban(p_player_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_compatible_players(p_player_id uuid, p_sport_id uuid, p_rating_tolerance numeric, p_max_results integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatible_players(p_player_id uuid, p_sport_id uuid, p_rating_tolerance numeric, p_max_results integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_group_activity(p_network_id uuid, p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_activity(p_network_id uuid, p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_morning_digest_suggestions(p_player_id uuid, p_sport_id uuid, p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_morning_digest_suggestions(p_player_id uuid, p_sport_id uuid, p_limit integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_opponents_for_notification(p_match_id uuid, p_player_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_opponents_for_notification(p_match_id uuid, p_player_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_players_by_play_attributes(p_sport_id uuid, p_play_attributes play_attribute_enum[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_players_by_play_attributes(p_sport_id uuid, p_play_attributes play_attribute_enum[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_players_by_play_style(p_sport_id uuid, p_play_style play_style_enum) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_players_by_play_style(p_sport_id uuid, p_play_style play_style_enum) TO service_role;
REVOKE ALL ON FUNCTION public.get_proof_endorsement_counts(p_proof_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_proof_endorsement_counts(p_proof_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_user_created_match_ids(p_player_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_created_match_ids(p_player_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_user_participating_match_ids(p_player_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_participating_match_ids(p_player_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_player_banned(p_player_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_player_banned(p_player_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.log_active_rating_change(p_player_id uuid, p_sport_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_active_rating_change(p_player_id uuid, p_sport_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lt_advance_tournament_winner(p_tournament_match_id uuid, p_winner_registration_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_advance_tournament_winner(p_tournament_match_id uuid, p_winner_registration_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lt_notify_knockout_published(p_tournament_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_notify_knockout_published(p_tournament_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lt_notify_pools_published(p_tournament_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_notify_pools_published(p_tournament_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lt_notify_tournament_deadline_changed(p_tournament_id uuid, p_bracket_side text, p_rounds smallint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_notify_tournament_deadline_changed(p_tournament_id uuid, p_bracket_side text, p_rounds smallint[]) TO service_role;
REVOKE ALL ON FUNCTION public.lt_post_system_match_organizer_card(p_tournament_match_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_post_system_match_organizer_card(p_tournament_match_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lt_propagate_match_result_to_bracket(p_match_result_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_propagate_match_result_to_bracket(p_match_result_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lt_propagate_match_result_to_session(p_match_result_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_propagate_match_result_to_session(p_match_result_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mark_check_in_reminder_sent(p_participant_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_check_in_reminder_sent(p_participant_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mark_feedback_reminders_sent(p_participant_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_feedback_reminders_sent(p_participant_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mark_initial_feedback_notifications_sent(p_participant_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_initial_feedback_notifications_sent(p_participant_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mark_match_starting_soon_sent(p_participant_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_match_starting_soon_sent(p_participant_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.recalc_season_ranking(p_season_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_season_ranking(p_season_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.reevaluate_certification_for_player_rating(p_player_rating_score_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reevaluate_certification_for_player_rating(p_player_rating_score_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_facility_providers(p_facility_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_facility_providers(p_facility_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.send_admin_broadcast_push(p_title text, p_message text, p_severity text, p_alert_type text, p_admin_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_admin_broadcast_push(p_title text, p_message text, p_severity text, p_alert_type text, p_admin_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.snapshot_record_refresh_error(p_facility_id uuid, p_source text, p_error text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_record_refresh_error(p_facility_id uuid, p_source text, p_error text) TO service_role;
REVOKE ALL ON FUNCTION public.snapshot_replace_facility_rows(p_facility_id uuid, p_source text, p_rows jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_replace_facility_rows(p_facility_id uuid, p_source text, p_rows jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.snapshot_try_lock_facility(p_facility_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_try_lock_facility(p_facility_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.update_registration_paid_amount(p_registration_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_registration_paid_amount(p_registration_id uuid) TO service_role;
