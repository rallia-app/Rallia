-- ============================================================================
-- L&T payout gate: check charges_enabled, not onboarding_completed
-- ============================================================================
-- `tournament_open_registration` and `season_open` refuse to publish a PAID
-- event unless the organizer can be paid out. Both were testing
-- `player_stripe_account.onboarding_completed`, which is the wrong column.
--
-- Why it matters. The v0 money model settles entries with a destination charge
-- carrying `on_behalf_of` = the organizer's connected account, so Stripe needs
-- card_payments + transfers ACTIVE on that account. `charges_enabled` is the
-- flag that reflects it. `onboarding_completed` predates the model: it was set
-- by the old transfers-only court-reimbursement flow, and on staging today all
-- three connected accounts sit at `onboarding_completed = true` with
-- `charges_enabled = false, details_submitted = false` — the Stripe Express
-- form was never filled. The gate therefore passes and lets an organizer open
-- a paid event that no player can actually pay for: every registration fails
-- at Stripe with an opaque error instead of being refused up front.
--
-- Three parts, because the gate is not the only reader:
--   1. The two gates now test `charges_enabled`.
--   2. Legacy rows are corrected, so `onboarding_completed` stops lying. That
--      also fixes `tournament_begin_paid_registration` and
--      `season_begin_paid_enrollment`, which pass the flag through to
--      `lt-create-registration-payment` as `organizer_onboarded` and are left
--      untouched here.
--   3. A trigger keeps the two columns in step so they cannot drift again.
--      `stripe-connect-webhook` already writes them equal
--      (`onboarding_completed: isReady, charges_enabled: isReady`), and
--      `player-stripe-onboard` inserts neither, so this only pins an invariant
--      both writers already respect.
--
-- Effect on staging: nobody can open a paid season or paid tournament until a
-- real Stripe Express onboarding completes. That is the point.
-- ============================================================================

-- ---------------------------------------------------------------- 1. gates

CREATE OR REPLACE FUNCTION public.tournament_open_registration(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS tournaments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_caller_id uuid := auth.uid();
    v_t         tournaments;
    v_row       tournaments;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    -- Paid events require an organizer who can act as settlement merchant.
    -- charges_enabled, not onboarding_completed: see the header.
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.entry_fee_cents > 0 THEN
        IF NOT EXISTS (
            SELECT 1 FROM player_stripe_account
             WHERE player_id = v_t.organizer_id AND charges_enabled
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYOUTS_SETUP_REQUIRED';
        END IF;
    END IF;

    UPDATE tournaments
       SET status     = 'registration_open',
           version    = version + 1,
           updated_at = now()
     WHERE id      = p_tournament_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_DRAFT';
    END IF;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', v_row.id, 'open_registration', v_caller_id,
        jsonb_build_object('status', v_row.status)
    );

    RETURN v_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.season_open(
    p_season_id   uuid,
    p_version_was integer
)
RETURNS seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_caller_id uuid := auth.uid();
    v_season    seasons;
    v_league    leagues;
    v_row       seasons;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_FOUND';
    END IF;

    SELECT * INTO v_league FROM leagues WHERE id = v_season.league_id;

    IF NOT (public.is_league_organizer(v_season.league_id) OR public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    IF v_league.status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAGUE_NOT_ACTIVE';
    END IF;

    IF v_season.end_date < current_date THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_ENDED';
    END IF;

    -- Never open a paid season the organizer can't actually be paid for.
    -- Mirrors tournament_open_registration's gate.
    IF v_season.entry_fee_cents > 0
       AND NOT EXISTS (
           SELECT 1 FROM player_stripe_account psa
            WHERE psa.player_id = v_league.organizer_id
              AND psa.charges_enabled = true
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYOUTS_SETUP_REQUIRED';
    END IF;

    UPDATE seasons
       SET status           = 'open',
           rules_locked_at  = now(),
           version          = version + 1,
           updated_at       = now()
     WHERE id      = p_season_id
       AND version = p_version_was
       AND status  = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id AND version <> p_version_was) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SEASON_NOT_DRAFT';
    END IF;

    -- Roster-aware: free seeds every active member (unchanged); paid seeds nobody
    -- here, because nobody has paid yet — the season_members trigger adds each
    -- payer's row as they enroll.
    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT v_row.id, r.user_id,
           hashtext(v_row.id::text || r.user_id::text)::bigint
      FROM public.season_ranking_roster(v_row.id) r
    ON CONFLICT (season_id, user_id) DO NOTHING;

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'season', v_row.id, 'open', v_caller_id,
        jsonb_build_object('league_id', v_row.league_id, 'status', v_row.status)
    );

    RETURN v_row;
END;
$function$;


-- ---------------------------------------------------- 2. correct legacy rows

UPDATE player_stripe_account
   SET onboarding_completed = charges_enabled,
       updated_at           = now()
 WHERE onboarding_completed IS DISTINCT FROM charges_enabled;


-- ------------------------------------------------------- 3. pin the invariant

CREATE OR REPLACE FUNCTION public.player_stripe_account_sync_onboarding_tg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- onboarding_completed is a legacy alias for charges_enabled. Keeping them
    -- equal means every existing reader of the old column stays truthful.
    NEW.onboarding_completed := COALESCE(NEW.charges_enabled, false);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_player_stripe_account_sync_onboarding ON public.player_stripe_account;
CREATE TRIGGER trg_player_stripe_account_sync_onboarding
    BEFORE INSERT OR UPDATE ON public.player_stripe_account
    FOR EACH ROW
    EXECUTE FUNCTION public.player_stripe_account_sync_onboarding_tg();

COMMENT ON COLUMN public.player_stripe_account.onboarding_completed IS
  'Legacy alias for charges_enabled, kept in step by trg_player_stripe_account_sync_onboarding. Prefer charges_enabled in new code.';
