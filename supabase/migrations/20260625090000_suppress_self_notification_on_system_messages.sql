-- Migration: stop a system message from notifying the very person it is about.
--
-- When a join fills a match, post_match_full_booking_prompt posts a "X joined —
-- your match is full!" system message. notify_new_message fans that out to every
-- conversation participant except the sender (the Rallia system user). The
-- just-joined player is already a conversation participant (the sync trigger runs
-- first), so they got a push announcing their OWN join — wrong: it is meant for
-- the other participants (in singles, just the host).
--
-- Fix: let a system message carry metadata.suppress_notification_for = <player_id>
-- and have notify_new_message skip that participant too. Applied to both system
-- messages (fill prompt -> the joiner; court booked -> the booker).

BEGIN;

-- notify_new_message: also skip the participant a system message is about.
create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
begin
  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  v_preview := left(NEW.content, 100);

  insert into notification (user_id, type, target_id, title, body, payload, priority, read_at)
  select
    cp.player_id,
    'new_message'::notification_type_enum,
    NEW.conversation_id,
    'Message from ' || v_sender_name,
    v_preview,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'senderName', v_sender_name,
      'messagePreview', v_preview
    ),
    'normal'::notification_priority_enum,
    now()
  from conversation_participant cp
  left join active_conversation ac on ac.player_id = cp.player_id
  where cp.conversation_id = NEW.conversation_id
    and cp.player_id != NEW.sender_id
    and cp.player_id is distinct from (NEW.metadata->>'suppress_notification_for')::uuid
    and cp.is_muted = false
    and (
      ac.player_id is null
      or ac.conversation_id is distinct from NEW.conversation_id
      or ac.active_at <= now() - interval '60 seconds'
    );

  return NEW;
end;
$$ language plpgsql security definer;

-- Fill prompt: tag the joiner so they are not notified about their own join.
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
    coalesce(v_joiner, 'A player') || ' joined — your match is full! Tap to book a court 🎾',
    'court_booking_prompt',
    jsonb_build_object('match_id', v_match.id, 'facility_name', v_match.facility_name,
                       'suppress_notification_for', NEW.player_id),
    'sent'
  );

  RETURN NEW;
END;
$$;

-- Booked confirmation: tag the booker so they are not notified about their own booking.
CREATE OR REPLACE FUNCTION public.post_match_court_booked_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_sender constant uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_conv      uuid;
  v_booker_id uuid;
  v_booker    text;
  v_court     text;
  v_facility  text;
BEGIN
  IF NOT (NEW.court_status = 'reserved'::public.court_status_enum
          AND OLD.court_status IS DISTINCT FROM 'reserved'::public.court_status_enum) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_conv FROM public.conversation WHERE match_id = NEW.id;
  IF v_conv IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.message WHERE conversation_id = v_conv AND message_type = 'court_booking_prompt' AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.message WHERE conversation_id = v_conv AND message_type = 'court_booked' AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  v_booker_id := coalesce(auth.uid(), NEW.booking_captain_id, NEW.created_by);
  SELECT coalesce(p.first_name, p.display_name, 'Someone') INTO v_booker
    FROM public.profile p WHERE p.id = v_booker_id;
  SELECT coalesce(c.name, 'Court ' || c.court_number::text, 'the court') INTO v_court
    FROM public.court c WHERE c.id = NEW.court_id;
  SELECT f.name INTO v_facility FROM public.facility f WHERE f.id = NEW.facility_id;

  INSERT INTO public.message (conversation_id, sender_id, content, message_type, metadata, status)
  VALUES (
    v_conv,
    c_system_sender,
    '✅ ' || coalesce(v_booker, 'Someone') || ' booked ' || coalesce(v_court, 'the court')
      || coalesce(' at ' || v_facility, ''),
    'court_booked',
    jsonb_build_object('match_id', NEW.id, 'court_label', v_court, 'facility_name', v_facility,
                       'booked_by', v_booker, 'suppress_notification_for', v_booker_id),
    'sent'
  );

  RETURN NEW;
END;
$$;

COMMIT;
