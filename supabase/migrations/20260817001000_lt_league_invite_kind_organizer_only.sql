-- ============================================================================
-- Leagues — an admin minted an organizer link on someone else's league
-- ============================================================================
-- From the league test pass, on a league the tester is a plain member of: "Le
-- message au-dessus et en dessous du lien dit que je peux bypasser tous les
-- contrôles (comme en mode organisateur). Il y a aussi le bouton réinitialiser
-- alors qu'il ne devrait pas être là."
--
-- The sheet is right; the RPC lied to it. league_invite_get_or_create
-- (20260809150000) decides the link KIND with
--
--     v_privileged := is_league_organizer(...) OR is_admin()
--
-- and the tester is staff on staging, so he minted a skeleton-key organizer
-- link on a league he only plays in. The client branches on `kind`, hence the
-- organizer copy and the reset button.
--
-- is_admin() belongs on authorisation, not on identity: an admin acting on a
-- league they do not organise is, for sharing purposes, a player, and should
-- get the player link and the player rules (public, non-invite-only, active,
-- redeems through league_join). Nothing depends on staff minting bypass links:
-- league management is organizer-facing in the mobile app, and the web admin
-- dashboard has no league surface.
--
-- league_invite_reset keeps its is_admin() check untouched. That one really is
-- authorisation: revoking a compromised link is exactly the kind of thing
-- support should be able to do.
--
-- Body otherwise identical to 20260809150000 (its only prior definition).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_invite_get_or_create(
    p_league_id uuid
)
RETURNS league_invite_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_league     leagues;
    v_privileged boolean;
    v_kind       text;
    v_row        league_invite_links;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
    IF v_league.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_FOUND';
    END IF;
    IF v_league.status = 'closed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    -- Organising the league is what earns the skeleton key, not being staff.
    v_privileged := public.is_league_organizer(p_league_id);
    v_kind := CASE WHEN v_privileged THEN 'organizer' ELSE 'player' END;

    -- A player may only share where sharing is safe and leads somewhere.
    IF NOT v_privileged THEN
        IF v_league.visibility <> 'public'
           OR v_league.join_mode = 'invite_only'
           OR v_league.status <> 'active' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHARING_NOT_AVAILABLE';
        END IF;
    END IF;

    -- Organizer links are per league; player links are per sharer.
    SELECT * INTO v_row
      FROM league_invite_links
     WHERE league_id = p_league_id
       AND revoked_at IS NULL
       AND kind = v_kind
       AND (v_kind = 'organizer' OR created_by = v_caller_id)
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_row.id IS NOT NULL THEN
        RETURN v_row;
    END IF;

    INSERT INTO league_invite_links (league_id, token, created_by, kind)
    VALUES (p_league_id, replace(gen_random_uuid()::text, '-', ''), v_caller_id, v_kind)
    RETURNING * INTO v_row;

    -- Token deliberately excluded from the audit payload.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'league', p_league_id, 'invite_link_created', v_caller_id,
        jsonb_build_object('link_id', v_row.id, 'kind', v_kind)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.league_invite_get_or_create(uuid) TO authenticated;

COMMENT ON FUNCTION public.league_invite_get_or_create(uuid)
    IS 'Returns the caller''s active invite link for the league, minting one if absent. Organizers of the league get its shared organizer link; everyone else, staff included, gets their own player link, allowed only on a public, non-invite-only, active league (SHARING_NOT_AVAILABLE otherwise).';
