-- ============================================================================
-- Review prompt eligibility — the server half of the App Store ratings work
-- ============================================================================
-- Rallia has never asked anyone for a rating: expo-store-review was never
-- installed and no SKStoreReviewRequest call exists in the app. The only people
-- who have ever rated us are the ones motivated enough to walk to the App Store
-- unprompted, and that population skews negative. The public score is measuring
-- the noise floor, not the product. See specs/14-growth/app-store-ratings.md.
--
-- The fix is to ask a representative slice of active players. The constraint is
-- that both stores prohibit "filtered" feedback (Apple Code of Conduct 5.6.1,
-- Google Play In-App Review policy), which means we may segment on BEHAVIOUR but
-- never on SENTIMENT. No "Enjoying Rallia? Yes/No" gate, ever.
--
-- Every rule below is therefore either a behavioural threshold (has this player
-- actually used the thing) or an anti-interruption rule (is this a bad moment).
-- None of them ask, infer, or branch on how the player feels. They live in SQL
-- rather than in the client for three reasons: the criteria stay auditable in
-- one place, they can be tuned without shipping a build, and the throttle
-- survives reinstall and device switches (AsyncStorage would not).
--
-- The prompt log is the eligibility source AND the analytics record. Apple and
-- Google never report whether the user actually rated or what they gave, so
-- conversion can only ever be inferred by lining these rows up against the
-- weekly ratings delta in App Store Connect. That is the best available signal.
-- ============================================================================

-- -------------------------------------------------------------------- 1. log
-- One row per prompt actually displayed. A log rather than a counter so the
-- 365-day cap is a true rolling window instead of a fixed one that resets on an
-- arbitrary date, and so a prompt can be attributed to the trigger that fired.
CREATE TABLE IF NOT EXISTS public.player_review_prompt (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id    uuid NOT NULL REFERENCES public.player(id) ON DELETE CASCADE,
    trigger_name text NOT NULL,
    shown_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_review_prompt IS
  'One row per store review prompt displayed to a player. Written only by '
  'record_review_prompt_shown. Doubles as the throttle ledger and the analytics '
  'record: neither store reports rating outcomes, so this is all we ever see.';

COMMENT ON COLUMN public.player_review_prompt.trigger_name IS
  'Which delight moment fired the prompt (e.g. match_result_confirmed). Used to '
  'compare trigger quality once ratings volume makes the comparison meaningful.';

CREATE INDEX IF NOT EXISTS idx_player_review_prompt_lookup
    ON public.player_review_prompt (player_id, shown_at DESC);

ALTER TABLE public.player_review_prompt ENABLE ROW LEVEL SECURITY;

-- Readable by the player it describes and by admins. No write policy at all:
-- the writer below is SECURITY DEFINER and owns the table. Forging rows would
-- only throttle the forger, so this is tidiness rather than defence, but it
-- keeps the log trustworthy as an analytics source.
DROP POLICY IF EXISTS player_review_prompt_select ON public.player_review_prompt;
CREATE POLICY player_review_prompt_select ON public.player_review_prompt
    FOR SELECT TO authenticated
    USING (
        player_id = (SELECT auth.uid())
        OR (SELECT public.is_admin())
    );

GRANT SELECT ON public.player_review_prompt TO authenticated;
GRANT ALL    ON public.player_review_prompt TO service_role;

-- ------------------------------------------------------------- 2. thresholds
-- Named here rather than inlined so the numbers are reviewable in one place.
--
--   MAX_PROMPTS_PER_YEAR = 2  Apple's own cap is 3. We spend two and hold one
--                             in reserve for a future high-value moment.
--   MIN_DAYS_BETWEEN      = 90 A player who ignored the prompt once should not
--                             see it again the same quarter.
--   MIN_GAMES_PLAYED      = 3  Not 1. A first game is too early to have an
--                             opinion worth publishing, and prompting on it
--                             would sample people who have barely used Rallia.
--   COOLDOWN_DAYS         = 14 Anti-interruption window after a bad experience.

-- ------------------------------------------------------------- 3. eligibility
-- Returns { eligible, reason, games_played, prompts_in_window }.
--
-- Scoped to auth.uid() with no player parameter on purpose: there is no reason
-- for a client to ask about anyone else, and not accepting the argument removes
-- the question of whether it was validated.
--
-- Checks are ordered cheapest-and-most-common first, and the first failure wins
-- so `reason` names one actionable cause rather than a set.
CREATE OR REPLACE FUNCTION public.review_prompt_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player      uuid := auth.uid();
    v_prompts     integer;
    v_last_shown  timestamptz;
    v_games       integer;
    v_open_ticket boolean;
    v_bad_recent  boolean;
BEGIN
    IF v_player IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason', 'not_authenticated');
    END IF;

    SELECT count(*), max(shown_at)
      INTO v_prompts, v_last_shown
      FROM player_review_prompt
     WHERE player_id = v_player
       AND shown_at >= now() - interval '365 days';

    IF v_prompts >= 2 THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'throttled_year',
            'prompts_in_window', v_prompts
        );
    END IF;

    IF v_last_shown IS NOT NULL AND v_last_shown >= now() - interval '90 days' THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'throttled_recent',
            'prompts_in_window', v_prompts
        );
    END IF;

    -- Behavioural threshold. match_outcome = 'played' is the same measure the
    -- post-match flows already write, so this counts games that genuinely
    -- happened rather than games that were merely scheduled.
    SELECT count(*)
      INTO v_games
      FROM match_participant mp
     WHERE mp.player_id = v_player
       AND mp.match_outcome = 'played';

    IF v_games < 3 THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'not_enough_games',
            'games_played', v_games
        );
    END IF;

    -- Anti-interruption: an unresolved support conversation is an open loop, and
    -- interrupting it with a rating request is both bad manners and bad timing.
    -- Deliberately a DELAY and not an exclusion. The player becomes eligible
    -- again the moment the ticket closes, whatever the outcome was, so nobody is
    -- filtered out of the population on the basis of having complained.
    SELECT EXISTS (
        SELECT 1 FROM feedback f
         WHERE f.player_id = v_player
           AND f.status IN ('new', 'reviewed', 'in_progress')
    ) INTO v_open_ticket;

    IF v_open_ticket THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'open_feedback',
            'games_played', v_games
        );
    END IF;

    -- Recent bad experience: a game that fell through, an opponent who did not
    -- show, or a score the player is currently arguing about. Same reasoning as
    -- above, and same expiry: the cooldown lapses on its own.
    SELECT EXISTS (
        SELECT 1
          FROM match_participant mp
          JOIN match m ON m.id = mp.match_id
         WHERE mp.player_id = v_player
           AND m.match_date >= (current_date - 14)
           AND (
                mp.match_outcome IN ('mutual_cancel', 'opponent_no_show')
             OR mp.showed_up IS FALSE
             OR m.cancelled_at IS NOT NULL
           )
        UNION ALL
        SELECT 1
          FROM match_result mr
          JOIN match_participant mp ON mp.match_id = mr.match_id
         WHERE mp.player_id = v_player
           AND mr.disputed IS TRUE
           AND mr.updated_at >= now() - interval '14 days'
    ) INTO v_bad_recent;

    IF v_bad_recent THEN
        RETURN jsonb_build_object(
            'eligible', false, 'reason', 'recent_bad_experience',
            'games_played', v_games
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', true,
        'reason', 'ok',
        'games_played', v_games,
        'prompts_in_window', v_prompts
    );
END;
$$;

COMMENT ON FUNCTION public.review_prompt_eligibility() IS
  'Whether the CURRENT player may be shown a store review prompt right now. '
  'Behavioural and anti-interruption rules only: never reads or infers '
  'satisfaction, which is what keeps this compliant with Apple 5.6.1 and the '
  'Google Play In-App Review policy. Every negative reason is time-bound, so no '
  'player is permanently excluded.';

REVOKE EXECUTE ON FUNCTION public.review_prompt_eligibility() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.review_prompt_eligibility() TO authenticated, service_role;

-- ------------------------------------------------------------------ 4. writer
-- Called after the native prompt has actually been requested. Note the store
-- APIs do not tell us whether the system dialog was really displayed (both
-- throttle silently, and users can disable prompts OS-wide), so a row here means
-- "we asked", not "they saw". That gap is why the client-side spend is capped
-- below Apple's own limit.
CREATE OR REPLACE FUNCTION public.record_review_prompt_shown(p_trigger text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player uuid := auth.uid();
BEGIN
    IF v_player IS NULL THEN
        RAISE EXCEPTION 'record_review_prompt_shown requires an authenticated caller';
    END IF;

    INSERT INTO player_review_prompt (player_id, trigger_name)
    VALUES (v_player, coalesce(nullif(trim(p_trigger), ''), 'unknown'));
END;
$$;

COMMENT ON FUNCTION public.record_review_prompt_shown(text) IS
  'Records that a review prompt was requested for the current player. Means '
  '"we asked", not "they saw": neither store reports whether the dialog was '
  'actually displayed.';

REVOKE EXECUTE ON FUNCTION public.record_review_prompt_shown(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_review_prompt_shown(text) TO authenticated, service_role;
