-- ============================================================================
-- Leagues & Tournaments — league_join's rating gate never read a rating
-- ============================================================================
-- The gate added in 20260615120000 read:
--
--     SELECT rs.value INTO v_rating
--       FROM player_sport ps
--       LEFT JOIN rating_score rs ON rs.id = ps.active_rating_score_id
--
-- but player_sport.active_rating_score_id is a player_rating_score.id, not a
-- rating_score.id. The LEFT JOIN never matched, so v_rating was always NULL
-- (verified locally: of 135 player_sport rows with a non-null
-- active_rating_score_id, 0 join to rating_score and 135 to
-- player_rating_score). The gate therefore behaved as:
--
--   * min_rating set -> EVERY player rejected (the min branch treats NULL as
--     a failure), including players well above the floor
--   * only max_rating set -> EVERY player admitted (the max branch is guarded
--     by v_rating IS NOT NULL, so it could never fire)
--
-- The fix routes through lt_assert_rating_band (20260725120000), which walks
-- player_sport -> player_rating_score -> rating_score, i.e. the canonical
-- active-rating path. One body for leagues and tournaments; this is exactly
-- the per-RPC duplication that let the gate rot here unnoticed for a month.
--
-- Two intentional behaviour changes ride along, both inherited from the helper
-- and both matching what tournaments already do:
--
--   1. Error codes. league_join raised one RATING_GATE_NOT_MET for both bounds;
--      it now raises RATING_REQUIRED / RATING_TOO_LOW / RATING_TOO_HIGH. Safe
--      to change: nothing mapped RATING_GATE_NOT_MET — LeagueDetail toasted the
--      raw exception text, so a blocked player literally saw
--      "RATING_GATE_NOT_MET". The granular codes are mapped client-side in the
--      same commit.
--   2. Unrated players. Previously unrated was rejected only when min_rating
--      was set; with a ceiling alone they got in. Now either bound rejects
--      unrated (RATING_REQUIRED) — an unverifiable entrant breaks a band the
--      same way an out-of-band one does.
--
-- Blast radius at time of writing: prod has no leagues at all, and the only
-- staging leagues carrying a bound are four [SEED] fixtures. Nobody's live
-- membership changes; what changes is that a bound starts meaning something.
--
-- Organizer invites deliberately stay UNGATED. The bounds gate self-serve
-- joining; an organizer who invites a player by name has already made the call
-- that they belong, and a league is a season-long social group where that
-- judgement is worth more than the number. This is a deliberate divergence from
-- tournaments, which gate accept_invite in 20260725120000 because a draw feeds
-- Circuit Rallia scoring and has to be defensible on rating alone.
--
-- Note for anyone reading the body below: at this point the only live invite
-- path is league_accept_invite. The invite_only branch here is unreachable and
-- always was — the ALREADY_MEMBER guard above it fires on any 'pending' row —
-- so a pending invitee calling league_join gets ALREADY_MEMBER and the branch
-- can only ever raise NOT_INVITED. Left alone here because reordering guards is
-- not this migration's job; fixed in 20260725140000.
--
-- Body below is the definition from 20260615120000 verbatim, with only the
-- rating-gate block replaced.
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
     WHERE league_id = p_league_id AND user_id = v_caller_id;

    IF v_existing.id IS NOT NULL AND v_existing.status IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_MEMBER';
    END IF;

    IF v_league.join_mode = 'invite_only' THEN
        IF v_existing.id IS NULL OR v_existing.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
        END IF;
        UPDATE league_members
           SET status      = 'active',
               approved_at = now(),
               version     = version + 1,
               updated_at  = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'membership', v_row.id, 'join', v_caller_id,
            jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
        );
        RETURN v_row;
    END IF;

    -- Rating gate. No-ops when both bounds are NULL, so it is called
    -- unconditionally. assert_caller_plays_sport above already required an
    -- active player_sport row, which is why the helper needs no is_active
    -- filter of its own.
    PERFORM public.lt_assert_rating_band(
        v_caller_id, v_league.sport_id, v_league.min_rating, v_league.max_rating
    );

    -- Reputation gate
    IF v_league.min_reputation IS NOT NULL THEN
        IF (SELECT reputation_score FROM player WHERE id = v_caller_id)
           < v_league.min_reputation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REPUTATION_GATE_NOT_MET';
        END IF;
    END IF;

    SELECT count(*) INTO v_active_count
      FROM league_members
     WHERE league_id = p_league_id AND status = 'active';

    IF v_league.member_capacity IS NOT NULL
       AND v_active_count >= v_league.member_capacity
       AND NOT COALESCE(v_league.waitlist_enabled, false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_FULL';
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

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'membership', v_row.id, 'join', v_caller_id,
        jsonb_build_object('league_id', p_league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_join(uuid) TO authenticated;
