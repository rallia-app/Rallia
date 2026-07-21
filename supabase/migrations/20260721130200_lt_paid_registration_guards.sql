-- Give the paid registration path the guards the free path already has.
--
-- tournament_begin_paid_registration was written as a payment concern and never
-- picked up the entry rules that accumulated in tournament_register. Paying is
-- currently a way around all of them:
--
--   • min_rating: the hard gate added in 20260716210000 went into
--     tournament_register only. A below-floor or unrated player cannot register
--     for free but can pay their way into a rating-gated draw, and from there
--     into Circuit Rallia scoring, which is exactly what the floor exists to
--     prevent.
--   • partner/doubles: p_partner_user_id was stored with no validation at all.
--     A paid captain could name a partner who doesn't exist, doesn't play the
--     sport, is themselves, or is already in another entry, which the free path
--     refuses with PARTNER_ALREADY_REGISTERED. A singles draw accepted a
--     partner, and a doubles draw accepted an entry with none.
--   • disqualified: the free path blocks an organizer-removed player
--     permanently. Here a 'disqualified' row fell through to the reuse branch
--     and became payment_pending, so a removed player could buy their way back.
--   • capacity race: tournament_register takes FOR UPDATE on the tournament so
--     concurrent registrations serialize (20260527000200 added it for exactly
--     this). The paid path read the row unlocked, so N concurrent callers at
--     capacity-1 could all pass the check and all reserve.
--
-- Everything is checked before the slot is reserved and the ledger row written,
-- so a rejected entrant is never charged.

CREATE OR REPLACE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    registration_id             uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
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
    v_fee_tax  integer;
    v_total    integer;
    v_org      integer;
    v_active   integer;
    v_existing tournament_registrations;
    v_reg      tournament_registrations;
    v_psa      player_stripe_account;
    v_pay_id   uuid;
    v_is_invite_accept boolean := false;
    v_is_doubles     boolean;
    v_is_admin       boolean;
    v_caller_rating  double precision;
    v_partner_rating double precision;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Row-lock so the capacity count below and the reservation can't race.
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
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

    -- ---------------------------------------------- partner / entry format
    v_is_doubles := v_t.entry_format <> 'singles';

    IF NOT v_is_doubles AND p_partner_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_NOT_ALLOWED';
    END IF;

    IF v_is_doubles THEN
        IF p_partner_user_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_REQUIRED';
        END IF;
        IF p_partner_user_id = v_caller
           OR NOT EXISTS (SELECT 1 FROM player WHERE id = p_partner_user_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM player_sport ps
             WHERE ps.player_id = p_partner_user_id
               AND ps.sport_id  = v_t.sport_id
               AND ps.is_active = true
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_SPORT_MISMATCH';
        END IF;
        -- Already in a live entry, as captain or partner. 'Live' includes a
        -- payment still in its window, matching the capacity rule below: an
        -- expired reservation frees the player once the reaper clears it.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             LEFT JOIN lt_registration_payment p
               ON p.tournament_registration_id = r.id AND p.status = 'pending'
             WHERE r.tournament_id = p_tournament_id
               AND (r.user_id = p_partner_user_id OR r.partner_user_id = p_partner_user_id)
               AND (
                    r.status IN ('registered', 'pending', 'waitlisted')
                    OR (r.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
               )
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_ALREADY_REGISTERED';
        END IF;
        -- UNIQUE(tournament_id, user_id) only covers captains, so check the
        -- caller isn't already somebody else's partner.
        IF EXISTS (
            SELECT 1 FROM tournament_registrations r
             LEFT JOIN lt_registration_payment p
               ON p.tournament_registration_id = r.id AND p.status = 'pending'
             WHERE r.tournament_id   = p_tournament_id
               AND r.partner_user_id = v_caller
               AND (
                    r.status IN ('registered', 'pending', 'waitlisted')
                    OR (r.status = 'payment_pending' AND p.id IS NOT NULL AND p.expires_at > now())
               )
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_REGISTERED';
        END IF;
    END IF;

    -- ------------------------------------------------------ hard level gate
    -- Same rule as tournament_register: organizers live by the floor they set,
    -- admins bypass as a support override, and both members of a doubles entry
    -- are checked. Runs before any row is written so nobody pays to be refused.
    v_is_admin := public.is_admin();

    SELECT rs.value INTO v_caller_rating
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE ps.player_id = v_caller
       AND ps.sport_id  = v_t.sport_id;

    IF v_is_doubles THEN
        SELECT rs.value INTO v_partner_rating
          FROM player_sport ps
          JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          JOIN rating_score rs ON rs.id = prs.rating_score_id
         WHERE ps.player_id = p_partner_user_id
           AND ps.sport_id  = v_t.sport_id;
    END IF;

    IF v_t.min_rating IS NOT NULL AND NOT v_is_admin THEN
        IF v_caller_rating IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATING_REQUIRED';
        END IF;
        IF v_caller_rating < v_t.min_rating THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RATING_TOO_LOW';
        END IF;
        IF v_is_doubles THEN
            IF v_partner_rating IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_RATING_REQUIRED';
            END IF;
            IF v_partner_rating < v_t.min_rating THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARTNER_RATING_TOO_LOW';
            END IF;
        END IF;
    END IF;

    -- The caller's existing row. An outstanding organizer invite (pending +
    -- invited_by) lets them pay to claim the reserved slot even when the
    -- tournament isn't in 'open' registration mode.
    SELECT * INTO v_existing
      FROM tournament_registrations
     WHERE tournament_id = p_tournament_id AND user_id = v_caller;
    v_is_invite_accept := v_existing.id IS NOT NULL
                          AND v_existing.status = 'pending'
                          AND v_existing.invited_by IS NOT NULL;

    -- Organizer-removed players are blocked permanently, as in the free path.
    -- Checked before capacity so they get REGISTRATION_REMOVED, not
    -- TOURNAMENT_FULL.
    IF v_existing.id IS NOT NULL AND v_existing.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REGISTRATION_REMOVED';
    END IF;

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

    -- Resolve the effective fee (+ tax on it) and snapshot the breakdown.
    SELECT * INTO v_pol FROM public.resolve_service_fee_policy(
        v_t.organizer_id, v_t.fee_pct_bps_override, v_t.fee_flat_cents_override, v_t.fee_cap_cents_override);
    v_fee     := public.compute_service_fee_cents(v_t.entry_fee_cents, v_pol.pct_bps, v_pol.flat_cents, v_pol.cap_cents);
    v_fee_tax := public.compute_fee_tax_cents(v_fee);

    IF v_t.fee_payer = 'player_pays' THEN
        v_total := v_t.entry_fee_cents + v_fee + v_fee_tax;
        v_org   := v_t.entry_fee_cents;
    ELSE
        v_total := v_t.entry_fee_cents;
        v_org   := GREATEST(v_t.entry_fee_cents - v_fee - v_fee_tax, 0);
    END IF;

    INSERT INTO lt_registration_payment (
        tournament_registration_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        v_reg.id, v_caller, v_t.organizer_id,
        v_t.entry_fee_cents, v_fee, v_fee_tax, v_t.fee_payer,
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
    fee_tax_cents               := v_fee_tax;
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
