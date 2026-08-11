-- Round deadlines — F4c: the ladder covers PAID tournaments.
--
-- Policy (per round-deadlines.md §Paid tournaments, recommended default):
-- the resolution ladder now runs on paid draws too. Walkovers and
-- extensions behave identically; the one money rule is the harsh case the
-- spec called out — a DOUBLE walkover where a side never completed a single
-- game in the tournament (paid, played nothing). That registration is
-- disqualified, which the existing settle machinery already interprets as
-- an automatic full entry refund (service fee retained) and an exclusion
-- from the organizer payout. Sides that did play (e.g. pool games before a
-- knockout stall) keep the normal no-refund outcome: they had their window.
--
-- Also re-issues tournament_update (body from 20260731150000) with a
-- bracket-aware max_participants allowlist so draft pool tournaments can
-- edit their field size, and with pool config kept coherent when
-- bracket_type changes in draft.

CREATE OR REPLACE FUNCTION public.lt_resolve_due_tournament_matches(p_dry_run boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec       record;
    v_eff       timestamptz;
    v_grace     timestamptz;
    v_e1        jsonb;
    v_e2        jsonb;
    v_has1      boolean;
    v_has2      boolean;
    v_winner    uuid;
    v_loser     uuid;
    v_acted     integer := 0;
    v_prefix    text := CASE WHEN p_dry_run THEN 'dryrun_' ELSE '' END;
    v_rows      jsonb;
    v_uid       uuid;
    v_reg       uuid;
BEGIN
    FOR v_rec IN
        SELECT tm.*, t.name AS t_name, t.end_date AS t_end, t.organizer_id AS t_org,
               t.entry_fee_cents AS t_fee
          FROM tournament_matches tm
          JOIN tournaments t ON t.id = tm.tournament_id
         WHERE t.status = 'in_progress'
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND tm.player1_registration_id IS NOT NULL
           AND tm.player2_registration_id IS NOT NULL
           AND NOT tm.player1_is_bye AND NOT tm.player2_is_bye
         FOR UPDATE OF tm SKIP LOCKED
    LOOP
        v_eff := public.lt_effective_match_deadline(
            (SELECT m FROM tournament_matches m WHERE m.id = v_rec.id));
        CONTINUE WHEN v_eff IS NULL OR v_eff > now();

        -- Disputes are never auto-resolved: escalate once, wait.
        IF v_rec.status = 'disputed' THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('dispute_escalated', 'dryrun_dispute_escalated')
            ) THEN
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'dispute_escalated', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id, 'deadline_at', v_eff));
                IF NOT p_dry_run THEN
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', o.organizer_id,
                        'type', 'tournament_dispute_escalated',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                   THEN 'Litige à trancher' ELSE 'Dispute needs a ruling' END,
                        'body', CASE WHEN public.lt_user_is_fr(o.organizer_id)
                                  THEN v_rec.t_name || ' : une partie contestée a dépassé son échéance et attend ta décision.'
                                  ELSE v_rec.t_name || ': a disputed game passed its deadline and awaits your ruling.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT t.organizer_id FROM tournaments t WHERE t.id = v_rec.tournament_id) o;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                v_acted := v_acted + 1;
            END IF;
            CONTINUE;
        END IF;

        -- Step 0: an attached game is mutual agreement → one automatic grace.
        IF v_rec.match_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_grace', 'dryrun_auto_grace')
            ) THEN
                SELECT GREATEST(
                           (m.match_date + COALESCE(m.start_time, time '20:00'))::timestamptz
                               + interval '72 hours',
                           now() + interval '24 hours')
                  INTO v_grace
                  FROM match m WHERE m.id = v_rec.match_id;
                IF v_grace IS NOT NULL THEN
                    IF NOT p_dry_run THEN
                        UPDATE tournament_matches
                           SET deadline_override_at = v_grace,
                               version = version + 1, updated_at = now()
                         WHERE id = v_rec.id;
                    END IF;
                    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                    VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_grace', v_rec.t_org,
                            jsonb_build_object('tournament_id', v_rec.tournament_id,
                                               'grace_until', v_grace));
                    v_acted := v_acted + 1;
                END IF;
            END IF;
            -- Grace already granted and expired with a game still attached:
            -- leave it to the score/auto-confirm path and the organizer.
            CONTINUE;
        END IF;

        -- Step 1: effort split.
        v_e1 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player1_registration_id));
        v_e2 := public.lt_side_effort(v_rec.id, public.lt_registration_users(v_rec.player2_registration_id));
        v_has1 := (v_e1->>'voted')::boolean OR (v_e1->>'posted_card')::boolean OR (v_e1->>'messaged')::boolean;
        v_has2 := (v_e2->>'voted')::boolean OR (v_e2->>'posted_card')::boolean OR (v_e2->>'messaged')::boolean;

        IF v_has1 AND v_has2 THEN
            IF EXISTS (
                SELECT 1 FROM leagues_tournaments_audit a
                 WHERE a.scope = 'tournament_match' AND a.entity_id = v_rec.id
                   AND a.action IN ('auto_extension', 'dryrun_auto_extension')
            ) THEN
                v_winner := NULL;  -- extension spent → double walkover below
            ELSE
                IF NOT p_dry_run THEN
                    UPDATE tournament_matches
                       SET deadline_override_at = LEAST(now() + interval '72 hours',
                                                        GREATEST(v_rec.t_end, now() + interval '48 hours')),
                           version = version + 1, updated_at = now()
                     WHERE id = v_rec.id;
                    SELECT jsonb_agg(jsonb_build_object(
                        'user_id', u.uid,
                        'type', 'tournament_deadline_extended',
                        'target_id', v_rec.tournament_id,
                        'title', CASE WHEN public.lt_user_is_fr(u.uid)
                                   THEN 'Prolongation automatique' ELSE 'Automatic extension' END,
                        'body', CASE WHEN public.lt_user_is_fr(u.uid)
                                  THEN v_rec.t_name || ' : vous cherchez tous les deux un moment. Dernière prolongation, ensuite la partie est annulée pour les deux.'
                                  ELSE v_rec.t_name || ': you are both trying to find a time. One last extension, then the game is voided for both.'
                                END,
                        'payload', jsonb_build_object(
                            'tournamentId', v_rec.tournament_id,
                            'tournamentMatchId', v_rec.id),
                        'priority', 'high'
                    )) INTO v_rows
                    FROM (SELECT unnest(public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) AS uid) u;
                    IF v_rows IS NOT NULL THEN
                        PERFORM insert_notifications(v_rows);
                    END IF;
                END IF;
                INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
                VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_extension', v_rec.t_org,
                        jsonb_build_object('tournament_id', v_rec.tournament_id,
                                           'effort_p1', v_e1, 'effort_p2', v_e2));
                v_acted := v_acted + 1;
                CONTINUE;
            END IF;
        END IF;

        IF v_has1 <> v_has2 THEN
            -- One-sided effort → walkover for the effortful side.
            IF v_has1 THEN
                v_winner := v_rec.player1_registration_id;
                v_loser  := v_rec.player2_registration_id;
            ELSE
                v_winner := v_rec.player2_registration_id;
                v_loser  := v_rec.player1_registration_id;
            END IF;

            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'winner_registration_id', v_winner,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                UPDATE tournament_matches
                   SET status = 'walkover', winner_registration_id = v_winner,
                       score = 'W/O', played_at = now(),
                       version = version + 1, updated_at = now()
                 WHERE id = v_rec.id;
                PERFORM public.lt_advance_tournament_winner(v_rec.id, v_winner);
                FOREACH v_uid IN ARRAY public.lt_registration_users(v_loser) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, v_winner, false);
            END IF;
            v_acted := v_acted + 1;
        ELSE
            -- Neither side (or extension spent) → double walkover.
            INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
            VALUES ('tournament_match', v_rec.id, v_prefix || 'auto_double_walkover', v_rec.t_org,
                    jsonb_build_object('tournament_id', v_rec.tournament_id,
                                       'effort_p1', v_e1, 'effort_p2', v_e2));
            IF NOT p_dry_run THEN
                PERFORM public.lt_advance_double_walkover(v_rec.id);
                FOREACH v_uid IN ARRAY (public.lt_registration_users(v_rec.player1_registration_id)
                                     || public.lt_registration_users(v_rec.player2_registration_id)) LOOP
                    INSERT INTO reputation_event
                        (player_id, event_type, base_impact, metadata, event_occurred_at)
                    VALUES (v_uid, 'tournament_unresponsive', -15,
                            jsonb_build_object('tournamentId', v_rec.tournament_id,
                                               'tournamentMatchId', v_rec.id), now());
                END LOOP;
                PERFORM public.lt_notify_tournament_walkover(v_rec.id, NULL, true);
                -- Paid draw: a double-walkover side that never completed a
                -- single game paid for nothing. Disqualify it, which queues
                -- the automatic entry refund (fee retained) through the
                -- existing removed-player settle leg and blocks payout release.
                IF v_rec.t_fee > 0 THEN
                    FOREACH v_reg IN ARRAY ARRAY[v_rec.player1_registration_id,
                                                 v_rec.player2_registration_id] LOOP
                        IF NOT EXISTS (
                            SELECT 1 FROM tournament_matches tm2
                             WHERE tm2.tournament_id = v_rec.tournament_id
                               AND tm2.status IN ('completed', 'retired')
                               AND v_reg IN (tm2.player1_registration_id, tm2.player2_registration_id)
                        ) THEN
                            UPDATE tournament_registrations
                               SET status = 'disqualified', withdrawn_at = now(),
                                   version = version + 1, updated_at = now()
                             WHERE id = v_reg AND status = 'registered';
                            IF FOUND THEN
                                INSERT INTO leagues_tournaments_audit
                                    (scope, entity_id, action, actor_id, payload_after)
                                VALUES ('registration', v_reg, 'auto_refund_queued', v_rec.t_org,
                                        jsonb_build_object('tournament_id', v_rec.tournament_id,
                                                           'reason', 'double_walkover_zero_games'));
                            END IF;
                        END IF;
                    END LOOP;
                END IF;
            END IF;
            v_acted := v_acted + 1;
        END IF;
    END LOOP;

    RETURN v_acted;
END;
$$;


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
    v_new_min     numeric;
    v_new_max     numeric;
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
            -- The rating band locks at draft: it is a competitive fact about
            -- the field (and min_rating is a scoring input), so neither bound
            -- can move once players have entered on the strength of it.
            WHEN 'min_rating'     THEN ARRAY['draft']
            WHEN 'max_rating'     THEN ARRAY['draft']
            WHEN 'min_reputation' THEN ARRAY['draft','registration_open']
            WHEN 'facility_id'   THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_name'    THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'venue_address' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'city'          THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'prize_money_cents' THEN ARRAY['draft','registration_open','registration_closed','in_progress']
            WHEN 'max_participants'   THEN ARRAY['draft']
            WHEN 'bracket_type'       THEN ARRAY['draft']
            WHEN 'match_format'       THEN ARRAY['draft']
            WHEN 'points_per_game'    THEN ARRAY['draft']
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

    -- Field size is validated against the MERGED bracket type: knockout
    -- trees need powers of two, pool fields take 8-32 incl. 12/20/24.
    IF p_patch ? 'max_participants' OR p_patch ? 'bracket_type' THEN
        DECLARE
            v_bt   bracket_type := CASE WHEN p_patch ? 'bracket_type'
                                        THEN (p_patch->>'bracket_type')::bracket_type
                                        ELSE v_before.bracket_type END;
            v_size smallint := CASE WHEN p_patch ? 'max_participants'
                                    THEN (p_patch->>'max_participants')::smallint
                                    ELSE v_before.max_participants END;
        BEGIN
            IF v_bt = 'pool_knockout' THEN
                IF v_size NOT IN (8, 12, 16, 20, 24, 32) THEN
                    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MAX_PARTICIPANTS';
                END IF;
            ELSIF v_size NOT IN (4, 8, 16, 32, 64, 128) THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_MAX_PARTICIPANTS';
            END IF;
        END;
    END IF;

    -- The target is a pickleball setting; the CHECK would reject anything else
    -- anyway, but check_violation here maps to INVALID_FEE_SETTINGS downstream.
    IF p_patch ? 'points_per_game'
       AND p_patch->>'points_per_game' IS NOT NULL
       AND (p_patch->>'points_per_game')::smallint NOT IN (11, 15, 21) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_POINTS_PER_GAME';
    END IF;

    IF p_patch ? 'entry_format' AND p_patch->>'entry_format' <> 'singles' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DOUBLES_NOT_SUPPORTED';
    END IF;

    -- Band validity is checked against the merged result: a patch touching only
    -- one bound still has to sit right against the stored other one.
    IF p_patch ? 'min_rating' OR p_patch ? 'max_rating' THEN
        v_new_min := CASE WHEN p_patch ? 'min_rating' THEN (p_patch->>'min_rating')::numeric ELSE v_before.min_rating END;
        v_new_max := CASE WHEN p_patch ? 'max_rating' THEN (p_patch->>'max_rating')::numeric ELSE v_before.max_rating END;
        IF v_new_min IS NOT NULL AND v_new_max IS NOT NULL AND v_new_max < v_new_min THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_RATING_RANGE';
        END IF;
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
        points_per_game = CASE WHEN p_patch ? 'points_per_game'
                               THEN (p_patch->>'points_per_game')::smallint
                               ELSE points_per_game END,
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
        pool_size          = CASE WHEN p_patch ? 'bracket_type' AND p_patch->>'bracket_type' = 'pool_knockout'  THEN COALESCE(pool_size, 4)
                                  WHEN p_patch ? 'bracket_type' AND p_patch->>'bracket_type' <> 'pool_knockout' THEN NULL
                                  ELSE pool_size END,
        qualifiers_per_pool = CASE WHEN p_patch ? 'bracket_type' AND p_patch->>'bracket_type' = 'pool_knockout'  THEN COALESCE(qualifiers_per_pool, 2)
                                   WHEN p_patch ? 'bracket_type' AND p_patch->>'bracket_type' <> 'pool_knockout' THEN NULL
                                   ELSE qualifiers_per_pool END,
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
