-- ============================================================================
-- Chat — make room for a second conversation per tournament
-- ============================================================================
-- The scheduling funnel needs a pool room: one conversation per (tournament,
-- pool). Today that is impossible, because conversation_tournament_id_unique
-- is UNIQUE (tournament_id) WHERE tournament_id IS NOT NULL. Exactly one
-- conversation may carry a tournament id, and it is the event-wide room.
--
-- This migration ONLY makes room. Nothing here creates a pool room, and no
-- behaviour changes for any existing tournament: with tournament_pool_number
-- NULL everywhere, every query below matches exactly the rows it matched
-- before. The pool room itself is the next slice.
--
-- ---------------------------------------------------------------------------
-- Why the index cannot simply be widened
-- ---------------------------------------------------------------------------
-- A plain UNIQUE (tournament_id, tournament_pool_number) would NOT hold the
-- line that matters: NULLs are distinct in a Postgres unique index, so it
-- would happily allow two event rooms for the same tournament. The guarantee
-- is split in two instead, one index per shape:
--
--   * one event room per tournament   (pool number IS NULL)
--   * one room per pool per tournament (pool number IS NOT NULL)
--
-- ---------------------------------------------------------------------------
-- The readers, and why each one is dangerous
-- ---------------------------------------------------------------------------
-- Five functions find the event room by tournament_id alone. Once a second
-- conversation carries that id, each silently widens to match pool rooms too,
-- and two of them corrupt data rather than erroring:
--
--   sync_tournament_chat_registration   would add every new registrant to
--                                       pool rooms they do not belong to
--   sync_tournament_chat_title          would rename every pool room to the
--                                       tournament's name
--   sync_tournament_chat_co_organizer   same membership problem, co-organizers
--   lt_get_or_create_tournament_chat    could return a pool room as "the
--                                       tournament chat"
--   create_tournament_chat_for_new_...  its existence check stops meaning what
--                                       it means
--
-- Each gains `AND tournament_pool_number IS NULL` and nothing else. Bodies are
-- taken from pg_get_functiondef on the live database, which is the definitive
-- latest version, rather than reassembled from migration history.
--
-- Two of them also carry `ON CONFLICT (tournament_id) WHERE tournament_id IS
-- NOT NULL`, an inference clause naming the very index being dropped. Left
-- alone they would fail outright at the next insert with "no unique or
-- exclusion constraint matching the ON CONFLICT specification", so their
-- predicates are updated to match the new event-room index exactly.
--
-- Not patched, verified as safe because they do not look the room up by
-- tournament_id: get_player_conversations_filtered,
-- get_player_conversations_optimized, lt_send_tournament_deadline_nudges.
-- ============================================================================

ALTER TABLE public.conversation
    ADD COLUMN IF NOT EXISTS tournament_pool_number smallint;

COMMENT ON COLUMN public.conversation.tournament_pool_number IS
'Set on a pool room: which pool of tournament_id it belongs to. NULL on the
event-wide tournament room, which is what every pre-funnel reader means by
"the tournament conversation".';

-- A pool number without a tournament would be meaningless.
ALTER TABLE public.conversation
    DROP CONSTRAINT IF EXISTS conversation_pool_number_needs_tournament;
ALTER TABLE public.conversation
    ADD CONSTRAINT conversation_pool_number_needs_tournament
    CHECK (tournament_pool_number IS NULL OR tournament_id IS NOT NULL);

DROP INDEX IF EXISTS public.conversation_tournament_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_tournament_event_room_unique
    ON public.conversation (tournament_id)
    WHERE tournament_id IS NOT NULL AND tournament_pool_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_tournament_pool_room_unique
    ON public.conversation (tournament_id, tournament_pool_number)
    WHERE tournament_pool_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. create_tournament_chat_for_new_tournament
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tournament_chat_for_new_tournament()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id uuid;
BEGIN
  INSERT INTO public.conversation (conversation_type, tournament_id, created_by, title)
  VALUES ('tournament'::public.conversation_type, NEW.id, NEW.organizer_id, NEW.name)
  ON CONFLICT (tournament_id)
    WHERE tournament_id IS NOT NULL AND tournament_pool_number IS NULL
  DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id
    FROM public.conversation
    WHERE tournament_id = NEW.id
      AND tournament_pool_number IS NULL;
  END IF;

  IF NEW.organizer_id IS NOT NULL AND v_conversation_id IS NOT NULL THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, NEW.organizer_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. lt_get_or_create_tournament_chat
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_get_or_create_tournament_chat(p_tournament_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id uuid;
  v_organizer uuid;
  v_name text;
BEGIN
  SELECT id INTO v_conversation_id
  FROM public.conversation
  WHERE tournament_id = p_tournament_id
    AND tournament_pool_number IS NULL;
  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  SELECT organizer_id, name INTO v_organizer, v_name
  FROM public.tournaments WHERE id = p_tournament_id;
  IF v_organizer IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.conversation (conversation_type, tournament_id, created_by, title)
  VALUES ('tournament'::public.conversation_type, p_tournament_id, v_organizer, v_name)
  ON CONFLICT (tournament_id)
    WHERE tournament_id IS NOT NULL AND tournament_pool_number IS NULL
  DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id
    FROM public.conversation
    WHERE tournament_id = p_tournament_id
      AND tournament_pool_number IS NULL;
  END IF;

  IF v_conversation_id IS NOT NULL THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, v_organizer)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_conversation_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. sync_tournament_chat_co_organizer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tournament_chat_co_organizer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tournament_id uuid := COALESCE(NEW.tournament_id, OLD.tournament_id);
  v_conversation_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_conversation_id := public.lt_get_or_create_tournament_chat(v_tournament_id);
    IF v_conversation_id IS NOT NULL THEN
      INSERT INTO public.conversation_participant (conversation_id, player_id)
      VALUES (v_conversation_id, NEW.user_id)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: remove unless they remain a member for another reason
  SELECT id INTO v_conversation_id
  FROM public.conversation
  WHERE tournament_id = v_tournament_id
    AND tournament_pool_number IS NULL;
  IF v_conversation_id IS NULL THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.conversation_participant cp
  WHERE cp.conversation_id = v_conversation_id
    AND cp.player_id = OLD.user_id
    AND cp.player_id IS DISTINCT FROM
        (SELECT t.organizer_id FROM public.tournaments t WHERE t.id = v_tournament_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_registrations r
      WHERE r.tournament_id = v_tournament_id
        AND r.status = 'registered'
        AND (r.user_id = cp.player_id OR r.partner_user_id = cp.player_id)
    );

  RETURN OLD;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. sync_tournament_chat_registration
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tournament_chat_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tournament_id uuid := COALESCE(NEW.tournament_id, OLD.tournament_id);
  v_conversation_id uuid;
  v_old uuid[] := '{}';
  v_new uuid[] := '{}';
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.status = 'registered' THEN
    v_old := array_remove(ARRAY[OLD.user_id, OLD.partner_user_id], NULL);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status = 'registered' THEN
    v_new := array_remove(ARRAY[NEW.user_id, NEW.partner_user_id], NULL);
  END IF;
  IF v_old = v_new THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_new = '{}' THEN
    -- Remove-only path: a missing conversation (e.g. cascade from tournament
    -- DELETE) just means there's nothing to do.
    SELECT id INTO v_conversation_id
    FROM public.conversation
    WHERE tournament_id = v_tournament_id
      AND tournament_pool_number IS NULL;
  ELSE
    v_conversation_id := public.lt_get_or_create_tournament_chat(v_tournament_id);
  END IF;

  IF v_conversation_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.conversation_participant (conversation_id, player_id)
  SELECT v_conversation_id, m
  FROM unnest(v_new) m
  WHERE NOT (m = ANY(v_old))
  ON CONFLICT DO NOTHING;

  DELETE FROM public.conversation_participant cp
  WHERE cp.conversation_id = v_conversation_id
    AND cp.player_id IN (SELECT m FROM unnest(v_old) m WHERE NOT (m = ANY(v_new)))
    AND cp.player_id IS DISTINCT FROM
        (SELECT t.organizer_id FROM public.tournaments t WHERE t.id = v_tournament_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_co_organizers co
      WHERE co.tournament_id = v_tournament_id AND co.user_id = cp.player_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_registrations r
      WHERE r.tournament_id = v_tournament_id
        AND r.status = 'registered'
        AND (r.user_id = cp.player_id OR r.partner_user_id = cp.player_id)
    );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. sync_tournament_chat_title
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tournament_chat_title()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.conversation
  SET title = NEW.name, updated_at = now()
  WHERE tournament_id = NEW.id
    AND tournament_pool_number IS NULL
    AND title IS DISTINCT FROM NEW.name;
  RETURN NEW;
END;
$function$;
