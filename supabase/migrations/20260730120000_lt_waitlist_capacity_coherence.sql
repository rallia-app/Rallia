-- ============================================================================
-- Leagues — waitlist lifecycle and capacity coherence
-- ============================================================================
-- Four defects around 20260730100300's capacity/waitlist work, found by review:
--
-- 1. A queued player who left was re-admitted without consent. league_leave
--    flips their 'pending' hold to 'inactive' but nothing touched their
--    league_member_waitlist row, so the next freed seat promoted them straight
--    back to 'active' (with the "you're in" push). Reproduced locally.
--    league_remove_member had the same leak for organizer-driven exits.
--
-- 2. A stale queue head ate promotion slots. league_approve_member flips any
--    'pending' row to 'active' without touching the queue, so an approved
--    (or otherwise no-longer-waiting) player's queue row stayed un-promoted;
--    when a seat freed, the trigger "promoted" that stale head — a no-op for
--    them, and the genuinely waiting next player lost the seat.
--
-- 3. league_approve_member ignored member_capacity entirely. 100300's own
--    stance is "capacity is a cap, not a suggestion": the cap governs
--    player-driven joins, and approval is the organizer confirming exactly such
--    a join. It now raises LEAGUE_FULL at capacity. The INVITE path keeps its
--    deliberate bypass (the organizer already chose them) — that decision is
--    100300's, not revisited here.
--
-- 4. Suspension seat accounting was incoherent three ways. The promotion
--    trigger deliberately holds a suspended member's seat ("temporary — giving
--    it away would put the league over capacity the moment it lifts"), but
--    league_join counted only 'active' members, so the same seat WAS quietly
--    available to walk-in joiners — a waitlisted player could be leapfrogged
--    during any suspension window. And when a suspended member left for good
--    (suspended -> inactive), the held seat finally freed with no promotion at
--    all, because the trigger only fired on active -> inactive.
--
--    Coherent completion of the seat-is-held stance: 'suspended' counts against
--    capacity everywhere (league_join, league_approve_member, the trigger's
--    re-check), and the trigger fires on BOTH active -> inactive and
--    suspended -> inactive. The lift cron can then never push a league over
--    capacity, and a seat frees exactly once, on the permanent departure.
--
-- Belt and braces are split: exits clean their own queue row at the source
-- (leave / remove / accept-invite / approve), and the trigger independently
-- refuses candidates whose membership is no longer 'pending' — so one missed
-- cleanup path can never hand a seat to someone who stopped waiting.
-- league_join always writes the 'pending' hold when queueing, and account
-- deletion cascades both tables, so a queued user always has a membership row.
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

        -- Joining for real clears any queue entry they were holding.
        UPDATE league_member_waitlist
           SET promoted_at = now()
         WHERE league_id = p_league_id AND user_id = v_caller_id AND promoted_at IS NULL;

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
    -- A suspended member's seat is held for them (the promotion trigger's
    -- stance), so it counts here too.
    SELECT count(*) INTO v_active_count
      FROM league_members
     WHERE league_id = p_league_id AND status IN ('active', 'suspended');

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
-- league_approve_member: capacity-gated, and consumes the queue entry.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_approve_member(
    p_member_id   uuid,
    p_version_was integer
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_league    leagues;
    v_seated    integer;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- The cap binds approvals too — approving a request past capacity is the
    -- same over-admission league_join refuses. (Invites stay exempt: their
    -- bypass lives in league_join's accept branch and is deliberate.)
    SELECT * INTO v_league FROM leagues WHERE id = v_member.league_id;
    IF v_league.member_capacity IS NOT NULL THEN
        SELECT count(*) INTO v_seated
          FROM league_members
         WHERE league_id = v_member.league_id AND status IN ('active', 'suspended');
        IF v_seated >= v_league.member_capacity THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
        END IF;
    END IF;

    UPDATE league_members
       SET status      = 'active',
           approved_at = now(),
           approved_by = v_caller_id,
           version     = version + 1,
           updated_at  = now()
     WHERE id      = p_member_id
       AND version = p_version_was
       AND status  = 'pending'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM league_members WHERE id = p_member_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    -- An approved player is seated; their queue entry (if any) is consumed so
    -- the next freed seat goes to someone still waiting.
    UPDATE league_member_waitlist
       SET promoted_at = now()
     WHERE league_id = v_row.league_id AND user_id = v_row.user_id AND promoted_at IS NULL;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id, 'approve_member', v_caller_id,
        jsonb_build_object(
            'league_id', v_row.league_id,
            'user_id', v_row.user_id,
            'status', v_row.status
        )
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_approve_member(uuid, integer) TO authenticated;


-- ============================================================================
-- league_leave / league_remove_member: leaving also leaves the queue.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_leave(p_league_id uuid)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_league    leagues;
    v_existing  league_members;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;

    -- The owner can't leave their own league (it would orphan it).
    IF v_league.organizer_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ORGANIZER_CANNOT_LEAVE';
    END IF;

    SELECT * INTO v_existing
      FROM league_members
     WHERE league_id = p_league_id AND user_id = v_caller_id
     FOR UPDATE;
    IF v_existing.id IS NULL OR v_existing.status NOT IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_MEMBER';
    END IF;

    UPDATE league_members
       SET status     = 'inactive',
           left_at    = now(),
           version    = version + 1,
           updated_at = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    -- Leaving while queued means leaving the queue: without this, the next
    -- freed seat would promote them back in without their consent.
    DELETE FROM league_member_waitlist
     WHERE league_id = p_league_id AND user_id = v_caller_id AND promoted_at IS NULL;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'leave', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'prev_status', v_existing.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_leave(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.league_remove_member(
    p_member_id   uuid,
    p_version_was integer
)
RETURNS league_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    league_members;
    v_league    leagues;
    v_row       league_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM league_members WHERE id = p_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    IF NOT (public.is_league_organizer(v_member.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_member.league_id;
    IF v_member.user_id = v_league.organizer_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_REMOVE_ORGANIZER';
    END IF;
    IF v_member.user_id = v_caller_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANNOT_REMOVE_SELF';
    END IF;

    IF v_member.status NOT IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REMOVABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    UPDATE league_members
       SET status     = 'inactive',
           left_at    = now(),
           version    = version + 1,
           updated_at = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    -- Removing a queued player also removes them from the queue.
    DELETE FROM league_member_waitlist
     WHERE league_id = v_member.league_id AND user_id = v_member.user_id
       AND promoted_at IS NULL;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'remove_member', v_caller_id,
            jsonb_build_object('league_id', v_member.league_id, 'user_id', v_member.user_id,
                               'prev_status', v_member.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_remove_member(uuid, integer) TO authenticated;


-- ============================================================================
-- Promotion trigger: only candidates still waiting, seats counted coherently,
-- fires on any permanent departure (active OR suspended -> inactive).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_league_member_promote_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_league    leagues;
    v_seated    integer;
    v_next      league_member_waitlist;
    v_status    league_member_status;
BEGIN
    SELECT * INTO v_league FROM leagues WHERE id = NEW.league_id;
    IF v_league.id IS NULL OR v_league.member_capacity IS NULL
       OR NOT COALESCE(v_league.waitlist_enabled, false)
       OR v_league.status <> 'active' THEN
        RETURN NULL;
    END IF;

    SELECT count(*) INTO v_seated
      FROM league_members
     WHERE league_id = NEW.league_id AND status IN ('active', 'suspended');
    IF v_seated >= v_league.member_capacity THEN
        RETURN NULL;
    END IF;

    -- Head of the queue, but only someone still waiting: their membership must
    -- still be the 'pending' hold league_join wrote when it queued them. A row
    -- whose member has since left, been removed, or been seated is stale — the
    -- exits consume their own rows, and this filter refuses any that slip by.
    SELECT w.* INTO v_next
      FROM league_member_waitlist w
      JOIN league_members lm
        ON lm.league_id = w.league_id AND lm.user_id = w.user_id
     WHERE w.league_id = NEW.league_id AND w.promoted_at IS NULL
       AND lm.status = 'pending'
     ORDER BY w.position ASC, w.joined_at ASC
     LIMIT 1
     FOR UPDATE OF w SKIP LOCKED;
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

-- A seat frees exactly once: on the permanent departure. An active member
-- leaving frees theirs; a suspended member's seat was HELD through the
-- suspension (it counts against capacity above), so it frees when they leave
-- or are removed — not when the suspension starts or lifts.
DROP TRIGGER IF EXISTS tg_league_member_promote_waitlist ON public.league_members;
CREATE TRIGGER tg_league_member_promote_waitlist
AFTER UPDATE OF status ON public.league_members
FOR EACH ROW
WHEN (OLD.status IN ('active', 'suspended') AND NEW.status = 'inactive')
EXECUTE FUNCTION public.tg_league_member_promote_waitlist();

COMMENT ON FUNCTION public.tg_league_member_promote_waitlist() IS
'Promotes the head of league_member_waitlist (skipping entries whose member is
no longer pending) when a permanent departure frees a seat on a capped,
waitlist-enabled league. Suspended members keep their seat; open-join promotes
to active, approval / invite_only to pending for the organizer to confirm.';
