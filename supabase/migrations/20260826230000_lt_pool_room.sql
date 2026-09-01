-- ============================================================================
-- Scheduling funnel, slice 3 — the pool room
-- ============================================================================
-- One conversation per (tournament, pool): the lobby a player lands in when
-- the pools are published. Slice 2 closed the pairing rooms until both sides
-- answer the gate, which would leave a player with nowhere to be; this is
-- where they wait, see who they face and what the deadline is, and meet the
-- gate. Spec: specs/17-leagues-tournaments/scheduling-funnel.md § 4.
--
-- Three parts, and the third is the forcing function:
--
--   1. lt_ensure_pool_room: get-or-create the room, put the pool's players and
--      the organizer in it, post the welcome once. Idempotent throughout, so
--      it can be called per pool row without caring how many times.
--   2. A trigger on pool rows, so the room exists however the pools were
--      generated rather than only through one RPC.
--   3. The composer lock: a member who has not answered the gate can READ the
--      room but cannot post in it. § 4: the board and the feed stay visible
--      because they need to know who and when; the composer is what closes.
--
-- Gated on tournaments.scheduling_funnel_enabled throughout, so nothing
-- changes for an event that started before the gate existed. The uniqueness
-- split that made a second conversation per tournament possible landed
-- separately in 20260826220000.
--
-- The title is the tournament's name, exactly like a round chat: a
-- conversation title is shared by every reader, so the pool number is left for
-- the client to render from tournament_pool_number rather than baked into
-- shared data in one language.
-- ============================================================================

-- One welcome post per room, mirroring the organizer card's own guard.
CREATE UNIQUE INDEX IF NOT EXISTS message_pool_room_welcome_unique
    ON public.message (conversation_id)
    WHERE message_type = 'pool_room_welcome'
      AND (metadata ->> 'posted_by') = 'system'
      AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- The room
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lt_ensure_pool_room(
    p_tournament_id uuid,
    p_pool_number   smallint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t      tournaments;
    v_conv   uuid;
    v_player uuid;
BEGIN
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL OR p_pool_number IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_conv FROM conversation
     WHERE tournament_id = p_tournament_id
       AND tournament_pool_number = p_pool_number;

    IF v_conv IS NULL THEN
        INSERT INTO conversation (conversation_type, tournament_id, tournament_pool_number,
                                  created_by, title)
        VALUES ('tournament'::conversation_type, p_tournament_id, p_pool_number,
                v_t.organizer_id, v_t.name)
        ON CONFLICT (tournament_id, tournament_pool_number)
          WHERE tournament_pool_number IS NOT NULL
        DO NOTHING
        RETURNING id INTO v_conv;

        IF v_conv IS NULL THEN
            SELECT id INTO v_conv FROM conversation
             WHERE tournament_id = p_tournament_id
               AND tournament_pool_number = p_pool_number;
        END IF;
    END IF;

    IF v_conv IS NULL THEN
        RETURN NULL;
    END IF;

    -- Members: everyone drawn into this pool, plus the organizer. Derived from
    -- the pool's own rows, so a pool that gains a player later gains them here
    -- the next time this runs.
    FOR v_player IN
        SELECT DISTINCT u
          FROM tournament_matches tm
          JOIN tournament_registrations r
            ON r.id IN (tm.player1_registration_id, tm.player2_registration_id)
         CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) AS u
         WHERE tm.tournament_id = p_tournament_id
           AND tm.pool_number   = p_pool_number
    LOOP
        INSERT INTO conversation_participant (conversation_id, player_id)
        VALUES (v_conv, v_player)
        ON CONFLICT DO NOTHING;
    END LOOP;

    IF v_t.organizer_id IS NOT NULL THEN
        INSERT INTO conversation_participant (conversation_id, player_id)
        VALUES (v_conv, v_t.organizer_id)
        ON CONFLICT DO NOTHING;
    END IF;

    -- The welcome says the one thing a player cannot discover on their own:
    -- what is said here does not count as evidence. Once per room.
    INSERT INTO message (conversation_id, sender_id, content, status, message_type, metadata)
    VALUES (v_conv, v_t.organizer_id,
            'Bienvenue dans ta poule. Donne tes disponibilités pour débloquer '
            || 'tes conversations de match. Ce qui s''écrit ici n''entre pas '
            || 'dans les décisions automatiques à l''échéance.',
            'sent', 'pool_room_welcome',
            jsonb_build_object('posted_by', 'system',
                               'kind', 'pool_room_welcome',
                               'pool_number', p_pool_number))
    ON CONFLICT (conversation_id)
      WHERE message_type = 'pool_room_welcome'
        AND (metadata ->> 'posted_by') = 'system'
        AND deleted_at IS NULL
    DO NOTHING;

    RETURN v_conv;
END;
$$;

COMMENT ON FUNCTION public.lt_ensure_pool_room(uuid, smallint) IS
'Get-or-create the pool room for (tournament, pool): members are the pool''s
players plus the organizer, and the welcome post lands once. Idempotent, so it
is safe to call per pool row. Spec: scheduling-funnel.md § 4.';

-- ---------------------------------------------------------------------------
-- Rooms appear with the pools
-- ---------------------------------------------------------------------------
-- A trigger on the pool rows rather than a call inside tournament_generate_
-- pools: however a pool comes to exist, its room should follow.
CREATE OR REPLACE FUNCTION public.lt_pool_room_on_pool_row_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    IF NEW.pool_number IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT t.scheduling_funnel_enabled INTO v_enabled
      FROM tournaments t WHERE t.id = NEW.tournament_id;
    IF NOT COALESCE(v_enabled, false) THEN
        RETURN NEW;
    END IF;

    -- A room is a convenience; never let it break pool generation.
    BEGIN
        PERFORM public.lt_ensure_pool_room(NEW.tournament_id, NEW.pool_number);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'pool room creation failed for tournament % pool %: %',
            NEW.tournament_id, NEW.pool_number, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_matches_pool_room ON public.tournament_matches;

CREATE TRIGGER tournament_matches_pool_room
    AFTER INSERT ON public.tournament_matches
    FOR EACH ROW
    WHEN (NEW.pool_number IS NOT NULL)
    EXECUTE FUNCTION public.lt_pool_room_on_pool_row_tg();

-- ---------------------------------------------------------------------------
-- The composer lock
-- ---------------------------------------------------------------------------
-- True when this conversation is a pool room whose reader has not yet answered
-- the gate for that pool's phase. The organizer is never locked: they have to
-- be able to speak to a pool that is stalling, which is the whole reason the
-- room exists.
--
-- Reading stays open (§ 4): the board and the feed are how a player learns who
-- they face and by when, so hiding them would remove the reason to answer.
CREATE OR REPLACE FUNCTION public.lt_pool_room_composer_locked(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM conversation c
          JOIN tournaments t ON t.id = c.tournament_id
         WHERE c.id = p_conversation_id
           AND c.tournament_pool_number IS NOT NULL
           AND COALESCE(t.scheduling_funnel_enabled, false)
           AND t.organizer_id IS DISTINCT FROM (SELECT auth.uid())
           AND NOT EXISTS (
                SELECT 1 FROM tournament_phase_availability a
                 WHERE a.tournament_id = c.tournament_id
                   AND a.bracket_side  = 'pool'
                   AND a.round_number  = 0
                   AND a.player_id     = (SELECT auth.uid())
           )
    );
$$;

COMMENT ON FUNCTION public.lt_pool_room_composer_locked(uuid) IS
'True when the caller may read a pool room but not post in it, because they
have not answered the pool phase gate. Organizers are never locked. Only
applies where scheduling_funnel_enabled.';

-- The live policy is AMENDED, never doubled: permissive policies are OR''d, so
-- a second INSERT policy would widen the door rather than narrow it.
ALTER POLICY message_insert_policy ON public.message
    WITH CHECK (
        (sender_id = (SELECT auth.uid()))
        AND (conversation_id IN (
              SELECT cp.conversation_id
                FROM conversation_participant cp
               WHERE cp.player_id = (SELECT auth.uid())))
        AND (NOT is_announcement_conversation(conversation_id))
        AND (NOT public.lt_pool_room_composer_locked(conversation_id))
    );
