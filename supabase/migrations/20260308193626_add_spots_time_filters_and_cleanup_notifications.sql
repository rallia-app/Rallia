drop trigger if exists "match_notify_nearby_players_on_create" on "public"."match";

drop function if exists "public"."notify_nearby_players_on_match_created"();

drop function if exists "public"."search_public_matches"(p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_sport_id uuid, p_search_query text, p_format text, p_match_type text, p_date_range text, p_time_of_day text, p_skill_level text, p_gender text, p_cost text, p_join_mode text, p_duration text, p_court_status text, p_specific_date date, p_limit integer, p_offset integer, p_user_gender text, p_facility_id uuid, p_match_tier text);

alter type "public"."notification_type_enum" rename to "notification_type_enum__old_version_to_be_dropped";

create type "public"."notification_type_enum" as enum ('match_invitation', 'reminder', 'payment', 'support', 'chat', 'system', 'match_join_request', 'match_join_accepted', 'match_join_rejected', 'match_player_joined', 'match_cancelled', 'match_updated', 'match_starting_soon', 'match_completed', 'player_kicked', 'player_left', 'new_message', 'friend_request', 'rating_verified', 'feedback_request', 'score_confirmation', 'feedback_reminder', 'booking_created', 'booking_cancelled_by_player', 'booking_modified', 'new_member_joined', 'member_left', 'member_role_changed', 'payment_received', 'payment_failed', 'refund_processed', 'daily_summary', 'weekly_report', 'booking_confirmed', 'booking_reminder', 'booking_cancelled_by_org', 'membership_approved', 'org_announcement', 'match_new_available', 'program_registration_confirmed', 'program_registration_cancelled', 'program_session_reminder', 'program_session_cancelled', 'program_waitlist_promoted', 'program_payment_due', 'program_payment_received', 'match_check_in_available', 'match_spot_opened');

alter table "public"."notification" alter column type type "public"."notification_type_enum" using type::text::"public"."notification_type_enum";

alter table "public"."notification_preference" alter column notification_type type "public"."notification_type_enum" using notification_type::text::"public"."notification_type_enum";

alter table "public"."organization_notification_preference" alter column notification_type type "public"."notification_type_enum" using notification_type::text::"public"."notification_type_enum";

alter table "public"."organization_notification_recipient" alter column notification_type type "public"."notification_type_enum" using notification_type::text::"public"."notification_type_enum";

-- Drop old function overloads that still reference the renamed enum type
drop function if exists "public"."get_org_notification_recipients"(uuid, notification_type_enum__old_version_to_be_dropped, delivery_channel_enum);
drop function if exists "public"."insert_notification"(uuid, notification_type_enum__old_version_to_be_dropped, uuid, text, text, jsonb, notification_priority_enum, timestamp with time zone, timestamp with time zone, uuid);

drop type "public"."notification_type_enum__old_version_to_be_dropped";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.search_public_matches(p_latitude double precision, p_longitude double precision, p_max_distance_km double precision, p_sport_id uuid, p_search_query text DEFAULT NULL::text, p_format text DEFAULT NULL::text, p_match_type text DEFAULT NULL::text, p_date_range text DEFAULT NULL::text, p_time_of_day text DEFAULT NULL::text, p_skill_level text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_cost text DEFAULT NULL::text, p_join_mode text DEFAULT NULL::text, p_duration text DEFAULT NULL::text, p_court_status text DEFAULT NULL::text, p_specific_date date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_user_gender text DEFAULT NULL::text, p_facility_id uuid DEFAULT NULL::uuid, p_match_tier text DEFAULT NULL::text, p_spots_available text DEFAULT NULL::text, p_specific_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS TABLE(match_id uuid, distance_meters double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_point extensions.geography;
  v_date_start DATE;
  v_date_end DATE;
  v_time_start TIME;
  v_time_end TIME;
  v_has_distance_filter BOOLEAN;
  v_has_facility_filter BOOLEAN;
BEGIN
  -- Create point from coordinates
  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  -- Determine if distance filter is active
  v_has_distance_filter := p_max_distance_km IS NOT NULL;

  -- Determine if facility filter is active
  v_has_facility_filter := p_facility_id IS NOT NULL;

  -- Calculate date range boundaries based on filter
  -- If p_specific_date is set, it overrides p_date_range
  IF p_specific_date IS NOT NULL THEN
    v_date_start := p_specific_date;
    v_date_end := p_specific_date;
  ELSIF p_date_range = 'today' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE;
  ELSIF p_date_range = 'tomorrow' THEN
    v_date_start := CURRENT_DATE + 1;
    v_date_end := CURRENT_DATE + 1;
  ELSIF p_date_range = 'week' THEN
    v_date_start := CURRENT_DATE;
    v_date_end := CURRENT_DATE + INTERVAL '7 days';
  ELSIF p_date_range = 'weekend' THEN
    -- Next Saturday to Sunday
    v_date_start := CURRENT_DATE + (6 - EXTRACT(DOW FROM CURRENT_DATE))::INT;
    v_date_end := v_date_start + INTERVAL '1 day';
  ELSE
    -- 'all' or NULL - no date filter beyond >= today
    v_date_start := CURRENT_DATE;
    v_date_end := NULL;
  END IF;

  -- Calculate time of day boundaries
  -- p_specific_time takes precedence over p_time_of_day presets
  IF p_specific_time IS NOT NULL THEN
    v_time_start := p_specific_time - INTERVAL '1 hour';
    v_time_end := p_specific_time + INTERVAL '1 hour';
    -- Clamp to valid time range
    IF v_time_start < '00:00:00'::TIME THEN
      v_time_start := '00:00:00'::TIME;
    END IF;
    IF v_time_end > '23:59:59'::TIME THEN
      v_time_end := '23:59:59'::TIME;
    END IF;
  ELSIF p_time_of_day = 'morning' THEN
    v_time_start := '06:00:00'::TIME;
    v_time_end := '12:00:00'::TIME;
  ELSIF p_time_of_day = 'afternoon' THEN
    v_time_start := '12:00:00'::TIME;
    v_time_end := '18:00:00'::TIME;
  ELSIF p_time_of_day = 'evening' THEN
    v_time_start := '18:00:00'::TIME;
    v_time_end := '23:59:59'::TIME;
  ELSE
    v_time_start := NULL;
    v_time_end := NULL;
  END IF;

  RETURN QUERY
  WITH match_distances AS (
    -- Calculate distance for matches with known coordinates (facility or custom location)
    SELECT
      m.id,
      CASE
        -- Use facility coordinates when location_type is 'facility' and facility has valid location
        WHEN m.location_type = 'facility' AND f.location IS NOT NULL AND f.is_active = TRUE THEN
          extensions.ST_Distance(v_point, f.location::extensions.geography)
        -- Use custom location coordinates when location_type is 'custom' and coords are available
        WHEN m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL THEN
          extensions.ST_Distance(
            v_point,
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude),
              4326
            )::extensions.geography
          )
        -- TBD locations have NULL distance
        ELSE NULL
      END AS dist_meters
    FROM match m
    LEFT JOIN facility f ON m.facility_id = f.id AND f.is_active = TRUE
    WHERE
      -- Only public, non-cancelled matches
      m.visibility = 'public'
      AND m.cancelled_at IS NULL
      -- Sport filter
      AND m.sport_id = p_sport_id
      -- Facility filter (when specified) - skip distance check when filtering by facility
      AND (NOT v_has_facility_filter OR m.facility_id = p_facility_id)
      -- When distance filter is active and NOT filtering by facility, only include matches with valid coordinates
      -- When no distance filter or filtering by facility, include all location types (including TBD)
      AND (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (
          -- Facility matches with valid location
          (m.location_type = 'facility' AND f.location IS NOT NULL AND f.is_active = TRUE)
          OR
          -- Custom location matches with valid coordinates
          (m.location_type = 'custom' AND m.custom_latitude IS NOT NULL AND m.custom_longitude IS NOT NULL)
        )
      )
  ),
  filtered_matches AS (
    SELECT
      m.id,
      md.dist_meters,
      m.match_date,
      m.start_time,
      m.end_time,
      m.timezone,
      m.format,
      m.duration,
      m.player_expectation,
      m.location_type,
      m.location_name,
      m.location_address,
      m.is_court_free,
      m.estimated_cost,
      m.join_mode,
      m.court_status,
      m.created_by,
      m.preferred_opponent_gender,
      m.min_rating_score_id,
      m.notes
    FROM match m
    INNER JOIN match_distances md ON m.id = md.id
    WHERE
      -- Distance filter (when specified and NOT filtering by facility)
      (
        v_has_facility_filter
        OR NOT v_has_distance_filter
        OR (md.dist_meters IS NOT NULL AND md.dist_meters <= p_max_distance_km * 1000)
      )
      -- Filter out matches that have already started, timezone-aware:
      AND (m.match_date + m.start_time) > (NOW() AT TIME ZONE COALESCE(m.timezone, 'UTC'))
      -- Date range filter (matches on or after start date)
      AND m.match_date >= v_date_start
      AND (v_date_end IS NULL OR m.match_date <= v_date_end)
      -- Format filter (singles/doubles) - cast enum to TEXT for comparison
      AND (p_format IS NULL OR m.format::TEXT = p_format)
      -- Match type filter (casual/competitive/both) - now uses player_expectation
      AND (
        p_match_type IS NULL
        OR (p_match_type = 'casual' AND m.player_expectation::TEXT IN ('casual', 'both'))
        OR (p_match_type = 'competitive' AND m.player_expectation::TEXT IN ('competitive', 'both'))
      )
      -- Time of day filter (or specific time filter)
      AND (
        v_time_start IS NULL
        OR (m.start_time >= v_time_start AND m.start_time < v_time_end)
      )
      -- Cost filter
      AND (
        p_cost IS NULL
        OR (p_cost = 'free' AND m.is_court_free = TRUE)
        OR (p_cost = 'paid' AND (m.is_court_free = FALSE OR m.estimated_cost IS NOT NULL))
      )
      -- Join mode filter - cast enum to TEXT for comparison
      AND (p_join_mode IS NULL OR m.join_mode::TEXT = p_join_mode)
      -- Duration filter - cast enum to TEXT for comparison
      -- '120+' includes both '120' and 'custom' durations
      AND (
        p_duration IS NULL
        OR (p_duration = '30' AND m.duration::TEXT = '30')
        OR (p_duration = '60' AND m.duration::TEXT = '60')
        OR (p_duration = '90' AND m.duration::TEXT = '90')
        OR (p_duration = '120+' AND m.duration::TEXT IN ('120', 'custom'))
      )
      -- Court status filter - cast enum to TEXT for comparison
      AND (p_court_status IS NULL OR m.court_status::TEXT = p_court_status)
      -- Gender eligibility filter: only show matches the user is eligible to join
      AND (
        m.preferred_opponent_gender IS NULL
        OR p_user_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
      -- UI Gender filter (for additional narrowing within eligible matches)
      AND (
        p_gender IS NULL
        OR p_gender = 'all'
        OR m.preferred_opponent_gender = p_gender::gender_enum
      )
      -- Text search: word-tokenized, accent-insensitive
      AND (
        p_search_query IS NULL OR LENGTH(TRIM(p_search_query)) = 0
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
            btrim(regexp_replace(p_search_query, '\s+', ' ', 'g')), ' '
          )) AS word
          WHERE word <> ''
          AND NOT (
            extensions.unaccent(COALESCE(m.location_name, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(m.location_address, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR extensions.unaccent(COALESCE(m.notes, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            OR EXISTS (
              SELECT 1 FROM profile p
              WHERE p.id = m.created_by
              AND extensions.unaccent(COALESCE(p.display_name, '')::text) ILIKE '%' || extensions.unaccent(word) || '%'
            )
          )
        )
      )
  ),
  -- Calculate participant counts and coveted counts for tier filtering
  match_counts AS (
    SELECT
      fm.id,
      fm.dist_meters,
      fm.match_date,
      fm.start_time,
      fm.format,
      fm.court_status,
      CASE fm.format
        WHEN 'doubles' THEN 4
        ELSE 2
      END AS total_spots,
      (
        SELECT COUNT(*)
        FROM match_participant mp
        WHERE mp.match_id = fm.id AND mp.status = 'joined'
      ) AS filled_spots,
      (
        SELECT COUNT(*)
        FROM match_participant mp
        JOIN player_reputation pr ON mp.player_id = pr.player_id
        WHERE mp.match_id = fm.id AND mp.status = 'joined'
          AND pr.reputation_score >= 90
          AND EXISTS (
            SELECT 1 FROM player_rating_score prs
            JOIN rating_score rs ON prs.rating_score_id = rs.id
            JOIN rating_system rsys ON rs.rating_system_id = rsys.id
            WHERE prs.player_id = mp.player_id
              AND rsys.sport_id = p_sport_id
              AND prs.badge_status = 'certified'
          )
      ) AS coveted_count
    FROM filtered_matches fm
  )
  SELECT
    mc.id AS match_id,
    mc.dist_meters AS distance_meters
  FROM match_counts mc
  WHERE
    -- Match tier filter
    (
      p_match_tier IS NULL
      OR (p_match_tier = 'mostWanted'
          AND mc.court_status = 'reserved'
          AND mc.coveted_count >= CASE WHEN mc.format = 'doubles' THEN 2 ELSE 1 END)
      OR (p_match_tier = 'covetedPlayers'
          AND mc.coveted_count >= CASE WHEN mc.format = 'doubles' THEN 2 ELSE 1 END)
      OR (p_match_tier = 'courtBooked'
          AND mc.court_status = 'reserved')
    )
    -- Spots available filter
    AND (
      p_spots_available IS NULL
      OR (p_spots_available = '1' AND mc.total_spots - mc.filled_spots = 1)
      OR (p_spots_available = '2' AND mc.total_spots - mc.filled_spots = 2)
      OR (p_spots_available = '3' AND mc.total_spots - mc.filled_spots >= 3)
    )
  ORDER BY
    mc.match_date ASC,
    mc.start_time ASC,
    COALESCE(mc.dist_meters, 999999999) ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$
;


