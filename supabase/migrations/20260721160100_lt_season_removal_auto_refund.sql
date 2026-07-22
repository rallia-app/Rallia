-- Mirror the tournament involuntary-exit design (20260721130300) on the season
-- side, replacing the explicit organizer-refund RPC added in 20260721150000.
--
-- Before: season_remove_member refused a live-paid member (REFUND_REQUIRED) and
-- the organizer had to call season_refund_member, which ran an immediate Stripe
-- refund through the edge function. That worked but gave the two modules two
-- different money paths for the same act. Tournaments treat an organizer removal
-- as an involuntary exit: the registration goes to 'disqualified' and the hourly
-- settle cron refunds it via lt_cancel_refund_candidates, the same path a
-- cancellation uses. One money path is easier to reason about and keep correct,
-- and the "immediate" refund was largely cosmetic (Stripe takes days to land on
-- the card regardless).
--
-- So: removal now marks the member 'disqualified', a new candidate leg queues the
-- refund, the release side excludes disqualified members, and the explicit RPC
-- is dropped.

-- ------------------------------------------------ 1. removal marks disqualified
CREATE OR REPLACE FUNCTION public.season_remove_member(
    p_season_member_id uuid,
    p_version_was      integer
)
RETURNS season_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_member    season_members;
    v_season    seasons;
    v_row       season_members;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_member FROM season_members WHERE id = p_season_member_id FOR UPDATE;
    IF v_member.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MEMBER_NOT_FOUND';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = v_member.season_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_member.status NOT IN ('enrolled', 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_REMOVABLE';
    END IF;
    IF v_member.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;

    -- 'disqualified' is the involuntary-exit marker, distinct from the voluntary
    -- 'withdrawn'. A live paid entry (succeeded, not yet released) then matches
    -- the removed leg of lt_cancel_refund_candidates and the cron refunds it; a
    -- free entry just drops off the roster. No money guard is needed here: the
    -- release side excludes disqualified members, and the refund leg is gated on
    -- the payout not having gone out, so a removal can neither strand money nor
    -- claw back an entry already settled to the organizer.
    UPDATE season_members
       SET status       = 'disqualified',
           withdrawn_at  = now(),
           version       = version + 1,
           updated_at    = now()
     WHERE id = v_member.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_row.id, 'remove_member', v_caller_id,
            jsonb_build_object('season_id', v_row.season_id, 'league_id', v_season.league_id,
                               'user_id', v_row.user_id, 'prev_status', v_member.status));

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_remove_member(uuid, integer) TO authenticated;

-- ---------------------------------------------- 2. removal queues a season refund
-- Rebuilds the candidate set on top of the 20260721130300 version, adding a
-- fourth leg for a removed (disqualified) season member. Unlike the tournament
-- removed leg it also checks stripe_payout_id IS NULL: season removal is allowed
-- after a season closes, by which point the entry may already have been released
-- to the organizer, and a completed-and-settled entry must not be clawed back.
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
    -- Tournament removed-player leg.
    SELECT p.id, p.stripe_payment_intent_id, p.stripe_charge_id, p.entry_cents,
           p.currency, p.payout_timing, p.released_transfer_id
      FROM lt_registration_payment p
      JOIN tournament_registrations r ON r.id = p.tournament_registration_id
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE p.status = 'succeeded'
       AND p.entry_cents > 0
       AND r.status = 'disqualified'
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

-- ------------------------------------- 3. don't pay out a removed season member
-- A disqualified member's succeeded payment must not be released to the
-- organizer: it is queued for refund instead (leg 4 above). Mirrors the
-- r.status <> 'disqualified' exclusion the tournament leg already has.
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

-- --------------------------------------- 4. drop the now-unused explicit refund
-- season_refund_member (20260721150000) is superseded by the removal-auto-refund
-- path above; the edge function's asOrganizer branch and the app hook that
-- called it go away with it.
DROP FUNCTION IF EXISTS public.season_refund_member(uuid, integer);
