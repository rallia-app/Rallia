-- ============================================================================
-- Prize draws enforce the rating CEILING, not the current rating
-- ============================================================================
-- Turns on the rule the ledger from 20260814190000 was built for. For a draw
-- with prize money, the upper bound is checked against the highest level the
-- player has represented in the last 180 days rather than whatever their
-- profile says today. Moving up is still instant; moving down only counts for
-- prize draws after the window.
--
-- Decisions (Mathis, 2026-08-14):
--   * 180 days — one ranking season. 90 is the industry default but sits
--     inside the planning horizon of anyone doing this deliberately.
--   * Prize draws only (prize_money_cents > 0). Ordinary paid draws stay as
--     easy to fill as they are today.
--   * Exceptions (injury, aging, a real DUPR drop) go through an admin action.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT lt_assert_rating_band
-- ---------------------------------------------------------------------------
-- The obvious home is the band helper, but it only receives
-- (user, sport, min, max) and cannot know whether a prize is attached. Passing
-- that in means editing every call site, and there are now ~10 across nine
-- migrations (tournament register/paid/accept_invite, the invite-accept branch,
-- league join, waitlist, capacity, player invite links, participation terms).
-- Each edit is a full CREATE OR REPLACE of a large body, and one of those
-- bodies changed earlier today — exactly the setup where a stale copy silently
-- reverts a newer fix.
--
-- A BEFORE INSERT trigger on tournament_registrations sees tournament_id and
-- user_id, so it resolves the prize and the band itself. Every entry path is
-- covered at the point that matters (the row appearing), including any path
-- added later, and no existing body is touched. Guard triggers are already the
-- house pattern here (protect_rating_proof_auto_flag, lt_protect_payment_history,
-- validate_player_sport_active_rating).
--
-- ---------------------------------------------------------------------------
-- SCOPE, deliberately narrow
-- ---------------------------------------------------------------------------
--   * max_rating ONLY. Applying the ceiling to min_rating would let a genuine
--     4.0 -> 2.0 drop still enter a 3.5+ draw, i.e. it would make the gate
--     LOOSER. As written the ceiling can only ever make it stricter.
--   * Draws with no max_rating are untouched. On the Série 2 grid that is the
--     Avancé draw (4.0 and up), which is right: there is nothing to sandbag
--     into at the top of the ladder.
--   * Skipped when auth.uid() IS NULL (migrations, seeds, service tasks) and
--     for admins, matching the existing "admins bypass as a support override"
--     semantics of lt_assert_rating_band.
--
-- New error codes RATING_RECENTLY_HIGHER / PARTNER_RATING_RECENTLY_HIGHER,
-- deliberately distinct from RATING_TOO_HIGH: a player refused here is showing
-- an in-band rating on their own profile, so "your rating is too high" would
-- read as a bug. The copy has to explain the window.
-- ============================================================================

-- ------------------------------------------------------- 1. policy constant
-- One home for the window so the gate, the admin action and any future UI copy
-- cannot drift apart.
CREATE OR REPLACE FUNCTION public.lt_prize_rating_ceiling_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 180 $$;

COMMENT ON FUNCTION public.lt_prize_rating_ceiling_days() IS
  'Lookback window, in days, for the prize-draw rating ceiling.';

GRANT EXECUTE ON FUNCTION public.lt_prize_rating_ceiling_days() TO authenticated, anon, service_role;

-- --------------------------------------------------- 2. admin exception path
-- A legitimate drop is cleared, never deleted: the rows stay for audit and are
-- excluded from the ceiling by admin_cleared_at.
ALTER TABLE public.player_rating_history
    ADD COLUMN IF NOT EXISTS admin_cleared_at   timestamptz,
    ADD COLUMN IF NOT EXISTS admin_cleared_by   uuid REFERENCES public.player(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS admin_clear_reason text;

COMMENT ON COLUMN public.player_rating_history.admin_cleared_at IS
  'Set when an admin accepted a genuine level drop. Cleared rows stay for audit '
  'but no longer count toward player_rating_ceiling.';

-- Same signature, so existing grants stand. Only the cleared-row filter is new.
CREATE OR REPLACE FUNCTION public.player_rating_ceiling(
    p_player_id uuid,
    p_sport_id  uuid,
    p_days      integer
)
RETURNS double precision
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT MAX(h.rating_value)
      FROM player_rating_history h
     WHERE h.player_id = p_player_id
       AND h.sport_id  = p_sport_id
       AND h.admin_cleared_at IS NULL
       AND h.recorded_at >= now() - make_interval(days => p_days);
$$;

-- Accepts the player's CURRENT level as legitimate by clearing every entry in
-- the window above it. The latest entry (which equals the current level) is
-- left alone, so the ceiling collapses to the current rating immediately.
CREATE OR REPLACE FUNCTION public.admin_clear_rating_ceiling(
    p_player_id uuid,
    p_sport_id  uuid,
    p_reason    text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := (SELECT auth.uid());
    v_current double precision;
    v_count   integer;
BEGIN
    IF NOT (SELECT public.is_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ADMIN';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REASON_REQUIRED';
    END IF;

    SELECT rs.value
      INTO v_current
      FROM player_sport ps
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs         ON rs.id  = prs.rating_score_id
     WHERE ps.player_id = p_player_id
       AND ps.sport_id  = p_sport_id;

    IF v_current IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NO_ACTIVE_RATING';
    END IF;

    UPDATE player_rating_history h
       SET admin_cleared_at   = now(),
           admin_cleared_by   = v_caller,
           admin_clear_reason = p_reason
     WHERE h.player_id = p_player_id
       AND h.sport_id  = p_sport_id
       AND h.admin_cleared_at IS NULL
       AND h.rating_value > v_current
       AND h.recorded_at >= now() - make_interval(days => public.lt_prize_rating_ceiling_days());

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.admin_clear_rating_ceiling(uuid, uuid, text) IS
  'Admin override for a genuine level drop (injury, aging, a real external '
  'rating change). Clears in-window history above the current rating so prize '
  'draws stop holding the player to their old level. Returns rows cleared.';

REVOKE EXECUTE ON FUNCTION public.admin_clear_rating_ceiling(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_rating_ceiling(uuid, uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------ 3. assertion
CREATE OR REPLACE FUNCTION public.lt_assert_rating_ceiling(
    p_user_id  uuid,
    p_sport_id uuid,
    p_max      numeric,
    p_partner  boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_prefix  text := CASE WHEN p_partner THEN 'PARTNER_' ELSE '' END;
    v_ceiling double precision;
BEGIN
    IF p_max IS NULL THEN
        RETURN;
    END IF;

    v_ceiling := public.player_rating_ceiling(
        p_user_id, p_sport_id, public.lt_prize_rating_ceiling_days()
    );

    IF v_ceiling IS NOT NULL AND v_ceiling > p_max THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_prefix || 'RATING_RECENTLY_HIGHER';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lt_assert_rating_ceiling(uuid, uuid, numeric, boolean) FROM PUBLIC;

-- -------------------------------------------------------------- 4. trigger
CREATE OR REPLACE FUNCTION public.lt_enforce_prize_rating_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sport_id uuid;
    v_max      numeric;
    v_prize    integer;
BEGIN
    -- No user session means a migration, seed or service task, not a player
    -- entering a draw. Admins keep the support override the band gate gives.
    IF (SELECT auth.uid()) IS NULL OR (SELECT public.is_admin()) THEN
        RETURN NEW;
    END IF;

    SELECT t.sport_id, t.max_rating, t.prize_money_cents
      INTO v_sport_id, v_max, v_prize
      FROM tournaments t
     WHERE t.id = NEW.tournament_id;

    IF COALESCE(v_prize, 0) <= 0 OR v_max IS NULL THEN
        RETURN NEW;
    END IF;

    -- On a partner swap only the partner is new; re-checking the holder would
    -- refuse a swap for a reason unrelated to it.
    IF TG_OP = 'INSERT' THEN
        PERFORM lt_assert_rating_ceiling(NEW.user_id, v_sport_id, v_max, false);
    END IF;

    IF NEW.partner_user_id IS NOT NULL THEN
        PERFORM lt_assert_rating_ceiling(NEW.partner_user_id, v_sport_id, v_max, true);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_registrations_prize_rating_ceiling ON public.tournament_registrations;
CREATE TRIGGER tournament_registrations_prize_rating_ceiling
    BEFORE INSERT OR UPDATE OF partner_user_id ON public.tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION public.lt_enforce_prize_rating_ceiling();

COMMENT ON FUNCTION public.lt_enforce_prize_rating_ceiling() IS
  'Holds prize-draw entrants to their 180-day rating ceiling. Complements '
  'lt_assert_rating_band, which still enforces the band on the current rating.';
