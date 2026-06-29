-- ============================================================================
-- Paid tournaments: organizer invites + invited-player payment.
--
-- The paid-registration build (20260629110100) deferred the invite path:
--   • tg_tournament_registration_requires_payment rejected ANY non
--     'payment_pending' insert into a paid tournament — so tournament_invite_players,
--     which inserts a 'pending' invite row, raised PAYMENT_REQUIRED.
--   • begin_paid_registration only supported registration_mode='open' and its
--     ALREADY_REGISTERED guard tripped on a pending invite row.
--
-- Product decision: invited players still pay. So:
--   1. Allow the organizer-invite insert (pending + invited_by) — it just reserves
--      a slot, it is not a confirmed paid entry.
--   2. Force the invitee to pay: tournament_accept_invite now refuses paid
--      tournaments (defense-in-depth — a confirmed spot must go through Stripe).
--   3. begin_paid_registration lets an invited player pay to claim their pending
--      invite (any registration_mode), flipping it to payment_pending; the webhook
--      finalizes to 'registered' exactly as for self-registration.
-- ============================================================================

-- 1. Allow organizer-invite pending rows through the payment guard.
CREATE OR REPLACE FUNCTION public.tg_tournament_registration_requires_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_fee integer;
BEGIN
    SELECT entry_fee_cents INTO v_fee FROM tournaments WHERE id = NEW.tournament_id;
    -- A paid slot may only be reserved by the payment flow (payment_pending) or
    -- held as an outstanding organizer invite (pending + invited_by); the invitee
    -- pays to convert that hold into a confirmed registration.
    IF COALESCE(v_fee, 0) > 0
       AND NEW.status <> 'payment_pending'
       AND NOT (NEW.status = 'pending' AND NEW.invited_by IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
    END IF;
    RETURN NEW;
END;
$$;


-- 2. A paid tournament's invite cannot be accepted for free: route through payment.
CREATE OR REPLACE FUNCTION public.tournament_accept_invite(
    p_tournament_id uuid,
    p_partner_id    uuid DEFAULT NULL
)
RETURNS tournament_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id    uuid := auth.uid();
    v_tournament   tournaments;
    v_is_doubles   boolean;
    v_existing     tournament_registrations;
    v_row          tournament_registrations;
    v_captain_name text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_tournament.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;

    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id
       AND user_id       = v_caller_id
       AND status        = 'pending'
       AND invited_by IS NOT NULL;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_INVITED';
    END IF;

    -- Paid tournaments: claiming the invite must go through Stripe
    -- (tournament_begin_paid_registration). Don't grant a free confirmed spot.
    IF COALESCE(v_tournament.entry_fee_cents, 0) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_REQUIRED';
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
             WHERE r.tournament_id = p_tournament_id
               AND r.id <> v_existing.id
               AND r.status IN ('registered', 'pending', 'waitlisted')
               AND (r.user_id = p_partner_id OR r.partner_user_id = p_partner_id)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
    END IF;

    UPDATE tournament_registrations
       SET status          = 'registered',
           partner_user_id = CASE WHEN v_is_doubles THEN p_partner_id ELSE partner_user_id END,
           approved_at     = now(),
           version         = version + 1,
           updated_at      = now()
     WHERE id = v_existing.id
    RETURNING * INTO v_row;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_row.id, 'accept_invite', v_caller_id,
            jsonb_build_object('tournament_id', p_tournament_id, 'status', v_row.status, 'partner_user_id', v_row.partner_user_id));

    IF v_is_doubles AND p_partner_id IS NOT NULL THEN
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

GRANT EXECUTE ON FUNCTION public.tournament_accept_invite(uuid, uuid) TO authenticated;


-- 3. Let an invited player pay to claim their pending invite slot.
CREATE OR REPLACE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    registration_id             uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    amount_charged_cents        integer,
    organizer_amount_cents      integer,
    fee_payer                   fee_payer_enum,
    payout_timing               payout_timing_enum,
    currency                    varchar,
    organizer_id                uuid,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller   uuid := auth.uid();
    v_t        tournaments;
    v_pol      record;
    v_fee      integer;
    v_total    integer;
    v_org      integer;
    v_active   integer;
    v_existing tournament_registrations;
    v_reg      tournament_registrations;
    v_psa      player_stripe_account;
    v_pay_id   uuid;
    v_is_invite_accept boolean := false;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;

    PERFORM public.assert_caller_plays_sport(v_t.sport_id);

    IF v_t.status <> 'registration_open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_REG_CLOSED';
    END IF;
    IF v_t.entry_fee_cents <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_PAID';
    END IF;

    -- The caller's existing row, resolved up-front. An outstanding organizer
    -- invite (pending + invited_by) lets them pay to claim the reserved slot,
    -- even when the tournament isn't in 'open' registration mode.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id AND user_id = v_caller;
    v_is_invite_accept := v_existing.id IS NOT NULL
                          AND v_existing.status = 'pending'
                          AND v_existing.invited_by IS NOT NULL;

    -- Paid approval flows (pay vs. approval ordering) are a later slice; the one
    -- non-open path supported here is claiming an organizer invite.
    IF v_t.registration_mode <> 'open' AND NOT v_is_invite_accept THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAID_REG_MODE_UNSUPPORTED';
    END IF;

    -- Capacity: count everyone else's live slots (active or a non-expired
    -- pending payment). The caller's own row never blocks them.
    SELECT count(*) INTO v_active
      FROM tournament_registrations tr
      LEFT JOIN lt_registration_payment p
        ON p.tournament_registration_id = tr.id AND p.status = 'pending'
     WHERE tr.tournament_id = p_tournament_id
       AND tr.user_id <> v_caller
       AND (
            tr.status IN ('registered', 'pending')
            OR (tr.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
       );
    IF v_active >= v_t.max_participants THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_FULL';
    END IF;

    -- Reuse the caller's existing row if present; block if already confirmed or a
    -- non-invite pending (e.g. approval-mode self-register awaiting the organizer).
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.status = 'registered'
           OR (v_existing.status = 'pending' AND NOT v_is_invite_accept) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
        UPDATE tournament_registrations
           SET status          = 'payment_pending',
               partner_user_id = p_partner_user_id,
               withdrawn_at    = NULL,
               version         = version + 1,
               updated_at      = now()
         WHERE id = v_existing.id
        RETURNING * INTO v_reg;

        -- Supersede any still-open pending payment for this registration.
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE tournament_registration_id = v_reg.id AND status = 'pending';
    ELSE
        INSERT INTO tournament_registrations (tournament_id, user_id, partner_user_id, status)
        VALUES (p_tournament_id, v_caller, p_partner_user_id, 'payment_pending')
        RETURNING * INTO v_reg;
    END IF;

    -- Resolve the effective fee and snapshot the breakdown.
    SELECT * INTO v_pol FROM public.resolve_service_fee_policy(
        v_t.organizer_id, v_t.fee_pct_bps_override, v_t.fee_flat_cents_override, v_t.fee_cap_cents_override);
    v_fee := public.compute_service_fee_cents(v_t.entry_fee_cents, v_pol.pct_bps, v_pol.flat_cents, v_pol.cap_cents);

    IF v_t.fee_payer = 'player_pays' THEN
        v_total := v_t.entry_fee_cents + v_fee;
        v_org   := v_t.entry_fee_cents;
    ELSE
        v_total := v_t.entry_fee_cents;
        v_org   := GREATEST(v_t.entry_fee_cents - v_fee, 0);
    END IF;

    INSERT INTO lt_registration_payment (
        tournament_registration_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_fee, v_t.fee_payer,
        v_total, v_org, v_t.currency,
        v_t.payout_timing, 'pending', now() + interval '15 minutes'
    ) RETURNING id INTO v_pay_id;

    SELECT * INTO v_psa FROM player_stripe_account WHERE player_id = v_t.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('registration', v_reg.id, 'begin_paid_registration', v_caller,
            jsonb_build_object('payment_id', v_pay_id, 'amount_charged_cents', v_total, 'invite_accept', v_is_invite_accept));

    payment_id                  := v_pay_id;
    registration_id             := v_reg.id;
    entry_cents                 := v_t.entry_fee_cents;
    service_fee_cents           := v_fee;
    amount_charged_cents        := v_total;
    organizer_amount_cents      := v_org;
    fee_payer                   := v_t.fee_payer;
    payout_timing               := v_t.payout_timing;
    currency                    := v_t.currency;
    organizer_id                := v_t.organizer_id;
    organizer_stripe_account_id := v_psa.stripe_account_id;
    organizer_onboarded         := COALESCE(v_psa.onboarding_completed, false);
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tournament_begin_paid_registration(uuid, uuid) TO authenticated;
