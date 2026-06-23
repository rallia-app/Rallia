-- ============================================================================
-- Leagues & Tournaments — Phase 2: localize partner notifications (fr-CA)
-- ============================================================================
-- tournament_partner_registered / _withdrew were emitted with English-only
-- title/body inside the registration RPCs. These CREATE OR REPLACE statements
-- are the exact current definitions (pg_get_functiondef) with ONLY the two
-- notification strings localized per recipient via public.lt_user_is_fr(uuid)
-- (added in 20260623170000). Everything else is byte-identical; EN output is
-- unchanged. CREATE OR REPLACE preserves existing grants.
-- ============================================================================

BEGIN;

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

    -- Mode-dependent initial status
    IF v_is_privileged OR v_tournament.registration_mode = 'open' THEN
        v_initial_status := 'registered';
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

CREATE OR REPLACE FUNCTION public.tournament_join_via_invite(p_token text, p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS tournament_registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id     uuid := auth.uid();
    v_tournament_id uuid;
    v_tournament    tournaments;
    v_is_doubles    boolean;
    v_link          tournament_invite_links;
    v_active_count  integer;
    v_existing      tournament_registrations;
    v_row           tournament_registrations;
    v_captain_name  text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Resolve the tournament WITHOUT locking, then lock tournament-first /
    -- link-second (see 20260612150000 header: deadlock avoidance).
    SELECT tournament_id INTO v_tournament_id
      FROM tournament_invite_links WHERE token = p_token;
    IF v_tournament_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    -- Re-validate the link under lock: a reset that committed while we
    -- waited surfaces here as INVITE_INVALID.
    SELECT * INTO v_link FROM tournament_invite_links WHERE token = p_token FOR UPDATE;
    IF v_link.id IS NULL
       OR v_link.revoked_at IS NOT NULL
       OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
       OR (v_link.max_uses IS NOT NULL AND v_link.uses >= v_link.max_uses)
       OR v_tournament.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVITE_INVALID';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_tournament.sport_id);

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND user_id       = v_caller_id;

    -- Idempotent re-tap: already active → hand back the existing row
    -- (deliberate divergence from tournament_register's ALREADY_REGISTERED).
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

    -- Organizer-removed players are blocked permanently, same as
    -- tournament_register (20260612140000) — the invite link must not be a
    -- backdoor around removal.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

    -- Partner validation, mirroring tournament_register.
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

    SELECT count(*) INTO v_active_count
      FROM tournament_registrations
     WHERE tournament_id = v_tournament.id
       AND status IN ('registered', 'pending');

    IF v_active_count >= v_tournament.max_participants THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    IF v_existing.id IS NOT NULL THEN
        -- Reactivate a withdrawn row (disqualified is terminal — gated above).
        UPDATE tournament_registrations
           SET status          = 'registered',
               partner_user_id = p_partner_id,
               withdrawn_at    = NULL,
               approved_at     = now(),
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_row;
    ELSE
        BEGIN
            INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
            VALUES (v_tournament.id, v_caller_id, p_partner_id, 'registered')
            RETURNING * INTO v_row;
        EXCEPTION WHEN unique_violation THEN
            -- Concurrent double-tap: the other call won; return its row.
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
        'registration', v_row.id, 'register_via_invite', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_tournament.id,
            'link_id', v_link.id,
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
$function$;

CREATE OR REPLACE FUNCTION public.tournament_withdraw(p_registration_id uuid, p_version_was integer)
 RETURNS tournament_registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_row          tournament_registrations;
    v_status       tournament_status;
    v_other_member uuid;
    v_t_name       text;
    v_caller_name  text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Withdrawal is only allowed during the registration-open period. Scope the
    -- lookup to the caller's own entry (captain or partner); if it's missing or
    -- owned by someone else, v_status is NULL and we let the UPDATE-fallback
    -- below raise the precise error.
    SELECT t.status INTO v_status
      FROM tournament_registrations r
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE r.id = p_registration_id
       AND (r.user_id = v_caller_id OR r.partner_user_id = v_caller_id);

    IF v_status IS NOT NULL AND v_status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WITHDRAW_NOT_ALLOWED';
    END IF;

    UPDATE tournament_registrations
       SET status        = 'withdrawn',
           withdrawn_at  = now(),
           version       = version + 1,
           updated_at    = now()
     WHERE id      = p_registration_id
       AND (user_id = v_caller_id OR partner_user_id = v_caller_id)
       AND version = p_version_was
       AND status IN ('registered', 'pending', 'waitlisted')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id
               AND (user_id = v_caller_id OR partner_user_id = v_caller_id)
               AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id
               AND user_id <> v_caller_id
               AND (partner_user_id IS NULL OR partner_user_id <> v_caller_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_OWNER';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'withdraw', v_caller_id,
        jsonb_build_object('tournament_id', v_row.tournament_id, 'status', v_row.status)
    );

    -- Doubles: tell the other pair member their entry is gone.
    IF v_row.partner_user_id IS NOT NULL THEN
        v_other_member := CASE
            WHEN v_caller_id = v_row.user_id THEN v_row.partner_user_id
            ELSE v_row.user_id
        END;
        SELECT name INTO v_t_name FROM tournaments WHERE id = v_row.tournament_id;
        SELECT first_name INTO v_caller_name FROM profile WHERE id = v_caller_id;
        PERFORM insert_notification(
            v_other_member,
            'tournament_partner_withdrew',
            v_row.tournament_id,
            CASE WHEN public.lt_user_is_fr(v_other_member) THEN 'Équipe retirée' ELSE 'Team withdrawn' END,
            CASE WHEN public.lt_user_is_fr(v_other_member) THEN COALESCE(v_caller_name, 'Ton partenaire') || ' a retiré ton équipe de ' || COALESCE(v_t_name, 'ce tournoi') || '.' ELSE COALESCE(v_caller_name, 'Your partner') || ' withdrew your team from ' || COALESCE(v_t_name, 'the tournament') || '.' END,
            jsonb_build_object('tournamentId', v_row.tournament_id, 'withdrawnBy', v_caller_id),
            'normal'
        );
    END IF;

    RETURN v_row;
END;
$function$;

COMMIT;
