-- ============================================================================
-- Tournaments — let players share invite links, without handing out a bypass
-- ============================================================================
-- Invite links were organizer-only, and for a good reason: redeeming one skips
-- registration_mode (you land 'registered' even on an approval tournament) and
-- never checks the rating band at all. The link is a skeleton key, so the
-- organizer-only gate was doing the enforcement the redeem path does not.
--
-- That blocks the obvious growth loop: on a public tournament, any player
-- should be able to invite friends, and it should be encouraged. So links grow
-- a second kind rather than the gate simply being dropped.
--
--   kind = 'organizer'  one per tournament, unchanged skeleton-key semantics.
--                       Still organizer/co-organizer/admin only to mint. This
--                       is what an organizer uses to admit a specific person
--                       past their own rules.
--   kind = 'player'     one per (tournament, sharer). Redeems through the
--                       NORMAL rules: the rating band applies, and an approval
--                       tournament lands the recipient in the organizer's
--                       pending queue instead of straight in.
--
-- Player links only exist where sharing is meaningful and safe:
--   * visibility = 'public'      private/community stay organizer-only, a
--                                shared link must not leak a hidden tournament
--   * registration_mode <> 'invite_only'  the organizer picks the field there,
--                                so a shared link would lead nowhere
--   * status = 'registration_open'
-- All three are enforced at mint AND re-checked at redeem, since a tournament
-- can change under a link that is already in the wild.
--
-- created_by already existed and now carries real weight: it is the sharer, so
-- the referral code on the URL credits the player who actually brought someone
-- in rather than always the organizer.
--
-- Deliberately unchanged: organizer links keep bypassing the band. An organizer
-- admitting someone out-of-band is a decision they are entitled to make about
-- their own event; a stranger with a forwarded link is not.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Schema
-- --------------------------------------------------------------------------

ALTER TABLE public.tournament_invite_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'organizer';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tournament_invite_links_kind_check'
    ) THEN
        ALTER TABLE public.tournament_invite_links
          ADD CONSTRAINT tournament_invite_links_kind_check
          CHECK (kind IN ('organizer', 'player'));
    END IF;
END $$;

COMMENT ON COLUMN public.tournament_invite_links.kind IS
    'organizer = one per tournament, bypasses registration_mode and the rating band. player = one per sharer, redeems through the normal registration rules.';

-- One live organizer link per tournament, one live player link per sharer.
CREATE UNIQUE INDEX IF NOT EXISTS tournament_invite_links_one_player_link_idx
    ON public.tournament_invite_links (tournament_id, created_by)
    WHERE kind = 'player' AND revoked_at IS NULL;


-- --------------------------------------------------------------------------
-- 2. RLS — amend the live SELECT policy, never add a second one alongside
-- --------------------------------------------------------------------------
-- Permissive policies OR together, so a second policy would silently widen
-- organizer links too. A sharer may read their own player link and nothing else.

DROP POLICY IF EXISTS tinvite_select ON public.tournament_invite_links;
CREATE POLICY tinvite_select ON public.tournament_invite_links
    FOR SELECT
    USING (
        (SELECT public.is_admin())
        OR public.is_tournament_organizer(tournament_id)
        OR (kind = 'player' AND created_by = (SELECT auth.uid()))
    );


-- --------------------------------------------------------------------------
-- 3. Minting
-- --------------------------------------------------------------------------
-- Same entry point for both audiences: the caller's rights decide which kind
-- they get, so the client keeps calling one RPC.

CREATE OR REPLACE FUNCTION public.tournament_invite_get_or_create(
    p_tournament_id uuid
)
RETURNS tournament_invite_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_privileged  boolean;
    v_kind        text;
    v_row         tournament_invite_links;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_TERMINAL';
    END IF;

    v_privileged := public.is_tournament_organizer(p_tournament_id) OR public.is_admin();
    v_kind := CASE WHEN v_privileged THEN 'organizer' ELSE 'player' END;

    -- A player may only share where sharing is safe and leads somewhere.
    IF NOT v_privileged THEN
        IF v_tournament.visibility <> 'public'
           OR v_tournament.registration_mode = 'invite_only'
           OR v_tournament.status <> 'registration_open' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHARING_NOT_AVAILABLE';
        END IF;
    END IF;

    -- Organizer links are per tournament; player links are per sharer.
    SELECT * INTO v_row
      FROM tournament_invite_links
     WHERE tournament_id = p_tournament_id
       AND revoked_at IS NULL
       AND kind = v_kind
       AND (v_kind = 'organizer' OR created_by = v_caller_id)
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_row.id IS NOT NULL THEN
        RETURN v_row;
    END IF;

    INSERT INTO tournament_invite_links (tournament_id, token, created_by, kind)
    VALUES (p_tournament_id, replace(gen_random_uuid()::text, '-', ''), v_caller_id, v_kind)
    RETURNING * INTO v_row;

    -- Token deliberately excluded from the audit payload.
    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'invite_link_created', v_caller_id,
        jsonb_build_object('link_id', v_row.id, 'kind', v_kind)
    );

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_invite_get_or_create(uuid) TO authenticated;

COMMENT ON FUNCTION public.tournament_invite_get_or_create(uuid)
    IS 'Returns the caller''s active invite link, minting one if absent. Organizers get the tournament''s shared organizer link; any other player gets their own player link, allowed only on a public, non-invite-only tournament with registration open (SHARING_NOT_AVAILABLE otherwise).';


-- --------------------------------------------------------------------------
-- 4. Redeeming
-- --------------------------------------------------------------------------
-- Body is the live 2-arg definition, with the kind branch added: everything up
-- to the status decision is shared, then a player link runs the rating band and
-- the registration_mode mapping that tournament_register applies.

CREATE OR REPLACE FUNCTION public.tournament_join_via_invite(
    p_token      text,
    p_partner_id uuid DEFAULT NULL
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_tournament_id  uuid;
    v_tournament     tournaments;
    v_is_doubles     boolean;
    v_link           tournament_invite_links;
    v_active_count   integer;
    v_existing       tournament_registrations;
    v_row            tournament_registrations;
    v_captain_name   text;
    v_is_player_link boolean;
    v_initial_status registration_status;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT tournament_id INTO v_tournament_id
      FROM tournament_invite_links WHERE token = p_token;
    IF v_tournament_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_link FROM tournament_invite_links WHERE token = p_token FOR UPDATE;
    IF v_link.id IS NULL
       OR v_link.revoked_at IS NOT NULL
       OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses)
       OR v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    v_is_player_link := (v_link.kind = 'player');

    PERFORM public.assert_caller_plays_sport(v_tournament.sport_id);

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- A player link is re-validated at redeem: the tournament may have gone
    -- private or switched to invite_only after the link was shared.
    IF v_is_player_link
       AND (v_tournament.visibility <> 'public'
            OR v_tournament.registration_mode = 'invite_only') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SHARING_NOT_AVAILABLE';
    END IF;

    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND user_id       = v_caller_id;

    -- Idempotent re-tap: already active → hand back the existing row.
    IF v_existing.id IS NOT NULL
       AND v_existing.status IN ('registered', 'pending', 'waitlisted') THEN
        RETURN v_existing;
    END IF;

    -- Same idempotency when the caller is the partner of an active entry.
    SELECT * INTO v_row
      FROM tournament_registrations
     WHERE tournament_id   = v_tournament.id
       AND partner_user_id = v_caller_id
       AND status IN ('registered', 'pending', 'waitlisted');
    IF v_row.id IS NOT NULL THEN
        RETURN v_row;
    END IF;

    -- Organizer-removed players are blocked permanently: no link is a backdoor
    -- around removal, whoever shared it.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

    v_is_doubles := v_tournament.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_id = v_caller_id
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_id
               AND ps.sport_id  = v_tournament.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id = v_tournament.id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND (r.user_id = p_partner_id OR r.partner_user_id = p_partner_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
    END IF;

    -- The kind branch. An organizer link keeps its skeleton-key behaviour;
    -- a player link is held to the same bar as tapping Register.
    IF v_is_player_link AND NOT public.is_admin() THEN
        PERFORM public.lt_assert_rating_band(
            v_caller_id, v_tournament.sport_id,
            v_tournament.min_rating, v_tournament.max_rating, false);
        IF v_is_doubles THEN
            PERFORM public.lt_assert_rating_band(
                p_partner_id, v_tournament.sport_id,
                v_tournament.min_rating, v_tournament.max_rating, true);
        END IF;
    END IF;

    IF v_is_player_link AND v_tournament.registration_mode = 'approval' THEN
        v_initial_status := 'pending';
    ELSE
        v_initial_status := 'registered';
    END IF;

    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND status IN ('registered', 'pending');

    IF v_active_count >= v_tournament.max_participants THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    IF v_existing.id IS NOT NULL THEN
        UPDATE tournament_registrations
           SET status          = v_initial_status,
               partner_user_id = p_partner_id,
               withdrawn_at    = NULL,
               approved_at     = CASE
                                   WHEN v_initial_status = 'registered' THEN now()
                                   ELSE NULL
                                 END,
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        BEGIN
            INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
            VALUES (v_tournament.id, v_caller_id, p_partner_id, v_initial_status)
            RETURNING * INTO v_row;
        EXCEPTION WHEN unique_violation THEN
            SELECT * INTO v_row
              FROM tournament_registrations
             WHERE tournament_id = v_tournament.id
               AND user_id       = v_caller_id;
            RETURN v_row;
        END;
    END IF;

    UPDATE tournament_invite_links SET uses = uses + 1 WHERE id = v_link.id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id,
        CASE WHEN v_is_player_link THEN 'register_via_player_invite' ELSE 'register_via_invite' END,
        v_caller_id,
        jsonb_build_object(
            'tournament_id', v_tournament.id,
            'link_id', v_link.id,
            'link_kind', v_link.kind,
            'shared_by', v_link.created_by,
            'previous_status', v_existing.status,
            'status', v_row.status,
            'partner_user_id', v_row.partner_user_id
        )
    );

    IF v_is_doubles THEN
        SELECT first_name INTO v_captain_name FROM profile WHERE id = v_caller_id;
        PERFORM insert_notification(
            p_partner_id,
            'tournament_partner_registered',
            v_tournament.id,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN 'Inscrit comme partenaire' ELSE 'Tournament partner' END,
            CASE WHEN public.lt_user_is_fr(p_partner_id) THEN COALESCE(v_captain_name, 'Un joueur') || ' t''a inscrit comme partenaire pour ' || v_tournament.name || '.' ELSE COALESCE(v_captain_name, 'A player') || ' registered you as their partner for ' || v_tournament.name || '.' END,
            jsonb_build_object('tournamentId', v_tournament.id, 'captainId', v_caller_id),
            'normal'
        );
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_join_via_invite(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.tournament_join_via_invite(text, uuid) IS
    'Registers the caller via a tournament invite token. An organizer link bypasses registration_mode and the rating band; a player link applies both, landing on pending for an approval tournament. Idempotent for already-active registrations.';
