-- Two ways a paid player could lose their entry money with no recourse.
--
-- 1. tournament_withdraw has no payment awareness (its latest body, in
--    20260623180000, gates only on registration_open). A paid registrant who
--    reaches it is withdrawn with no refund, the ledger stays 'succeeded', and
--    lt_release_candidates hands the entry to the organizer at completion. Only
--    client-side routing kept paid players out of it. Send them to
--    tournament_request_refund, which withdraws AND refunds per policy — and
--    still withdraws cleanly when the policy is 'none'.
--
--    A doubles partner is deliberately blocked too: tournament_request_refund
--    is captain-only (user_id = auth.uid()), so letting the partner withdraw
--    here would forfeit the captain's money. The captain withdraws the entry.
--
-- 2. tournament_remove_registration (20260612140000) sets 'disqualified' with no
--    refund path, and 'disqualified' is terminal: the player can't self-refund
--    (tournament_request_refund's status filter excludes it) or re-register. The
--    organizer keeps the entry and the player has no recourse.
--
--    Refunding is the safer default by a wide margin. The player did not choose
--    to leave, keeping their money invites chargebacks, and the alternative
--    failure mode is an organizer collecting entries and removing everyone. So
--    treat an involuntary removal like a cancellation for that one entry: full
--    entry back, Rallia's fee retained, executed by the same hourly settle cron.
--    (This is a policy choice. If organizers should instead keep the entry when
--    they remove someone, drop the third leg added to the candidate query.)

-- --------------------------------------------------------------- 1. withdraw
-- Verbatim from 20260623180000 with only the paid guard added.
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

    -- A paid entry must exit through tournament_request_refund, which withdraws
    -- and refunds in one operation. Withdrawing here forfeits the entry: the
    -- ledger stays 'succeeded' and lt_release_candidates hands it to the
    -- organizer at completion. Until now only client-side routing prevented it.
    --
    -- This blocks a doubles partner as well as the captain. That is deliberate:
    -- tournament_request_refund is captain-only (user_id = auth.uid()), so a
    -- partner withdrawing here would forfeit money that isn't theirs. The
    -- captain withdraws the entry.
    IF EXISTS (
        SELECT 1 FROM lt_registration_payment p
         WHERE p.tournament_registration_id = p_registration_id
           AND p.status = 'succeeded'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAID_USE_REFUND';
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

GRANT EXECUTE ON FUNCTION public.tournament_withdraw(uuid, integer) TO authenticated;

-- ------------------------------------------------- 2. removal queues a refund
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
    -- Removed-player leg: the organizer took one entry off the roster. The
    -- player didn't choose to leave, so the entry goes back the same way a
    -- cancellation returns it; Rallia's fee is retained either way.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND r.status = 'disqualified'
       AND t.status <> 'cancelled'   -- already covered by the leg above
    UNION ALL
    -- Season leg: this is why season_status needed a 'cancelled' value at all.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN season_members sm ON sm.id = p.season_user_id
      JOIN seasons s ON s.id = p.season_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND s.status = 'cancelled';
$function$;

-- ------------------------------------- 3. don't pay out a refunded removal
-- With removals now queued for refund, a disqualified player's payment matches
-- BOTH lt_cancel_refund_candidates and lt_release_candidates while it is still
-- 'succeeded'. If the release ran first the organizer would be paid for the
-- entry and the refund would then claw it back out of their balance. Exclude
-- removed players from the payout side so the two can't fight.
--
-- Only 'disqualified' is excluded, not 'withdrawn': withdrawing after
-- registration closes is a voluntary forfeit and the organizer does keep that
-- entry, which is why the tournament leg never filtered on registration status.
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
       AND r.status <> 'disqualified'
    UNION ALL
    -- Season leg: a season's "event end" is its close, guarded by the same 24h
    -- settle delay so late corrections/refunds land first.
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
       AND s.closed_at < now() - interval '24 hours';
$function$;
