-- ============================================================================
-- Participation consent — foundation, gate OFF
-- ----------------------------------------------------------------------------
-- Spec: specs/17-leagues-tournaments/participation-consent.md. Players must
-- accept the conditions générales + décharge de responsabilité when entering a
-- PAID tournament or league season. This migration ships every server-side
-- piece with the gate OFF: the two paid-entry RPCs accept and record the
-- accepted version when the client sends one, and still admit clients that
-- send nothing. The flip to mandatory is a later one-line follow-up, once the
-- mobile build carrying the checkbox is in players' hands — flipping first
-- would brick paid registration for every current client (spec, Rollout §4).
--
--   * lt_participation_terms — one row per published version, per-locale URLs.
--     Current version = max(version). Seeded at v1 with the two web pages
--     shipped in d604e5e5. The stored host is www.rallia.app on every
--     environment: these are public marketing pages, not per-env Supabase
--     resources, so unlike tournament logo_url there is nothing to rewrite.
--   * tournament_registrations / season_members gain terms_version +
--     terms_accepted_at. Nullable: historical rows and free entries stay NULL;
--     a paid entry made through an accepting client carries both.
--   * tournament_begin_paid_registration / season_begin_paid_enrollment gain
--     a trailing p_terms_version integer DEFAULT NULL. DROP + CREATE, not
--     CREATE OR REPLACE: a changed parameter list would otherwise become a
--     SECOND overload (the 20260716 fee-param trap), and PostgREST would pick
--     between them unpredictably. Bodies are verbatim from their latest
--     definitions (20260725120000 / 20260722100000) plus only:
--       - a version check: a client that SENDS a version must send the
--         current one, else TERMS_ACCEPTANCE_REQUIRED (it is showing the
--         player a stale document; the retry after refetch shows the right
--         one). Clients that send nothing pass — that is the gate being off.
--       - stamping terms_version/terms_accepted_at on the reservation row,
--         and the accepted version in the audit payload.
--
-- The paid invite-accept path is covered for free: tournament_accept_invite
-- refuses paid events (PAYMENT_REQUIRED) and routes claimants through
-- begin_paid. The free entry paths are deliberately untouched.
--
-- THE FLIP (do not do it here): in each function, replace the two-line
-- "IF p_terms_version IS NOT NULL" guard with an unconditional check that
-- p_terms_version matches the current version, per the spec §2.
-- ============================================================================

-- ---------------------------------------------------------------- 1. versions
CREATE TABLE IF NOT EXISTS public.lt_participation_terms (
    version      integer PRIMARY KEY CHECK (version > 0),
    url_fr       text NOT NULL,
    url_en       text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lt_participation_terms ENABLE ROW LEVEL SECURITY;

-- World-readable (the registration sheet shows the links pre-auth on deep
-- links); writes only from the dashboard/service role — RLS on, no write
-- policies.
DROP POLICY IF EXISTS lt_participation_terms_select ON public.lt_participation_terms;
CREATE POLICY lt_participation_terms_select ON public.lt_participation_terms
    FOR SELECT USING (true);

GRANT SELECT ON public.lt_participation_terms TO authenticated, anon;

INSERT INTO public.lt_participation_terms (version, url_fr, url_en)
VALUES (
    1,
    'https://www.rallia.app/fr-CA/participation-terms',
    'https://www.rallia.app/en-US/participation-terms'
)
ON CONFLICT (version) DO NOTHING;

COMMENT ON TABLE public.lt_participation_terms IS
  'Published versions of the participation terms + liability waiver pair. '
  'Current = max(version). Each URL page links to its waiver counterpart, so '
  'one URL per locale is enough for the acceptance sentence.';

-- ------------------------------------------------------------- 2. entry rows
ALTER TABLE public.tournament_registrations
    ADD COLUMN IF NOT EXISTS terms_version     integer,
    ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

ALTER TABLE public.season_members
    ADD COLUMN IF NOT EXISTS terms_version     integer,
    ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

-- ------------------------------------------- 3a. tournament paid entry RPC
DROP FUNCTION IF EXISTS public.tournament_begin_paid_registration(uuid, uuid);

CREATE FUNCTION public.tournament_begin_paid_registration(
    p_tournament_id   uuid,
    p_partner_user_id uuid    DEFAULT NULL,
    p_terms_version   integer DEFAULT NULL
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
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Participation terms. Gate OFF: NULL passes (pre-checkbox clients). A
    -- client that sends a version vouches the player accepted THAT text, so a
    -- stale one is refused before any row is written. Flip point: see header.
    IF p_terms_version IS NOT NULL
       AND p_terms_version <> (SELECT max(version) FROM lt_participation_terms) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TERMS_ACCEPTANCE_REQUIRED';
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

    -- ------------------------------------------------- hard rating-band gate
    -- Same rule as tournament_register: organizers live by the band they set,
    -- admins bypass as a support override, and both members of a doubles entry
    -- are checked. Runs before any row is written so nobody pays to be refused.
    v_is_admin := public.is_admin();

    IF NOT v_is_admin THEN
        PERFORM public.lt_assert_rating_band(
            v_caller, v_t.sport_id, v_t.min_rating, v_t.max_rating, false);
        IF v_is_doubles THEN
            PERFORM public.lt_assert_rating_band(
                p_partner_user_id, v_t.sport_id, v_t.min_rating, v_t.max_rating, true);
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
               terms_version   = p_terms_version,
               terms_accepted_at = CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END,
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
        INSERT INTO tournament_registrations (
            tournament_id, user_id, partner_user_id, status,
            terms_version, terms_accepted_at
        )
        VALUES (
            p_tournament_id, v_caller, p_partner_user_id, 'payment_pending',
            p_terms_version, CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END
        )
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
            jsonb_build_object('payment_id', v_pay_id, 'amount_charged_cents', v_total, 'invite_accept', v_is_invite_accept,
                               'terms_version', p_terms_version));

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

GRANT EXECUTE ON FUNCTION public.tournament_begin_paid_registration(uuid, uuid, integer) TO authenticated;

-- ------------------------------------------------ 3b. season paid entry RPC
DROP FUNCTION IF EXISTS public.season_begin_paid_enrollment(uuid);

CREATE FUNCTION public.season_begin_paid_enrollment(
    p_season_id     uuid,
    p_terms_version integer DEFAULT NULL
)
RETURNS TABLE (
    payment_id                  uuid,
    season_user_id              uuid,
    entry_cents                 integer,
    service_fee_cents           integer,
    fee_tax_cents               integer,
    amount_charged_cents        integer,
    organizer_amount_cents      integer,
    fee_payer                   fee_payer_enum,
    payout_timing               payout_timing_enum,
    currency                    varchar(3),
    organizer_id                uuid,
    organizer_stripe_account_id text,
    organizer_onboarded         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_s      seasons;
    v_league leagues;
    v_member season_members;
    v_pct    integer;
    v_flat   integer;
    v_cap    integer;
    v_fee    integer;
    v_tax    integer;
    v_charge integer;
    v_org_amt integer;
    v_pay_id uuid;
    v_acct   record;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    -- Participation terms. Gate OFF: NULL passes (pre-checkbox clients). A
    -- client that sends a version vouches the player accepted THAT text, so a
    -- stale one is refused before any row is written. Flip point: see header.
    IF p_terms_version IS NOT NULL
       AND p_terms_version <> (SELECT max(version) FROM lt_participation_terms) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TERMS_ACCEPTANCE_REQUIRED';
    END IF;

    SELECT * INTO v_s FROM seasons WHERE id = p_season_id;
    IF v_s.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_s.league_id;

    IF v_s.status <> 'open' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_OPEN';
    END IF;

    IF v_s.entry_fee_cents <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_PAID';
    END IF;

    -- Same eligibility gate as season_enroll.
    IF NOT (public.is_league_organizer(v_s.league_id)
            OR public.is_admin()
            OR public.is_active_league_member(v_s.league_id)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_LEAGUE_MEMBER';
    END IF;

    SELECT * INTO v_member FROM season_members
     WHERE season_id = p_season_id AND user_id = v_caller
     FOR UPDATE;

    -- Organizer-removed members are blocked permanently, as on the tournament
    -- side; without this the reuse branch below re-admits them.
    IF v_member.id IS NOT NULL AND v_member.status = 'disqualified' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ENROLLMENT_REMOVED';
    END IF;

    IF v_member.id IS NOT NULL AND v_member.status = 'enrolled' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ALREADY_ENROLLED';
    END IF;

    SELECT p.pct_bps, p.flat_cents, p.cap_cents INTO v_pct, v_flat, v_cap
      FROM public.resolve_service_fee_policy(
             v_league.organizer_id, v_s.fee_pct_bps_override,
             v_s.fee_flat_cents_override, v_s.fee_cap_cents_override) p;

    v_fee := public.compute_service_fee_cents(v_s.entry_fee_cents, v_pct, v_flat, v_cap);
    v_tax := public.compute_fee_tax_cents(v_fee);

    IF v_s.fee_payer = 'player_pays' THEN
        v_charge  := v_s.entry_fee_cents + v_fee + v_tax;
        v_org_amt := v_s.entry_fee_cents;
    ELSE
        v_charge  := v_s.entry_fee_cents;
        v_org_amt := GREATEST(v_s.entry_fee_cents - v_fee - v_tax, 0);
    END IF;

    -- Claim the slot at payment_pending (the trigger above permits exactly this).
    IF v_member.id IS NULL THEN
        INSERT INTO season_members (season_id, user_id, status, terms_version, terms_accepted_at)
        VALUES (p_season_id, v_caller, 'payment_pending',
                p_terms_version, CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END)
        RETURNING * INTO v_member;
    ELSE
        UPDATE season_members
           SET status       = 'payment_pending',
               terms_version = p_terms_version,
               terms_accepted_at = CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END,
               withdrawn_at = NULL,
               version      = version + 1,
               updated_at   = now()
         WHERE id = v_member.id
        RETURNING * INTO v_member;

        -- Supersede any still-pending attempt so only one reservation is live.
        -- Qualified: season_user_id alone is ambiguous against the OUT param.
        UPDATE lt_registration_payment p
           SET status = 'cancelled', updated_at = now()
         WHERE p.season_user_id = v_member.id AND p.status = 'pending';
    END IF;

    INSERT INTO lt_registration_payment (
        season_id, season_user_id, payer_user_id, organizer_id,
        entry_cents, service_fee_cents, fee_tax_cents, fee_payer,
        amount_charged_cents, organizer_amount_cents, currency,
        payout_timing, status, expires_at
    ) VALUES (
        p_season_id, v_member.id, v_caller, v_league.organizer_id,
        v_s.entry_fee_cents, v_fee, v_tax, v_s.fee_payer,
        v_charge, v_org_amt, v_s.currency,
        v_s.payout_timing, 'pending', now() + interval '15 minutes'
    )
    RETURNING id INTO v_pay_id;

    SELECT psa.stripe_account_id, psa.onboarding_completed INTO v_acct
      FROM player_stripe_account psa
     WHERE psa.player_id = v_league.organizer_id;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES ('membership', v_member.id, 'begin_paid_enrollment', v_caller,
            jsonb_build_object('season_id', p_season_id, 'payment_id', v_pay_id,
                               'terms_version', p_terms_version));

    payment_id                  := v_pay_id;
    season_user_id              := v_member.id;
    entry_cents                 := v_s.entry_fee_cents;
    service_fee_cents           := v_fee;
    fee_tax_cents               := v_tax;
    amount_charged_cents        := v_charge;
    organizer_amount_cents      := v_org_amt;
    fee_payer                   := v_s.fee_payer;
    payout_timing               := v_s.payout_timing;
    currency                    := v_s.currency;
    organizer_id                := v_league.organizer_id;
    organizer_stripe_account_id := v_acct.stripe_account_id;
    organizer_onboarded         := COALESCE(v_acct.onboarding_completed, false);

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_begin_paid_enrollment(uuid, integer) TO authenticated;
