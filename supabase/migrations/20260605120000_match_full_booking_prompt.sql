-- Migration: post a "book your court" prompt into the match chat when a match
-- fills up and no court is reserved yet, and a "court booked" confirmation when
-- one is. Both are system messages from a dedicated "Rallia" sender, so the
-- existing notify_new_message trigger pushes them to ALL participants (the host
-- included — only the sender is excluded from notifications).
--
-- Why a DB trigger on match_participant (not the client joinMatch path): it
-- catches every way a match fills — direct join, host accepting a request, and
-- waitlist re-fill — and runs server-side so it can post as a non-participant
-- system sender (the message INSERT RLS requires sender_id = auth.uid()).

BEGIN;

-- =============================================================================
-- 1. Message: type + structured metadata so the chat can render a rich card
--    (court booking prompt / booked confirmation) instead of a plain bubble.
--    'user' is the default for every normal message.
-- =============================================================================

ALTER TABLE public.message
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'user';
ALTER TABLE public.message
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- =============================================================================
-- 2. Match: who is responsible for booking the court (defaults to host; the
--    Phase 2 claim/confirm RPCs manage this). Nullable now — null means host.
-- =============================================================================

ALTER TABLE public.match
  ADD COLUMN IF NOT EXISTS booking_captain_id uuid REFERENCES public.player(id) ON DELETE SET NULL;

-- =============================================================================
-- 3. System sender "Rallia" (fixed id). The id chain is auth.users -> profile ->
--    player -> message.sender_id, so we seed an auth user first (its
--    on_auth_user_created trigger creates the profile, but leaves first_name
--    NULL for email signups), then stamp the Rallia identity, then the player.
--    is_active = false keeps it out of active-user feeds; it is never a
--    conversation participant, so every real participant gets notified.
-- =============================================================================

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a11a0000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'system@rallia.app',
  '{"provider":"system"}'::jsonb, '{}'::jsonb, now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- NB: deliberately do NOT touch onboarding_completed — flipping it to true fires
-- notify_welcome_email (would email system@rallia.app on prod). is_active = false
-- already keeps this profile out of user-facing feeds.
INSERT INTO public.profile (id, email, first_name, display_name, is_active)
VALUES ('a11a0000-0000-4000-8000-000000000001', 'system@rallia.app', 'Rallia', 'Rallia', false)
ON CONFLICT (id) DO UPDATE
  SET first_name = 'Rallia', display_name = 'Rallia', is_active = false;

INSERT INTO public.player (id)
VALUES ('a11a0000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4. Fill prompt: when a participant becomes 'joined' and the match is now full
--    with no reserved court, post one court_booking_prompt into the match chat.
-- =============================================================================

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
  -- Only act when a participant transitions INTO 'joined'.
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

  -- Full? singles = 2, doubles = 4 (host is a joined participant).
  v_capacity := CASE WHEN v_match.format = 'doubles'::public.match_format_enum THEN 4 ELSE 2 END;
  SELECT count(*) INTO v_joined
    FROM public.match_participant
   WHERE match_id = v_match.id AND status = 'joined';
  IF v_joined < v_capacity THEN RETURN NEW; END IF;

  v_tz := coalesce(v_match.facility_tz, v_match.timezone, 'UTC');
  v_slot_start := (v_match.match_date + v_match.start_time) AT TIME ZONE v_tz;
  IF v_slot_start <= now() THEN RETURN NEW; END IF;

  -- Only for online-bookable facilities: those with upcoming snapshot
  -- availability for this sport. Non-integrated facilities (parks, etc.) have
  -- nothing to offer, so we stay quiet. The exact slot may be full here — the
  -- in-app card falls back to nearby facilities.
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

  -- At most one prompt per match conversation.
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
    jsonb_build_object('match_id', v_match.id, 'facility_name', v_match.facility_name),
    'sent'
  );

  RETURN NEW;
END;
$$;

-- Name sorts AFTER match_chat_sync_participant_iud so the just-joined player is
-- already a conversation_participant when notify_new_message fans out.
DROP TRIGGER IF EXISTS match_full_booking_prompt ON public.match_participant;
CREATE TRIGGER match_full_booking_prompt
  AFTER INSERT OR UPDATE OF status ON public.match_participant
  FOR EACH ROW
  EXECUTE FUNCTION public.post_match_full_booking_prompt();

-- =============================================================================
-- 5. Booked confirmation: when court_status flips to 'reserved' on a match we
--    previously prompted, post a court_booked card. auth.uid() is the booker
--    (host today; the captain in Phase 2), with sensible fallbacks.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.post_match_court_booked_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_sender constant uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_conv     uuid;
  v_booker   text;
  v_court    text;
  v_facility text;
BEGIN
  IF NOT (NEW.court_status = 'reserved'::public.court_status_enum
          AND OLD.court_status IS DISTINCT FROM 'reserved'::public.court_status_enum) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_conv FROM public.conversation WHERE match_id = NEW.id;
  IF v_conv IS NULL THEN RETURN NEW; END IF;

  -- Only confirm if we actually prompted, and only once.
  IF NOT EXISTS (SELECT 1 FROM public.message WHERE conversation_id = v_conv AND message_type = 'court_booking_prompt' AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.message WHERE conversation_id = v_conv AND message_type = 'court_booked' AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(p.first_name, p.display_name, 'Someone') INTO v_booker
    FROM public.profile p WHERE p.id = coalesce(auth.uid(), NEW.booking_captain_id, NEW.created_by);
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
    jsonb_build_object('match_id', NEW.id, 'court_label', v_court, 'facility_name', v_facility, 'booked_by', v_booker),
    'sent'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_court_booked_message ON public.match;
CREATE TRIGGER match_court_booked_message
  AFTER UPDATE OF court_status ON public.match
  FOR EACH ROW
  EXECUTE FUNCTION public.post_match_court_booked_message();

COMMIT;
