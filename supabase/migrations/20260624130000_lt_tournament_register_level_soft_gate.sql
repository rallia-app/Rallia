-- ============================================================================
-- Leagues & Tournaments — min-level SOFT gate on registration
-- ============================================================================
-- min_rating was stored but never enforced. Per the feedback doc, the minimum
-- level must NOT hard-block: a player below it still registers, but lands in
-- 'pending' for the organizer to accept/refuse (open mode only — approval mode
-- is already pending for everyone; invite_only is unaffected). Unrated players
-- are not gated (we only gate a KNOWN below-threshold rating). The existing
-- tournament_registrations INSERT trigger already notifies the organizer of the
-- pending request, so no notification change is needed.
--
-- Body is the 20260623180000 tournament_register verbatim, with two additions:
-- a v_caller_rating lookup and the soft-gate branch. CREATE OR REPLACE keeps
-- grants; signature is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tournament_register(p_tournament_id uuid, p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS tournament_registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id      uuid := auth.uid();
    v_tournament     tournaments;
    v_is_doubles     boolean;
    v_active_count   integer;
    v_initial_status registration_status;
    v_is_privileged  boolean;
    v_caller_rating  double precision;
    v_existing       tournament_registrations;
    v_row            tournament_registrations;
    v_captain_name   text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Row-lock the tournament so concurrent registrations serialize and the
    -- capacity count + insert below can't race past max_participants.
    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    -- Sport scope: caller must play this sport
    PERFORM public.assert_caller_plays_sport(v_tournament.sport_id);

    -- Status must allow registration
    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- Partner validation, all modes. Entry format decides whether a partner
    -- is required (doubles/mixed_doubles) or forbidden (singles).
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
        -- Partner can't already be in an active entry, as captain or partner.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id = p_tournament_id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND (r.user_id = p_partner_id OR r.partner_user_id = p_partner_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
        -- Caller can't already be someone else's active partner: the
        -- UNIQUE(tournament_id, user_id) constraint only covers captains.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             WHERE r.tournament_id  = p_tournament_id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND r.partner_user_id = v_caller_id
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
    END IF;

    -- Organizers/admins own the tournament: they always register directly as
    -- 'registered', bypassing the approval/invite gates a regular player hits.
    v_is_privileged := public.is_tournament_organizer(p_tournament_id) OR public.is_admin();

    -- Caller's active rating for this sport (NULL if unrated), for the soft
    -- level gate below. active_rating_score_id is the canonical rating path.
    SELECT rs.value INTO v_caller_rating
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE ps.player_id = v_caller_id
       AND ps.sport_id  = v_tournament.sport_id;

    -- Mode-dependent initial status
    IF v_is_privileged THEN
        v_initial_status := 'registered';
    ELSIF v_tournament.registration_mode = 'open' THEN
        -- Soft level gate: a player whose rating is below min_rating still
        -- registers, but as 'pending' for the organizer to accept/refuse.
        -- No hard block; unrated players (NULL) are not gated.
        IF v_tournament.min_rating IS NOT NULL
           AND v_caller_rating IS NOT NULL
           AND v_caller_rating < v_tournament.min_rating THEN
            v_initial_status := 'pending';
        ELSE
            v_initial_status := 'registered';
        END IF;
    ELSIF v_tournament.registration_mode = 'approval' THEN
        v_initial_status := 'pending';
    ELSIF v_tournament.registration_mode = 'invite_only' THEN
        SELECT * INTO v_existing
          FROM tournament_registrations
         WHERE tournament_id = p_tournament_id
           AND user_id       = v_caller_id;

        -- Organizer-removed players are blocked permanently.
        IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
        END IF;

        IF v_existing.id IS NULL OR v_existing.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
        END IF;

        -- Accept the existing invite row by flipping pending → registered.
        -- For doubles the invited captain supplies the partner at accept time.
        UPDATE tournament_registrations
           SET status          = 'registered',
               partner_user_id = COALESCE(p_partner_id, partner_user_id),
               approved_at     = now(),
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
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
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    -- Look for any existing row for this (tournament, user). The UNIQUE
    -- constraint on (tournament_id, user_id) means there's at most one.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND user_id       = v_caller_id;

    -- Already actively registered → block
    IF v_existing.id IS NOT NULL
       AND v_existing.status IN ('registered', 'pending', 'waitlisted') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
    END IF;

    -- Organizer-removed players are blocked permanently (checked before
    -- capacity so they get REGISTRATION_REMOVED, not TOURNAMENT_FULL).
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

    -- Capacity check (open + approval + organizer flows). Counts active
    -- registrations only — one row per entry, so for doubles this counts teams.
    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND status IN ('registered', 'pending');

    IF v_active_count >= v_tournament.max_participants THEN
        -- Waitlist isn't implemented in V2; surface TOURNAMENT_FULL.
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    IF v_existing.id IS NOT NULL THEN
        -- Reactivate a previously withdrawn row. partner_user_id is
        -- overwritten: re-registering with a different partner is allowed.
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

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 're_register', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
                'previous_status', v_existing.status,
                'status', v_row.status,
                'partner_user_id', v_row.partner_user_id
            )
        );
    ELSE
        -- Fresh insert. UNIQUE handles the concurrent-double-tap race.
        BEGIN
            INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
            VALUES (p_tournament_id, v_caller_id, p_partner_id, v_initial_status)
            RETURNING * INTO v_row;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END;

        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES (
            'registration', v_row.id, 'register', v_caller_id,
            jsonb_build_object(
                'tournament_id', p_tournament_id,
                'status', v_row.status,
                'partner_user_id', v_row.partner_user_id
            )
        );
    END IF;

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
$function$;
