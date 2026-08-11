-- ============================================================================
-- Mid-pool forfeit: tell the opponents, and stop refunding the entry.
--
-- 1. NOTIFY THE OPPONENTS
--    tournament_forfeit_registration turns the leaver's unplayed pool games
--    into walkover wins, but said nothing to the players who received them.
--    They found out by opening the pool, if they opened it. In distributed
--    mode a player who is not told stays home waiting to arrange a game that
--    no longer exists.
--
--    No new notification type: tournament_match_walkover already exists
--    (20260810230100) and is wired through every client mapping, icon, label
--    and preference toggle. The moment is identical for the player, only the
--    cause differs, so lt_notify_pool_forfeit reuses it with its own copy.
--    The leaver already hears about it: the tournament_registrations status
--    trigger (branch C, 20260624100000) fires on registered -> disqualified.
--
-- 2. THE ENTRY IS NO LONGER REFUNDED
--    lt_cancel_refund_candidates' removed-player leg keys on status
--    'disqualified', which is what BOTH exits write, so forfeiting a player
--    mid-pools queued them a full refund exactly like a pre-draw removal.
--    Those two are not the same event. Before the draw nothing has been
--    played and the entry never bought anything; mid-pools the player had
--    their window and their opponents rearranged their tournament around
--    them. 20260811100000 already holds this line for the double-walkover
--    case ("sides that did play keep the normal no-refund outcome: they had
--    their window"); this extends it to the organizer-driven exit.
--
--    A third path also writes 'disqualified' on purpose to BUY the refund:
--    lt_resolve_due_tournament_matches disqualifies a paid double-walkover
--    side that never completed a single game. That one must keep refunding,
--    so the discriminator cannot be the status. New forfeited_at column,
--    written only by tournament_forfeit_registration, carries it.
--
--    The money then settles like any played entry: excluded from the refund
--    leg, and put back into lt_release_candidates so the organizer's share
--    is paid out at completion instead of sitting on a 'succeeded' payment
--    row that nothing would ever settle. Rallia's service fee is retained
--    either way, as everywhere else.
--
-- lt_cancel_refund_candidates and lt_release_candidates are re-issued from
-- 20260721160100 (verified byte-identical against the live local database
-- before editing) with one clause changed each; every other leg is untouched.
-- ============================================================================

-- ------------------------------------------------------------ 1. the marker
ALTER TABLE public.tournament_registrations
    ADD COLUMN IF NOT EXISTS forfeited_at timestamptz;

COMMENT ON COLUMN public.tournament_registrations.forfeited_at IS
    'Set by tournament_forfeit_registration when an organizer removes a player '
    'mid-pools. Distinguishes that exit from a pre-draw removal, which shares '
    'the disqualified status: a forfeited entry is not refunded and is released '
    'to the organizer at completion.';

-- ------------------------------------------------- 2. the opponents' notice
-- One notice per walkover created, to the side that received it. Recipients
-- are restricted to still-registered entries: when two players in the same
-- pool forfeit in turn, their mutual game was already settled by the first
-- call, so the second never re-notifies a player who is themselves out.
CREATE OR REPLACE FUNCTION public.lt_notify_pool_forfeit(
    p_registration_id uuid,
    p_match_ids       uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t     tournaments;
    v_name  text;
    v_rows  jsonb;
BEGIN
    IF p_match_ids IS NULL OR array_length(p_match_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    SELECT t.* INTO v_t
      FROM tournaments t
      JOIN tournament_registrations r ON r.tournament_id = t.id
     WHERE r.id = p_registration_id;
    IF v_t.id IS NULL THEN
        RETURN;
    END IF;

    v_name := coalesce(public.lt_registration_display_name(p_registration_id),
                       CASE WHEN public.lt_user_is_fr(auth.uid())
                            THEN 'Un joueur' ELSE 'A player' END);

    WITH winners AS (
        SELECT tm.winner_registration_id AS reg
          FROM tournament_matches tm
         WHERE tm.id = ANY (p_match_ids)
           AND tm.winner_registration_id IS NOT NULL
    ),
    recipients AS (
        SELECT DISTINCT u AS user_id
          FROM winners w
          JOIN tournament_registrations r ON r.id = w.reg AND r.status = 'registered'
          CROSS JOIN LATERAL unnest(public.lt_registration_users(w.reg)) u
    )
    SELECT jsonb_agg(jsonb_build_object(
        'user_id', rc.user_id,
        'type', 'tournament_match_walkover',
        'target_id', v_t.id,
        'title', CASE WHEN public.lt_user_is_fr(rc.user_id)
                   THEN 'Partie réglée par forfait' ELSE 'Game settled by walkover' END,
        'body', CASE WHEN public.lt_user_is_fr(rc.user_id)
                  THEN v_t.name || ' : ' || v_name || ' a quitté le tournoi. '
                       || 'Tu gagnes votre partie de poule par forfait.'
                  ELSE v_t.name || ': ' || v_name || ' left the tournament. '
                       || 'You win your pool game by walkover.'
                END,
        'payload', jsonb_build_object(
            'tournamentId', v_t.id,
            'tournamentName', v_t.name,
            'forfeitedRegistrationId', p_registration_id
        ),
        'priority', 'high'
    ))
    INTO v_rows
    FROM recipients rc;

    IF v_rows IS NOT NULL THEN
        PERFORM insert_notifications(v_rows);
    END IF;
END;
$$;

-- ------------------------------ 3. forfeit: mark the entry, notify the field
-- Body from 20260810190000. Three changes: forfeited_at is stamped, the
-- walkover UPDATE returns the rows it touched instead of only counting them,
-- and the opponents are notified.
CREATE OR REPLACE FUNCTION public.tournament_forfeit_registration(
    p_registration_id uuid,
    p_version_was     integer,
    p_reason          text DEFAULT NULL
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_reg        tournament_registrations;
    v_tournament tournaments;
    v_row        tournament_registrations;
    v_settled    integer;
    v_match_ids  uuid[];
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT r.* INTO v_reg FROM tournament_registrations r WHERE r.id = p_registration_id;
    IF v_reg.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    IF NOT (public.is_tournament_organizer(v_reg.tournament_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_reg.tournament_id FOR UPDATE;
    -- Pool phase only: pools exist, knockout not yet generated. Knockout-phase
    -- exits stay on the override/walkover path like single elimination.
    IF v_tournament.bracket_type <> 'pool_knockout'
       OR v_tournament.status <> 'in_progress'
       OR EXISTS (
           SELECT 1 FROM tournament_matches
            WHERE tournament_id = v_tournament.id AND bracket_side = 'main'
       )
       OR NOT EXISTS (
           SELECT 1 FROM tournament_matches
            WHERE tournament_id = v_tournament.id AND bracket_side = 'pool'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FORFEIT_NOT_ALLOWED';
    END IF;

    UPDATE tournament_registrations
       SET status       = 'disqualified',
           withdrawn_at = now(),
           forfeited_at = now(),
           version      = version + 1,
           updated_at   = now()
     WHERE id      = p_registration_id
       AND version = p_version_was
       AND status  = 'registered'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM tournament_registrations
             WHERE id = p_registration_id AND version <> p_version_was
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_NOT_FOUND';
    END IF;

    WITH settled AS (
        UPDATE tournament_matches tm
           SET status                 = 'walkover',
               winner_registration_id = CASE WHEN tm.player1_registration_id = p_registration_id
                                             THEN tm.player2_registration_id
                                             ELSE tm.player1_registration_id END,
               played_at              = now(),
               version                = version + 1,
               updated_at             = now()
         WHERE tm.tournament_id = v_tournament.id
           AND tm.bracket_side  = 'pool'
           AND tm.status IN ('pending', 'in_progress', 'disputed')
           AND p_registration_id IN (tm.player1_registration_id, tm.player2_registration_id)
        RETURNING tm.id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]), count(*)::int
      INTO v_match_ids, v_settled
      FROM settled;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'registration', v_row.id, 'pool_forfeit', v_caller_id,
        jsonb_build_object(
            'tournament_id', v_row.tournament_id,
            'user_id', v_row.user_id,
            'reason', p_reason,
            'walkovers_created', v_settled
        )
    );

    PERFORM public.lt_notify_pool_forfeit(v_row.id, v_match_ids);

    RETURN v_row;
END;
$$;

-- --------------------------------------- 4. a forfeited entry is not refunded
-- Body from 20260721160100 with one clause added to the tournament
-- removed-player leg. The tournament-cancel, season-cancel and season-removal
-- legs are unchanged, and so is the double-walkover refund, which reaches this
-- leg through status alone and never sets forfeited_at.
CREATE OR REPLACE FUNCTION public.lt_cancel_refund_candidates()
 RETURNS TABLE(payment_id uuid, stripe_payment_intent_id text, stripe_charge_id text, entry_cents integer, currency character varying, payout_timing payout_timing_enum, released_transfer_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    -- Tournament leg: the organizer called the whole event off.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND t.status = 'cancelled'
    UNION ALL
    -- Tournament removed-player leg. forfeited_at excludes the mid-pool exit:
    -- that player had their window, so the entry stays with the event.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND r.status = 'disqualified'
       AND r.forfeited_at IS NULL
       AND t.status <> 'cancelled'
    UNION ALL
    -- Season cancel leg.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND s.status = 'cancelled'
    UNION ALL
    -- Season removed-player leg. payout_id IS NULL keeps an already-settled entry
    -- (removed after the season closed and paid out) from being clawed back.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND sm.status = 'disqualified'
       AND p.stripe_payout_id IS NULL
       AND s.status <> 'cancelled';   -- cancel leg already covers these
$function$;

-- ------------------------------- 5. and it settles to the organizer instead
-- Body from 20260721160100 with the tournament leg's disqualified exclusion
-- widened to let a forfeited entry through. Without this the payment would be
-- refused by both the refund sweep and the payout sweep and sit 'succeeded'
-- forever. The season leg is unchanged.
CREATE OR REPLACE FUNCTION public.lt_release_candidates()
 RETURNS TABLE(payment_id uuid, stripe_charge_id text, organizer_id uuid, organizer_amount_cents integer, currency character varying, organizer_stripe_account_id text, organizer_onboarded boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT p.id, p.stripe_charge_id, p.organizer_id, p.organizer_amount_cents, p.currency,
           psa.stripe_account_id, COALESCE(psa.onboarding_completed, false)
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
      LEFT JOIN player_stripe_account psa ON psa.player_id = p.organizer_id
     WHERE p.status = 'succeeded'
       AND p.stripe_payout_id IS NULL
       AND p.organizer_amount_cents > 0
       AND t.status = 'completed'
       AND t.end_date < now() - interval '24 hours'
       AND (r.status <> 'disqualified' OR r.forfeited_at IS NOT NULL)
    UNION ALL
    -- Season leg: a season's "event end" is its close, guarded by the same 24h
    -- settle delay so late corrections/refunds land first. Removed (disqualified)
    -- members are excluded so their entry is refunded, not paid out.
    SELECT p.id, p.stripe_charge_id, p.organizer_id, p.organizer_amount_cents, p.currency,
           psa.stripe_account_id, COALESCE(psa.onboarding_completed, false)
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
      LEFT JOIN player_stripe_account psa ON psa.player_id = p.organizer_id
     WHERE p.status = 'succeeded'
       AND p.stripe_payout_id IS NULL
       AND p.organizer_amount_cents > 0
       AND s.status = 'closed'
       AND s.closed_at < now() - interval '24 hours'
       AND sm.status <> 'disqualified';
$function$;
