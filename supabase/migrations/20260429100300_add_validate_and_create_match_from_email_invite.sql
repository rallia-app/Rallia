-- ============================================================================
-- Migration: validate_and_create_match_from_email_invite RPC
-- Created: 2026-04-28
-- Description:
--   The morning digest email encodes a (facility, date, start_time, end_time)
--   in the suggestion CTA. By the time the user taps it (could be hours
--   later), the slot may already be busy. This RPC re-validates the slot
--   atomically and creates the match in the same transaction so there's no
--   race window between "is the slot free?" and "create it".
--
--   On success: returns { success: true, match_id }
--   On conflict: returns { success: false, reason: 'caller_busy' | 'opponent_busy' }
-- ============================================================================

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

GRANT EXECUTE ON FUNCTION public.validate_and_create_match_from_email_invite(
  UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.validate_and_create_match_from_email_invite IS
  'Atomically re-validates a (caller, opponent, facility, date, start, end) '
  'slot against caller and opponent busy windows, then creates the match if '
  'free. Used by MatchInviteConfirmSheet (mobile) and the web fallback page '
  'to handle the race between digest email send and user tap. Returns '
  '{success: true, match_id} or {success: false, reason: caller_busy | '
  'opponent_busy}.';
