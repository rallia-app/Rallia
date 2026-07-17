-- ============================================================================
-- Leagues & Tournaments — min_rating becomes a HARD gate
-- ============================================================================
-- Prerequisite for making min_rating a Circuit Rallia scoring input: the floor
-- has to be TRUE of the field, or the tier it earns is a lie. Today it isn't —
-- five separate paths put a below-floor player in the draw:
--
--   1. tournament_update allowed editing min_rating in 'registration_open', so
--      an organizer could fill the draw and THEN raise the floor.
--   2. Doubles partners were never rating-checked (only the caller was).
--   3. 'approval' and 'invite_only' modes never consulted rating at all — the
--      soft gate lived only in the 'open' branch.
--   4. The soft gate itself: below-floor landed in 'pending' for the organizer
--      to wave through.
--   5. Organizers/admins registered privileged, below-floor or not.
--
-- This migration closes all five:
--   * min_rating is editable in 'draft' only — joining max_participants,
--     bracket_type and the fee settings, which already lock there.
--   * A hard level gate runs before the mode branch, so it covers open,
--     approval AND invite_only, and checks the doubles partner too.
--   * Organizers are NOT exempt: you live by the floor you set. If you want to
--     play your own event, set a floor you meet — or set none. Admins keep the
--     bypass as a support override (staff-only, low volume).
--
-- Unrated callers are now REJECTED rather than waved through. The old soft gate
-- deliberately let them pass ("we only gate a KNOWN below-threshold rating"),
-- but an unverifiable entrant breaks the same invariant a below-floor one does.
-- Verified safe on prod: 620/620 player_sport rows carry an active rating, and
-- 0 tournament registrations come from a player without one, so this rejects a
-- population that does not currently exist.
--
-- Error codes reuse RATING_REQUIRED / RATING_TOO_LOW from the community join
-- path (20260418100000) rather than inventing tournament-specific ones.
--
-- Both bodies are their latest definitions verbatim (tournament_update from
-- 20260708120000, tournament_register from 20260624130000) with only the
-- changes above. Signatures unchanged → CREATE OR REPLACE keeps grants.
-- ============================================================================


-- ---------------------------------------------------------------- update
-- Same body as 20260708120000, with one change: min_rating moves from
-- ARRAY['draft','registration_open'] to ARRAY['draft']. max_rating is left
-- alone deliberately — it is not enforced anywhere and does not feed scoring,
-- so it has nothing to inflate.
CREATE OR REPLACE FUNCTION public.tournament_update(
    p_tournament_id uuid,
    p_version_was   integer,
    p_patch         jsonb
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_before      tournaments;
    v_row         tournaments;
    v_key         text;
    v_allowed     text[];
    v_sport_name  text;
    v_new_start   timestamptz;
    v_new_end     timestamptz;
    v_new_format  match_format;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPTY_PATCH';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_before FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_before.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_before.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    IF v_before.status IN ('cancelled', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_TERMINAL';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        v_allowed := CASE v_key
            WHEN 'name'        THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'description' THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'rules'       THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'logo_url'    THEN ARRAY['draft','registration_open','registration_closed','in_progress','completed']
            WHEN 'visibility'  THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'surface'     THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'level'       THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'categories'  THEN ARRAY['draft','registration_open','registration_closed']
            WHEN 'registration_mode'      THEN ARRAY['draft','registration_open']
            WHEN 'registration_opens_at'  THEN ARRAY['draft','registration_open']
            WHEN 'registration_closes_at' THEN ARRAY['draft','registration_open']
            WHEN 'start_date'  THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'end_date'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            -- min_rating locks at draft: it is a competitive fact about the
            -- field (and a scoring input), so it cannot move once players have
            -- entered on the strength of it.
            WHEN 'min_rating'     THEN ARRAY['draft']
            WHEN 'max_rating'     THEN ARRAY['draft','registration_open']
            WHEN 'min_reputation' THEN ARRAY['draft','registration_open']
            WHEN 'facility_id'   THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_name'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_address' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'city'          THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'prize_money_cents' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'max_participants'   THEN ARRAY['draft']
            WHEN 'bracket_type'       THEN ARRAY['draft']
            WHEN 'match_format'       THEN ARRAY['draft']
            WHEN 'games_per_set'      THEN ARRAY['draft']
            WHEN 'final_set_tiebreak' THEN ARRAY['draft']
            WHEN 'entry_format'       THEN ARRAY['draft']
            -- Fee settings: lockable only before registration opens.
            WHEN 'entry_fee_cents'    THEN ARRAY['draft']
            WHEN 'currency'           THEN ARRAY['draft']
            WHEN 'fee_payer'          THEN ARRAY['draft']
            WHEN 'payout_timing'      THEN ARRAY['draft']
            WHEN 'refund_policy_kind' THEN ARRAY['draft']
            WHEN 'refund_partial_bps' THEN ARRAY['draft']
            WHEN 'refund_cutoff_at'   THEN ARRAY['draft']
            ELSE NULL
        END;

        IF v_allowed IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'UNKNOWN_FIELD:' || v_key;
        END IF;
        IF NOT (v_before.status::text = ANY (v_allowed)) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FIELD_NOT_EDITABLE:' || v_key;
        END IF;
    END LOOP;

    IF p_patch ? 'name' AND (p_patch->>'name' IS NULL
        OR char_length(trim(p_patch->>'name')) NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_NAME';
    END IF;

    IF p_patch ? 'max_participants'
        AND (p_patch->>'max_participants')::smallint NOT IN (4, 8, 16, 32, 64, 128) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MAX_PARTICIPANTS';
    END IF;

    IF p_patch ? 'entry_format' AND p_patch->>'entry_format' <> 'singles' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOUBLES_NOT_SUPPORTED';
    END IF;

    v_new_start := CASE WHEN p_patch ? 'start_date' THEN (p_patch->>'start_date')::timestamptz ELSE v_before.start_date END;
    v_new_end   := CASE WHEN p_patch ? 'end_date'   THEN (p_patch->>'end_date')::timestamptz   ELSE v_before.end_date   END;
    IF v_new_start IS NULL OR v_new_end IS NULL OR v_new_end < v_new_start THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_DATES';
    END IF;

    IF p_patch ? 'match_format' THEN
        v_new_format := (p_patch->>'match_format')::match_format;
        SELECT name INTO v_sport_name FROM sport WHERE id = v_before.sport_id;
        IF (v_sport_name = 'pickleball') <> (v_new_format::text LIKE 'pickleball%') THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MATCH_FORMAT_SPORT_MISMATCH';
        END IF;
    END IF;

    UPDATE tournaments SET
        name        = CASE WHEN p_patch ? 'name'        THEN trim(p_patch->>'name')   ELSE name        END,
        description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description'  ELSE description END,
        rules       = CASE WHEN p_patch ? 'rules'       THEN p_patch->>'rules'        ELSE rules       END,
        logo_url    = CASE WHEN p_patch ? 'logo_url'    THEN p_patch->>'logo_url'     ELSE logo_url    END,
        visibility  = CASE WHEN p_patch ? 'visibility'  THEN (p_patch->>'visibility')::tournament_visibility ELSE visibility END,
        surface     = CASE WHEN p_patch ? 'surface'     THEN p_patch->>'surface'      ELSE surface     END,
        level       = CASE WHEN p_patch ? 'level'       THEN p_patch->>'level'        ELSE level       END,
        categories  = CASE WHEN p_patch ? 'categories'
                           THEN COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(p_patch->'categories')), '{}')
                           ELSE categories END,
        registration_mode      = CASE WHEN p_patch ? 'registration_mode'      THEN (p_patch->>'registration_mode')::tournament_registration_mode ELSE registration_mode END,
        registration_opens_at  = CASE WHEN p_patch ? 'registration_opens_at'  THEN (p_patch->>'registration_opens_at')::timestamptz  ELSE registration_opens_at  END,
        registration_closes_at = CASE WHEN p_patch ? 'registration_closes_at' THEN (p_patch->>'registration_closes_at')::timestamptz ELSE registration_closes_at END,
        start_date  = v_new_start,
        end_date    = v_new_end,
        min_rating     = CASE WHEN p_patch ? 'min_rating'     THEN (p_patch->>'min_rating')::numeric      ELSE min_rating     END,
        max_rating     = CASE WHEN p_patch ? 'max_rating'     THEN (p_patch->>'max_rating')::numeric      ELSE max_rating     END,
        min_reputation = CASE WHEN p_patch ? 'min_reputation' THEN (p_patch->>'min_reputation')::smallint ELSE min_reputation END,
        facility_id   = CASE WHEN p_patch ? 'facility_id'   THEN (p_patch->>'facility_id')::uuid ELSE facility_id   END,
        venue_name    = CASE WHEN p_patch ? 'venue_name'    THEN p_patch->>'venue_name'          ELSE venue_name    END,
        venue_address = CASE WHEN p_patch ? 'venue_address' THEN p_patch->>'venue_address'       ELSE venue_address END,
        city          = CASE WHEN p_patch ? 'city'          THEN p_patch->>'city'                ELSE city          END,
        prize_money_cents = CASE WHEN p_patch ? 'prize_money_cents' THEN (p_patch->>'prize_money_cents')::integer ELSE prize_money_cents END,
        max_participants   = CASE WHEN p_patch ? 'max_participants'   THEN (p_patch->>'max_participants')::smallint ELSE max_participants END,
        bracket_type       = CASE WHEN p_patch ? 'bracket_type'       THEN (p_patch->>'bracket_type')::bracket_type ELSE bracket_type END,
        match_format       = CASE WHEN p_patch ? 'match_format'       THEN v_new_format ELSE match_format END,
        games_per_set      = CASE WHEN p_patch ? 'games_per_set'      THEN (p_patch->>'games_per_set')::smallint ELSE games_per_set END,
        final_set_tiebreak = CASE WHEN p_patch ? 'final_set_tiebreak' THEN (p_patch->>'final_set_tiebreak')::final_set_tiebreak ELSE final_set_tiebreak END,
        entry_format       = CASE WHEN p_patch ? 'entry_format'       THEN (p_patch->>'entry_format')::entry_format ELSE entry_format END,
        entry_fee_cents    = CASE WHEN p_patch ? 'entry_fee_cents'    THEN (p_patch->>'entry_fee_cents')::integer ELSE entry_fee_cents END,
        currency           = CASE WHEN p_patch ? 'currency'           THEN p_patch->>'currency' ELSE currency END,
        fee_payer          = CASE WHEN p_patch ? 'fee_payer'          THEN (p_patch->>'fee_payer')::fee_payer_enum ELSE fee_payer END,
        payout_timing      = CASE WHEN p_patch ? 'payout_timing'      THEN (p_patch->>'payout_timing')::payout_timing_enum ELSE payout_timing END,
        refund_policy_kind = CASE WHEN p_patch ? 'refund_policy_kind' THEN (p_patch->>'refund_policy_kind')::refund_policy_kind_enum ELSE refund_policy_kind END,
        refund_partial_bps = CASE WHEN p_patch ? 'refund_partial_bps' THEN (p_patch->>'refund_partial_bps')::integer ELSE refund_partial_bps END,
        refund_cutoff_at   = CASE WHEN p_patch ? 'refund_cutoff_at'   THEN NULLIF(p_patch->>'refund_cutoff_at', '')::timestamptz ELSE refund_cutoff_at END,
        version    = version + 1,
        updated_at = now()
    WHERE id = p_tournament_id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_before, payload_after)
    SELECT 'tournament', v_row.id, 'update', v_caller_id,
           jsonb_object_agg(t.k, to_jsonb(v_before) -> t.k),
           jsonb_object_agg(t.k, to_jsonb(v_row) -> t.k)
      FROM jsonb_object_keys(p_patch) AS t(k);

    RETURN v_row;

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
    WHEN check_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_FIELD_VALUE';
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_update(uuid, integer, jsonb) TO authenticated;


-- ---------------------------------------------------------------- register
-- Same body as 20260624130000, with the soft gate replaced by a hard one that
-- runs before the mode branch (so it covers invite_only, which early-returns)
-- and checks the doubles partner as well as the caller.
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
    v_is_admin       boolean;
    v_caller_rating  double precision;
    v_partner_rating double precision;
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
    v_is_admin      := public.is_admin();
    v_is_privileged := public.is_tournament_organizer(p_tournament_id) OR v_is_admin;

    -- Caller's + partner's active rating for this sport (NULL if unrated).
    -- active_rating_score_id is the canonical rating path.
    SELECT rs.value INTO v_caller_rating
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE ps.player_id = v_caller_id
       AND ps.sport_id  = v_tournament.sport_id;

    IF v_is_doubles THEN
        SELECT rs.value INTO v_partner_rating
          FROM player_sport ps
          JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          JOIN rating_score rs ON rs.id = prs.rating_score_id
         WHERE ps.player_id = p_partner_id
           AND ps.sport_id  = v_tournament.sport_id;
    END IF;

    -- Hard level gate. Runs before the mode branch so it covers open, approval
    -- AND invite_only (which returns early), and it checks both members of a
    -- doubles entry. Organizers are not exempt — they live by the floor they
    -- set. Admins bypass as a support override.
    IF v_tournament.min_rating IS NOT NULL AND NOT v_is_admin THEN
        IF v_caller_rating IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATING_REQUIRED';
        END IF;
        IF v_caller_rating < v_tournament.min_rating THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATING_TOO_LOW';
        END IF;
        IF v_is_doubles THEN
            IF v_partner_rating IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_RATING_REQUIRED';
            END IF;
            IF v_partner_rating < v_tournament.min_rating THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_RATING_TOO_LOW';
            END IF;
        END IF;
    END IF;

    -- Mode-dependent initial status. The level gate above already rejected any
    -- below-floor entrant, so 'open' now always lands on 'registered' — the
    -- soft gate's pending-for-organizer-review branch is gone.
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
