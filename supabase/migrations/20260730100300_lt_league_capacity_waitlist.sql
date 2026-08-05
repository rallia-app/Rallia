-- ============================================================================
-- Leagues — turning the waitlist ON switched the member cap OFF
-- ============================================================================
-- league_join's capacity gate (20260615120000, carried through 20260729110000)
-- reads:
--
--     IF member_capacity IS NOT NULL
--        AND active_count >= member_capacity
--        AND NOT COALESCE(waitlist_enabled, false) THEN
--         RAISE LEAGUE_FULL;
--     END IF;
--
-- With waitlist_enabled = false that is correct. With it TRUE the whole
-- condition goes false and execution falls straight through to the normal
-- insert, so the joiner lands 'active' past the cap. The flag reads as "let
-- overflow join anyway" instead of "send overflow to the waitlist" — the exact
-- inverse of its name. Verified locally: capacity 2, waitlist on, third joiner
-- came back 'active' with 3 active members and 0 waitlist rows.
--
-- league_member_waitlist has existed since the initial schema (20260510165900)
-- with RLS, grants, a UNIQUE (league_id, user_id) and an EXCLUDE keeping
-- positions unique among un-promoted rows — and no code has ever written to it.
-- leagues.md § League capacity & member waitlist specifies the behaviour this
-- migration finally implements.
--
-- After this:
--   * capacity is enforced in BOTH modes — it is a cap, not a suggestion;
--   * waitlist_enabled = false  -> LEAGUE_FULL, unchanged;
--   * waitlist_enabled = true   -> the joiner is queued: a league_member_waitlist
--     row at the next free position, and a league_members row at 'pending'
--     (re-joining while queued keeps the same place, no duplicate row);
--   * a seat opening up promotes the head of the queue and tells them,
--     mirroring tg_session_presence_promote_waitlist on the session side.
--
-- Queued players sit at 'pending' rather than a new 'waitlisted' status. That
-- is what 'pending' already means everywhere else — on the roster, not playing,
-- excluded from is_active_league_member and from the ranking roster — so no
-- enum change, no generated-types churn, and the organizer's existing Requests
-- tab shows them without any client change. The queue row is what distinguishes
-- "waiting for a seat" from "waiting for approval", and it carries the order.
--
-- Returning the pending row rather than raising is load-bearing: a RAISE aborts
-- the whole function call, which would roll back the queue row we just wrote.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_join(p_league_id uuid)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_league         leagues;
    v_initial_status league_member_status;
    v_active_count   integer;
    v_existing       league_members;
    v_row            league_members;
    v_reputation     numeric;
    v_position       integer;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    IF v_league.organizer_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_league.sport_id);

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = p_league_id AND user_id = v_caller_id
     FOR UPDATE;

    -- An organizer invite: accepting it is what Join means for the invitee.
    -- Ahead of ALREADY_MEMBER (which used to swallow this whole branch) and
    -- ahead of the rating and capacity gates, on purpose. An invited player is
    -- also not subject to the cap — the organizer already chose them.
    IF v_existing.id IS NOT NULL
       AND v_existing.status = 'pending'
       AND v_existing.invited_by IS NOT NULL THEN
        UPDATE league_members
           SET status      = 'active',
               approved_at = now(),
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'membership', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
        );
        RETURN v_row;
    END IF;

    -- 'pending' still lands here when invited_by IS NULL: a self-request
    -- awaiting approval, for which ALREADY_MEMBER is the right answer.
    IF v_existing.id IS NOT NULL AND v_existing.status IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_MEMBER';
    END IF;

    -- No invite to accept, so an invite-only league cannot be self-joined.
    IF v_league.join_mode = 'invite_only' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
    END IF;

    -- Rating gate. No-ops when both bounds are NULL, so it is called
    -- unconditionally. assert_caller_plays_sport above already required an
    -- active player_sport row, which is why the helper needs no is_active
    -- filter of its own.
    PERFORM public.lt_assert_rating_band(
        v_caller_id, v_league.sport_id, v_league.min_rating, v_league.max_rating
    );

    -- Reputation gate. Reads player_reputation (the live store); no row means
    -- no events yet, which is a clean record, not a zero.
    IF v_league.min_reputation IS NOT NULL THEN
        SELECT COALESCE(
                 (SELECT pr.reputation_score
                    FROM player_reputation pr
                   WHERE pr.player_id = v_caller_id),
                 100
               )
          INTO v_reputation;

        IF v_reputation < v_league.min_reputation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REPUTATION_GATE_NOT_MET';
        END IF;
    END IF;

    -- Capacity. Counted after the gates so a player who could never join is
    -- told why, rather than being queued behind a rule they don't meet.
    SELECT count(*) INTO v_active_count
      FROM league_members
     WHERE league_id = p_league_id AND status = 'active';

    IF v_league.member_capacity IS NOT NULL
       AND v_active_count >= v_league.member_capacity THEN

        IF NOT COALESCE(v_league.waitlist_enabled, false) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
        END IF;

        -- Queue them. Idempotent: an existing un-promoted row keeps its place
        -- rather than losing it by re-tapping Join.
        IF NOT EXISTS (
            SELECT 1 FROM league_member_waitlist
             WHERE league_id = p_league_id AND user_id = v_caller_id AND promoted_at IS NULL
        ) THEN
            SELECT COALESCE(max(position), 0) + 1 INTO v_position
              FROM league_member_waitlist
             WHERE league_id = p_league_id AND promoted_at IS NULL;

            INSERT INTO league_member_waitlist (league_id, user_id, position)
            VALUES (p_league_id, v_caller_id, v_position)
            ON CONFLICT (league_id, user_id) DO UPDATE
               SET position = EXCLUDED.position, joined_at = now(), promoted_at = NULL;
        END IF;

        -- Hold a 'pending' membership so the queued player appears on the
        -- roster and in the organizer's Requests tab, and so the promotion
        -- trigger has a row to flip.
        IF v_existing.id IS NOT NULL THEN
            UPDATE league_members
               SET status      = 'pending',
                   approved_at = NULL,
                   left_at     = NULL,
                   version     = version + 1,
                   updated_at  = now()
             WHERE id = v_existing.id
            RETURNING * INTO v_row;
        ELSE
            INSERT INTO league_members (league_id, user_id, role, status)
            VALUES (p_league_id, v_caller_id, 'member', 'pending')
            RETURNING * INTO v_row;
        END IF;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('membership', v_row.id, 'waitlist_join', v_caller_id,
                jsonb_build_object('league_id', p_league_id,
                                   'position', (SELECT position FROM league_member_waitlist
                                                 WHERE league_id = p_league_id
                                                   AND user_id = v_caller_id
                                                   AND promoted_at IS NULL)));

        RETURN v_row;
    END IF;

    IF v_league.join_mode = 'open' THEN
        v_initial_status := 'active';
    ELSE
        v_initial_status := 'pending';
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.status = 'inactive' THEN
        UPDATE league_members
           SET status      = v_initial_status,
               approved_at = CASE WHEN v_initial_status = 'active' THEN now() ELSE NULL END,
               left_at     = NULL,
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO league_members (league_id, user_id, role, status, approved_at)
        VALUES (
            p_league_id, v_caller_id, 'member', v_initial_status,
            CASE WHEN v_initial_status = 'active' THEN now() ELSE NULL END
        )
        RETURNING * INTO v_row;
    END IF;

    -- Joining for real clears any queue entry they were holding.
    UPDATE league_member_waitlist
       SET promoted_at = now()
     WHERE league_id = p_league_id AND user_id = v_caller_id AND promoted_at IS NULL;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id, 'join', v_caller_id,
        jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_join(uuid) TO authenticated;


-- ============================================================================
-- Auto-promote the head of the queue when a seat frees up.
-- ============================================================================
-- Mirrors tg_session_presence_promote_waitlist: fires when an active member
-- stops being active, re-checks the cap, promotes one row, notifies. Only
-- promotes into an 'active' seat on an open-join league; on approval/invite_only
-- the organizer still decides, so the queue entry is cleared to 'pending' and
-- the organizer gets the usual join-request notification via
-- notify_league_membership_change.

CREATE OR REPLACE FUNCTION public.tg_league_member_promote_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_league    leagues;
    v_active    integer;
    v_next      league_member_waitlist;
    v_status    league_member_status;
BEGIN
    SELECT * INTO v_league FROM leagues WHERE id = NEW.league_id;
    IF v_league.id IS NULL OR v_league.member_capacity IS NULL
       OR NOT COALESCE(v_league.waitlist_enabled, false)
       OR v_league.status <> 'active' THEN
        RETURN NULL;
    END IF;

    SELECT count(*) INTO v_active
      FROM league_members WHERE league_id = NEW.league_id AND status = 'active';
    IF v_active >= v_league.member_capacity THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_next
      FROM league_member_waitlist
     WHERE league_id = NEW.league_id AND promoted_at IS NULL
     ORDER BY position ASC, joined_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED;
    IF v_next.id IS NULL THEN
        RETURN NULL;
    END IF;

    v_status := CASE WHEN v_league.join_mode = 'open' THEN 'active' ELSE 'pending' END;

    INSERT INTO league_members (league_id, user_id, role, status, approved_at)
    VALUES (NEW.league_id, v_next.user_id, 'member', v_status,
            CASE WHEN v_status = 'active' THEN now() ELSE NULL END)
    ON CONFLICT (league_id, user_id) DO UPDATE
       SET status      = v_status,
           approved_at = CASE WHEN v_status = 'active' THEN now() ELSE NULL END,
           left_at     = NULL,
           version     = league_members.version + 1,
           updated_at  = now();

    UPDATE league_member_waitlist SET promoted_at = now() WHERE id = v_next.id;

    -- No notification here: on an open league the pending -> active flip above
    -- already fires notify_league_membership_change's "you're in" branch (the
    -- actor is the departing member, not the promoted one). On approval /
    -- invite_only the row stays 'pending' and the organizer was already told
    -- when it was first created, so a second push would be noise.

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', NEW.league_id, 'waitlist_promote', auth.uid(),
            jsonb_build_object('league_id', NEW.league_id, 'user_id', v_next.user_id,
                               'status', v_status));

    RETURN NULL;
END;
$$;

-- Only a permanent departure frees a seat. A suspension is temporary — giving
-- the seat away would put the league over capacity the moment it is lifted.
DROP TRIGGER IF EXISTS tg_league_member_promote_waitlist ON public.league_members;
CREATE TRIGGER tg_league_member_promote_waitlist
AFTER UPDATE OF status ON public.league_members
FOR EACH ROW
WHEN (OLD.status = 'active' AND NEW.status = 'inactive')
EXECUTE FUNCTION public.tg_league_member_promote_waitlist();

COMMENT ON FUNCTION public.tg_league_member_promote_waitlist() IS
'Promotes the head of league_member_waitlist when an active member frees a seat
on a capped, waitlist-enabled league. Open-join promotes to active; approval /
invite_only promotes to pending for the organizer to confirm.';
