-- =============================================================================
-- Sport announcement channels
--
-- One read-only broadcast conversation per sport, holding every player of that
-- sport. Admins post through post_sport_announcement(); nobody can write to an
-- announcement conversation directly.
--
-- Membership is materialized as real conversation_participant rows rather than
-- special-cased in RLS, so unread counts, mute, pin, archive, realtime and the
-- notification fan-out all keep working unchanged. Message volume in these
-- channels is admin-gated, so the per-participant notification fan-out stays
-- proportionate.
--
-- conversation_type 'announcement' has existed in the enum since the initial
-- schema and was never used, so no ALTER TYPE is needed here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Link conversations to a sport
-- -----------------------------------------------------------------------------

ALTER TABLE public.conversation
  ADD COLUMN IF NOT EXISTS sport_id uuid REFERENCES public.sport(id) ON DELETE CASCADE;

-- At most one announcement channel per sport.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_announcement_sport
  ON public.conversation (sport_id)
  WHERE conversation_type = 'announcement';

COMMENT ON COLUMN public.conversation.sport_id IS
  'Sport this conversation belongs to. Set for announcement channels; NULL elsewhere.';

-- -----------------------------------------------------------------------------
-- 2. Seed one channel per active sport, owned by the Rallia system player
-- -----------------------------------------------------------------------------

INSERT INTO public.conversation (conversation_type, title, sport_id, created_by)
SELECT
  'announcement'::conversation_type,
  coalesce(s.display_name, s.name),
  s.id,
  'a11a0000-0000-4000-8000-000000000001'::uuid
FROM public.sport s
WHERE s.is_active IS NOT FALSE
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Keep membership in sync with player_sport
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_sport_announcement_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  SELECT c.id INTO v_conversation_id
  FROM public.conversation c
  WHERE c.conversation_type = 'announcement'
    AND c.sport_id = NEW.sport_id;

  IF v_conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_active IS NOT FALSE THEN
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    VALUES (v_conversation_id, NEW.player_id)
    ON CONFLICT (conversation_id, player_id) DO NOTHING;
  ELSE
    DELETE FROM public.conversation_participant
    WHERE conversation_id = v_conversation_id
      AND player_id = NEW.player_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_sport_announcement_participant ON public.player_sport;
CREATE TRIGGER trigger_sync_sport_announcement_participant
  AFTER INSERT OR UPDATE OF is_active ON public.player_sport
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_sport_announcement_participant();

-- Drop the participant row when a player drops the sport entirely.
CREATE OR REPLACE FUNCTION public.remove_sport_announcement_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.conversation_participant cp
  USING public.conversation c
  WHERE c.id = cp.conversation_id
    AND c.conversation_type = 'announcement'
    AND c.sport_id = OLD.sport_id
    AND cp.player_id = OLD.player_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_remove_sport_announcement_participant ON public.player_sport;
CREATE TRIGGER trigger_remove_sport_announcement_participant
  AFTER DELETE ON public.player_sport
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_sport_announcement_participant();

-- -----------------------------------------------------------------------------
-- 4. Backfill existing players
-- -----------------------------------------------------------------------------

INSERT INTO public.conversation_participant (conversation_id, player_id)
SELECT c.id, ps.player_id
FROM public.player_sport ps
JOIN public.conversation c
  ON c.conversation_type = 'announcement'
 AND c.sport_id = ps.sport_id
WHERE ps.is_active IS NOT FALSE
ON CONFLICT (conversation_id, player_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Announcement channels are read-only at the RLS layer
--
-- The predicate goes through a SECURITY DEFINER helper rather than an inline
-- subquery on `conversation`. Reading `conversation` under RLS re-enters its
-- own policy, which calls is_conversation_participant(), which reads
-- conversation_participant, whose policy reads `conversation` again — Postgres
-- aborts that with "infinite recursion detected in policy". Same shape, and
-- same fix, as 20260321090000_fix_admin_rls_infinite_recursion.sql.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_announcement_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation c
    WHERE c.id = p_conversation_id
      AND c.conversation_type = 'announcement'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_announcement_conversation(uuid) TO authenticated;

DROP POLICY IF EXISTS "message_insert_policy" ON public.message;
CREATE POLICY "message_insert_policy"
    ON public.message FOR INSERT
    WITH CHECK (
        sender_id = auth.uid()
        AND conversation_id IN (
            SELECT cp.conversation_id
            FROM public.conversation_participant cp
            WHERE cp.player_id = auth.uid()
        )
        AND NOT public.is_announcement_conversation(message.conversation_id)
    );

-- The two policies below are AMENDED IN PLACE rather than added alongside.
-- Postgres ORs permissive policies together, so a new restrictive policy next
-- to a permissive one grants nothing — the existing policy would still allow
-- the very thing we are trying to forbid. Names must match the live ones from
-- 20260116240000_fix_conversation_participant_rls.sql exactly.

-- "Users can view co-participants" exposes every co-participant's row. In an
-- announcement channel that is the entire user base, so exclude it there;
-- "Users can view own participations" still covers your own row.
DROP POLICY IF EXISTS "Users can view co-participants" ON public.conversation_participant;
CREATE POLICY "Users can view co-participants"
    ON public.conversation_participant FOR SELECT
    USING (
        conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
        AND NOT public.is_announcement_conversation(conversation_participant.conversation_id)
    );

-- Players must not be able to leave a channel they were auto-enrolled in;
-- muting is the supported opt-out.
DROP POLICY IF EXISTS "Users can leave conversations" ON public.conversation_participant;
CREATE POLICY "Users can leave conversations"
    ON public.conversation_participant FOR DELETE
    USING (
        player_id = auth.uid()
        AND NOT public.is_announcement_conversation(conversation_participant.conversation_id)
    );

-- -----------------------------------------------------------------------------
-- 6. The one write path: admins only, posted as Rallia
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_sport_announcement(
  p_sport_id uuid,
  p_content  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_sender constant uuid := 'a11a0000-0000-4000-8000-000000000001';
  v_conversation_id uuid;
  v_message_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHORIZED';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_CONTENT';
  END IF;

  SELECT c.id INTO v_conversation_id
  FROM public.conversation c
  WHERE c.conversation_type = 'announcement'
    AND c.sport_id = p_sport_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CHANNEL_NOT_FOUND';
  END IF;

  INSERT INTO public.message (conversation_id, sender_id, content, message_type, metadata)
  VALUES (
    v_conversation_id,
    c_system_sender,
    btrim(p_content),
    'announcement',
    jsonb_build_object('posted_by', auth.uid())
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_sport_announcement(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.post_sport_announcement IS
  'Admin-only. Posts a message to a sport announcement channel as the Rallia system player. The RLS insert policy blocks all other write paths into announcement conversations.';

-- -----------------------------------------------------------------------------
-- 7. Announcement-aware push copy
--
-- Otherwise every announcement pushes as "Message from Rallia". Everything else
-- is unchanged from 20260716160000.
-- -----------------------------------------------------------------------------

create or replace function notify_new_message()
returns trigger as $$
declare
  v_sender_name text;
  v_preview     text;
  v_is_announcement boolean;
  v_channel_title text;
  v_max_len     constant int := 178;
begin
  select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), p.first_name, 'Someone')
    into v_sender_name
    from profile p where p.id = NEW.sender_id;

  select c.conversation_type = 'announcement', c.title
    into v_is_announcement, v_channel_title
    from conversation c where c.id = NEW.conversation_id;

  v_preview := CASE
    WHEN char_length(NEW.content) > v_max_len
      THEN rtrim(left(NEW.content, v_max_len), E' \t\n\r') || '…'
    ELSE NEW.content
  END;

  insert into notification (user_id, type, target_id, title, body, payload, priority, read_at)
  select
    cp.player_id,
    'new_message'::notification_type_enum,
    NEW.conversation_id,
    CASE
      WHEN v_is_announcement AND public.lt_user_is_fr(cp.player_id)
        THEN 'Annonce ' || v_channel_title
      WHEN v_is_announcement
        THEN v_channel_title || ' announcement'
      WHEN public.lt_user_is_fr(cp.player_id)
        THEN 'Message de ' || v_sender_name
      ELSE 'Message from ' || v_sender_name
    END,
    v_preview,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'senderName', v_sender_name,
      'messagePreview', v_preview,
      'messageType', NEW.message_type,
      'facilityName', NEW.metadata->>'facility_name',
      'courtLabel', NEW.metadata->>'court_label'
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
