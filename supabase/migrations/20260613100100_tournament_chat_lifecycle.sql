-- Tournament chat lifecycle, fully derived from tournament state via triggers.
-- Mirrors the match-chat pattern (20260426120000): one conversation per
-- tournament, organizer + co-organizers always in, entry members (captain +
-- partner) in while their entry is 'registered'. The TS layer never touches
-- tournament chat membership.

BEGIN;

-- =============================================================================
-- 1. conversation.tournament_id + partial unique index
-- =============================================================================

ALTER TABLE public.conversation
  ADD COLUMN IF NOT EXISTS tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_tournament_id_unique
  ON public.conversation(tournament_id) WHERE tournament_id IS NOT NULL;

-- =============================================================================
-- 2. Trigger: create the tournament chat when a tournament is inserted
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_tournament_chat_for_new_tournament()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  INSERT INTO public.conversation (conversation_type, tournament_id, created_by, title)
  VALUES ('tournament'::public.conversation_type, NEW.id, NEW.organizer_id, NEW.name)
  ON CONFLICT (tournament_id) WHERE tournament_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id
    FROM public.conversation
    WHERE tournament_id = NEW.id;
  END IF;

  IF NEW.organizer_id IS NOT NULL AND v_conversation_id IS NOT NULL THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, NEW.organizer_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_chat_create ON public.tournaments;
CREATE TRIGGER tournament_chat_create
  AFTER INSERT ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_tournament_chat_for_new_tournament();

-- =============================================================================
-- 3. Helper: lazy-create the conversation (covers tournaments that predate
--    this migration's backfill window, e.g. created between deploy steps)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lt_get_or_create_tournament_chat(p_tournament_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_organizer uuid;
  v_name text;
BEGIN
  SELECT id INTO v_conversation_id
  FROM public.conversation
  WHERE tournament_id = p_tournament_id;
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
  ON CONFLICT (tournament_id) WHERE tournament_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id
    FROM public.conversation
    WHERE tournament_id = p_tournament_id;
  END IF;

  IF v_conversation_id IS NOT NULL THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, v_organizer)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_conversation_id;
END;
$$;

-- =============================================================================
-- 4. Trigger: conversation membership follows registration state.
--    An entry's members (captain + partner) are chat members only while the
--    entry is 'registered'. Organizer / co-organizers are never auto-removed,
--    nor is a player who is still a member of another registered entry.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_tournament_chat_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE tournament_id = v_tournament_id;
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
$$;

DROP TRIGGER IF EXISTS tournament_chat_sync_registration_iud ON public.tournament_registrations;
CREATE TRIGGER tournament_chat_sync_registration_iud
  AFTER INSERT OR UPDATE OF status, partner_user_id OR DELETE
  ON public.tournament_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tournament_chat_registration();

-- =============================================================================
-- 5. Trigger: co-organizers join/leave the chat with their role
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_tournament_chat_co_organizer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  WHERE tournament_id = v_tournament_id;
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
$$;

DROP TRIGGER IF EXISTS tournament_chat_sync_co_organizer_id ON public.tournament_co_organizers;
CREATE TRIGGER tournament_chat_sync_co_organizer_id
  AFTER INSERT OR DELETE ON public.tournament_co_organizers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tournament_chat_co_organizer();

-- =============================================================================
-- 6. Trigger: conversation title follows the tournament name
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_tournament_chat_title()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversation
  SET title = NEW.name, updated_at = now()
  WHERE tournament_id = NEW.id
    AND title IS DISTINCT FROM NEW.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_chat_sync_title ON public.tournaments;
CREATE TRIGGER tournament_chat_sync_title
  AFTER UPDATE OF name ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tournament_chat_title();

-- =============================================================================
-- 7. Backfill existing tournaments (idempotent)
-- =============================================================================

INSERT INTO public.conversation (conversation_type, tournament_id, created_by, title)
SELECT 'tournament'::public.conversation_type, t.id, t.organizer_id, t.name
FROM public.tournaments t
WHERE t.status NOT IN ('cancelled', 'archived')
ON CONFLICT (tournament_id) WHERE tournament_id IS NOT NULL DO NOTHING;

-- Organizers
INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT c.id, t.organizer_id
FROM public.conversation c
JOIN public.tournaments t ON t.id = c.tournament_id
ON CONFLICT DO NOTHING;

-- Co-organizers
INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT c.id, co.user_id
FROM public.conversation c
JOIN public.tournament_co_organizers co ON co.tournament_id = c.tournament_id
ON CONFLICT DO NOTHING;

-- Members of registered entries (captain + partner)
INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT c.id, m
FROM public.conversation c
JOIN public.tournament_registrations r
  ON r.tournament_id = c.tournament_id AND r.status = 'registered'
CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
ON CONFLICT DO NOTHING;

COMMIT;
