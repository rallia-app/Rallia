-- Migration: only create a match chat once a non-creator actually joins
--
-- Before (20260426120000): a match conversation was created eagerly the moment
-- the match was inserted (trigger match_chat_create), seeding the host as the
-- sole participant. Result: ~79% of conversations in prod are empty shells —
-- one per match, including the many matches nobody ever joined. They clutter
-- the inbox query and inflate every conversation metric.
--
-- After: the conversation is created the FIRST time a participant other than
-- the creator reaches status='joined'. A match with only its host has no one
-- to talk to, so no chat exists. When the first real participant joins, the
-- chat is created and BOTH the host and the joiner are seeded into it, so the
-- thread is ready from message #1.
--
-- Why this is safe on the client: the match-detail chat button and the chat
-- screen are both gated on the conversation existing (getMatchChat returns null
-- gracefully, button is hidden when matchConversationId is null). There is no
-- code path that sends a message before a non-creator has joined, so deferring
-- creation cannot orphan a send. No client changes are required.
--
-- The host's own match_participant row (inserted with status='joined' by the
-- create_host_participant trigger at match creation) must NOT spawn a chat —
-- that is the exact carve-out added to the sync function below.

BEGIN;

-- =============================================================================
-- 1. Stop creating the chat at match-insert time.
-- =============================================================================

DROP TRIGGER IF EXISTS match_chat_create ON public.match;
DROP FUNCTION IF EXISTS public.create_match_chat_for_new_match();

-- =============================================================================
-- 2. Lazy-create the chat on the first NON-host join.
--    (supersedes the body from 20260426120000)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_match_chat_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_match_host uuid;
  v_should_add boolean := false;
  v_should_remove boolean := false;
  v_match_id uuid;
  v_player_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_match_id := OLD.match_id;
    v_player_id := OLD.player_id;
    v_should_remove := (OLD.status = 'joined');
  ELSIF TG_OP = 'INSERT' THEN
    v_match_id := NEW.match_id;
    v_player_id := NEW.player_id;
    v_should_add := (NEW.status = 'joined');
  ELSE  -- UPDATE
    v_match_id := NEW.match_id;
    v_player_id := NEW.player_id;
    v_should_add := (NEW.status = 'joined' AND OLD.status IS DISTINCT FROM 'joined');
    v_should_remove := (OLD.status = 'joined' AND NEW.status IS DISTINCT FROM 'joined');
  END IF;

  IF NOT v_should_add AND NOT v_should_remove THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- The host owns the chat; needed by both the create-guard and the
  -- never-remove-the-host rule below.
  SELECT created_by INTO v_match_host FROM public.match WHERE id = v_match_id;

  SELECT id INTO v_conversation_id
  FROM public.conversation
  WHERE match_id = v_match_id;

  -- Create the chat the first time a participant OTHER than the creator joins.
  -- A host-only match (the creator's own 'joined' row at match creation) has no
  -- one to talk to, so no chat is created here — this is what keeps empty match
  -- chats from being generated. On the remove path a missing conversation just
  -- means there's nothing to do.
  IF v_conversation_id IS NULL
     AND v_should_add
     AND v_match_host IS NOT NULL
     AND v_player_id IS DISTINCT FROM v_match_host THEN
    INSERT INTO public.conversation (conversation_type, match_id, created_by)
    VALUES ('match'::public.conversation_type, v_match_id, v_match_host)
    ON CONFLICT (match_id) WHERE match_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conversation_id;
    IF v_conversation_id IS NULL THEN
      SELECT id INTO v_conversation_id FROM public.conversation WHERE match_id = v_match_id;
    END IF;
    -- Seed the host so they're in the thread alongside the first joiner.
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, v_match_host)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_conversation_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_should_add THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, v_player_id)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_should_remove THEN
    -- Don't remove the host even if their match_participant row went away.
    IF v_match_host IS DISTINCT FROM v_player_id THEN
      DELETE FROM public.conversation_participant
      WHERE conversation_id = v_conversation_id
        AND player_id = v_player_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger binding is unchanged (AFTER INSERT OR UPDATE OF status OR DELETE on
-- match_participant); CREATE OR REPLACE swaps the body in place. Re-assert it
-- here so this migration is self-contained.
DROP TRIGGER IF EXISTS match_chat_sync_participant_iud ON public.match_participant;
CREATE TRIGGER match_chat_sync_participant_iud
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.match_participant
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_match_chat_participant();

COMMIT;
