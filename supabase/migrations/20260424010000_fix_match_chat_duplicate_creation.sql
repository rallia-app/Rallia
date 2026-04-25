-- Fix duplicate match chats created on every non-creator join.
--
-- Root cause: the `conversation` SELECT RLS policy only exposes rows to the
-- creator or existing participants. When a new player joins a match, the
-- client-side `ensureMatchChat` helper fetches the existing conversation under
-- that user's JWT; RLS hides the row, so the helper falls through to the
-- create branch and inserts a duplicate. There is no UNIQUE constraint on
-- `conversation.match_id`, so the duplicate insert succeeds.
--
-- Fix:
--   1. Deduplicate existing rows (keep oldest per match_id; move messages and
--      participants onto it).
--   2. Add a partial UNIQUE index on conversation.match_id.
--   3. Expand the SELECT policy so joined match participants can see the
--      conversation tied to their match.

-- -----------------------------------------------------------------------------
-- 1. Deduplicate existing match conversations
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  mid uuid;
  keep_id uuid;
BEGIN
  FOR mid IN
    SELECT match_id
    FROM public.conversation
    WHERE match_id IS NOT NULL
    GROUP BY match_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id
    INTO keep_id
    FROM public.conversation
    WHERE match_id = mid
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Re-home messages onto the kept conversation
    UPDATE public.message
    SET conversation_id = keep_id
    WHERE conversation_id IN (
      SELECT id
      FROM public.conversation
      WHERE match_id = mid AND id <> keep_id
    );

    -- Merge participant rows (UNIQUE(conversation_id, player_id) dedupes)
    INSERT INTO public.conversation_participant (conversation_id, player_id)
    SELECT keep_id, cp.player_id
    FROM public.conversation_participant cp
    JOIN public.conversation c ON c.id = cp.conversation_id
    WHERE c.match_id = mid AND c.id <> keep_id
    ON CONFLICT DO NOTHING;

    -- Delete duplicates (cascades to remaining participant rows)
    DELETE FROM public.conversation
    WHERE match_id = mid AND id <> keep_id;
  END LOOP;
END$$;

-- -----------------------------------------------------------------------------
-- 2. Enforce one conversation per match at the DB level
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS conversation_match_id_unique
  ON public.conversation (match_id)
  WHERE match_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Let joined match participants read their match's conversation
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversation;

CREATE POLICY "Participants can view conversations"
  ON public.conversation FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR is_conversation_participant(id, auth.uid())
    OR (
      match_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.match_participant mp
        WHERE mp.match_id = conversation.match_id
          AND mp.player_id = auth.uid()
          AND mp.status = 'joined'
      )
    )
  );
