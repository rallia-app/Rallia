-- =============================================================================
-- Collapse per-sport announcement channels into ONE global "Rallia" channel
--
-- 20260720140000 seeded one announcement channel per sport, membership synced
-- from player_sport. Product decided announcements should be a single Rallia
-- voice to every player, not sport-scoped. This migration:
--   1. creates one global announcement channel (sport_id NULL),
--   2. enrolls every player and keeps new players enrolled on signup,
--   3. replaces the sport-scoped post RPC with a no-sport one,
--   4. retires the per-sport channels and their player_sport sync triggers.
--
-- Idempotent: the global channel has a fixed id and every step guards itself,
-- so re-running (or running after the seed on prod) converges to one channel.
-- The RLS read-only policies and the "📢 Rallia" push copy key on
-- conversation_type = 'announcement', so they keep working unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The single global announcement channel
-- -----------------------------------------------------------------------------

INSERT INTO public.conversation (id, conversation_type, title, picture_url, created_by)
VALUES (
  'a11a0002-0000-4000-8000-000000000001',
  'announcement',
  'Rallia',
  'https://www.rallia.app/apple-touch-icon.png',
  'a11a0000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Enroll every existing player, then keep new players enrolled on signup
-- -----------------------------------------------------------------------------

INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT 'a11a0002-0000-4000-8000-000000000001', p.id
FROM public.player p
ON CONFLICT (conversation_id, player_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enroll_player_in_global_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.conversation_participant (conversation_id, player_id)
  VALUES ('a11a0002-0000-4000-8000-000000000001', NEW.id)
  ON CONFLICT (conversation_id, player_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enroll_player_in_global_announcement ON public.player;
CREATE TRIGGER trigger_enroll_player_in_global_announcement
  AFTER INSERT ON public.player
  FOR EACH ROW
  EXECUTE FUNCTION public.enroll_player_in_global_announcement();

-- -----------------------------------------------------------------------------
-- 3. The one write path: admins only, posted as Rallia (no sport argument)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_global_announcement(p_content text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_sender constant uuid := 'a11a0000-0000-4000-8000-000000000001';
  c_global_channel constant uuid := 'a11a0002-0000-4000-8000-000000000001';
  v_message_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHORIZED';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_CONTENT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation
    WHERE id = c_global_channel AND conversation_type = 'announcement'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CHANNEL_NOT_FOUND';
  END IF;

  INSERT INTO public.message (conversation_id, sender_id, content, message_type, metadata)
  VALUES (
    c_global_channel,
    c_system_sender,
    btrim(p_content),
    'announcement',
    jsonb_build_object('posted_by', auth.uid())
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_global_announcement(text) TO authenticated;

COMMENT ON FUNCTION public.post_global_announcement IS
  'Admin-only. Posts a message to the single global Rallia announcement channel as the system player. The RLS insert policy blocks all other write paths into announcement conversations.';

-- -----------------------------------------------------------------------------
-- 4. Retire the per-sport channels and their player_sport sync
--
-- The player_sport triggers only ever maintained sport channels; the global
-- channel is maintained by the player-insert trigger above. Deleting the
-- per-sport conversations cascades their participants and messages (both FKs
-- are ON DELETE CASCADE).
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_sync_sport_announcement_participant ON public.player_sport;
DROP FUNCTION IF EXISTS public.sync_sport_announcement_participant();

DROP TRIGGER IF EXISTS trigger_remove_sport_announcement_participant ON public.player_sport;
DROP FUNCTION IF EXISTS public.remove_sport_announcement_participant();

DELETE FROM public.conversation
WHERE conversation_type = 'announcement'
  AND sport_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.post_sport_announcement(uuid, text);
