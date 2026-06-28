-- Migration: swap the 🎾 tennis-ball emoji out of the "match is full" system
-- message for a sport-neutral one (🎯).
--
-- post_match_full_booking_prompt posts "<name> joined — your match is full!
-- Tap to book a court 🎾" into the match chat. That content is also the push
-- body (notify_new_message previews left(content, 100)). Rallia serves both
-- tennis and pickleball, so 🎾 is off-brand; use 🎯, which also reads as a
-- nudge toward the "book a court" call to action.
--
-- The in-chat card renders matchChat.courtPrompt.* (already emoji-free); content
-- only surfaces in the push and as the card's metadata-missing fallback. This is
-- a copy-only change — the function body is otherwise identical to
-- 20260625090000_suppress_self_notification_on_system_messages.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.post_match_full_booking_prompt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_sender constant uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_match      record;
  v_capacity   int;
  v_joined     int;
  v_tz         text;
  v_slot_start timestamptz;
  v_conv       uuid;
  v_joiner     text;
BEGIN
  IF NOT (
    (TG_OP = 'INSERT' AND NEW.status = 'joined')
    OR (TG_OP = 'UPDATE' AND NEW.status = 'joined' AND OLD.status IS DISTINCT FROM 'joined')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT m.id, m.format, m.facility_id, m.sport_id, m.court_status,
         m.match_date, m.start_time, m.timezone, m.cancelled_at,
         f.name AS facility_name, f.timezone AS facility_tz
    INTO v_match
    FROM public.match m
    LEFT JOIN public.facility f ON f.id = m.facility_id
   WHERE m.id = NEW.match_id;

  IF NOT FOUND OR v_match.cancelled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF v_match.facility_id IS NULL THEN RETURN NEW; END IF;
  IF v_match.court_status IS NOT DISTINCT FROM 'reserved'::public.court_status_enum THEN RETURN NEW; END IF;

  v_capacity := CASE WHEN v_match.format = 'doubles'::public.match_format_enum THEN 4 ELSE 2 END;
  SELECT count(*) INTO v_joined
    FROM public.match_participant
   WHERE match_id = v_match.id AND status = 'joined';
  IF v_joined < v_capacity THEN RETURN NEW; END IF;

  v_tz := coalesce(v_match.facility_tz, v_match.timezone, 'UTC');
  v_slot_start := (v_match.match_date + v_match.start_time) AT TIME ZONE v_tz;
  IF v_slot_start <= now() THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facility_availability_snapshot s
     WHERE s.facility_id = v_match.facility_id
       AND s.sport_id = v_match.sport_id
       AND s.is_available
       AND s.slot_start > now()
       AND s.slot_start < now() + interval '8 days'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_conv FROM public.conversation WHERE match_id = v_match.id;
  IF v_conv IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.message
     WHERE conversation_id = v_conv
       AND message_type = 'court_booking_prompt'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(p.first_name, p.display_name, 'A player') INTO v_joiner
    FROM public.profile p WHERE p.id = NEW.player_id;

  INSERT INTO public.message (conversation_id, sender_id, content, message_type, metadata, status)
  VALUES (
    v_conv,
    c_system_sender,
    coalesce(v_joiner, 'A player') || ' joined — your match is full! Tap to book a court 🎯',
    'court_booking_prompt',
    jsonb_build_object('match_id', v_match.id, 'facility_name', v_match.facility_name,
                       'suppress_notification_for', NEW.player_id),
    'sent'
  );

  RETURN NEW;
END;
$$;

COMMIT;
