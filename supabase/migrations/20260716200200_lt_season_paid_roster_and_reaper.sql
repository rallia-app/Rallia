-- Paid seasons: keep the ranking roster honest, gate payouts, and stop leaking slots.
--
-- Three things a paid season breaks that a free one never exercised.
--
-- 1) THE ROSTER. season_rankings was seeded from league_members (active) in two
--    places — season_open and recalc_season_ranking's "ensure every active member
--    has a row" block. On a paid season that hands a ranking row to members who
--    never paid, and recalc would re-add them after any cleanup. Both sites now
--    resolve the roster through one helper: a paid season ranks the people who
--    actually enrolled; a free season keeps ranking active league members exactly
--    as before, so existing free leagues are unaffected.
--
-- 2) THE PAYOUT GATE. tournament_open_registration refuses to open a paid event
--    when the organizer has no completed Stripe onboarding, otherwise players pay
--    into a void. season_open had no such gate.
--
-- 3) THE REAPER. lt_expire_stale_registration_payments only ever reverted
--    tournament_registrations, so an abandoned season checkout would hold its
--    payment_pending slot until the heat death of the universe.

-- ---------------------------------------------------------------------------
-- (1) One roster definition, used by every seeding site.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.season_ranking_roster(p_season_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Paid: you are ranked because you paid.
    SELECT sm.user_id
      FROM season_members sm
      JOIN seasons s ON s.id = sm.season_id
     WHERE sm.season_id = p_season_id
       AND s.entry_fee_cents > 0
       AND sm.status = 'enrolled'
    UNION
    -- Free: you are ranked because you are an active league member (legacy).
    SELECT lm.user_id
      FROM league_members lm
      JOIN seasons s ON s.id = p_season_id
     WHERE lm.league_id = s.league_id
       AND s.entry_fee_cents = 0
       AND lm.status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.season_ranking_roster(uuid) TO authenticated;

-- A paid season's roster grows as people pay, and the webhook flips the member to
-- 'enrolled' without going through season_open/recalc. Seed the ranking row at
-- that moment so a payer is ranked immediately. Harmless for free seasons (the
-- row already exists -> ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.tg_season_member_seed_ranking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'enrolled' THEN
        INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
        VALUES (NEW.season_id, NEW.user_id,
                hashtext(NEW.season_id::text || NEW.user_id::text)::bigint)
        ON CONFLICT (season_id, user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_member_seed_ranking ON season_members;
CREATE TRIGGER season_member_seed_ranking
    AFTER INSERT OR UPDATE OF status ON season_members
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_season_member_seed_ranking();


-- Re-emitted from the live definition with only the seed block (1) repointed at
-- the roster helper. Everything from the rules lookup down is byte-for-byte the
-- previous body.
CREATE OR REPLACE FUNCTION public.recalc_season_ranking(p_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_season     seasons;
    v_pt_win     integer;
    v_pt_loss    integer;
    v_pt_rw      integer;
    v_pt_rl      integer;
    v_pt_ww      integer;
    v_pt_wl      integer;
    v_eligible   integer;
BEGIN
    -- Serialize concurrent recalcs for this season.
    PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

    SELECT * INTO v_season FROM seasons WHERE id = p_season_id;
    IF v_season.id IS NULL THEN RETURN; END IF;

    -- (1) Ensure everyone on the season's roster has a ranking row, so members
    -- who joined after season_open (free) or paid after it (paid) are included.
    -- New rows land at 0 and are filled by the aggregation below if they have
    -- any results.
    INSERT INTO season_rankings (season_id, user_id, tiebreak_seed)
    SELECT p_season_id, r.user_id,
           hashtext(p_season_id::text || r.user_id::text)::bigint
      FROM public.season_ranking_roster(p_season_id) r
    ON CONFLICT (season_id, user_id) DO NOTHING;

    v_pt_win  := COALESCE((v_season.rules->>'pointWin')::int, 10);
    v_pt_loss := COALESCE((v_season.rules->>'pointLoss')::int, 1);
    v_pt_rw   := COALESCE((v_season.rules->>'pointRetirementWinner')::int, v_pt_win);
    v_pt_rl   := COALESCE((v_season.rules->>'pointRetirementLoser')::int, v_pt_loss);
    v_pt_ww   := COALESCE((v_season.rules->>'pointWalkoverWinner')::int, v_pt_win);
    v_pt_wl   := COALESCE((v_season.rules->>'pointWalkoverLoser')::int, 0);

    -- Sessions that ran (used as the participation denominator).
    SELECT count(*) INTO v_eligible
      FROM sessions WHERE season_id = p_season_id AND status = 'completed';

    -- Reset all members' counters (rows seeded at season_open / above).
    UPDATE season_rankings
       SET points = 0, wins = 0, losses = 0, draws = 0, no_shows = 0,
           sets_won = 0, sets_lost = 0, games_won = 0, games_lost = 0,
           matches_played = 0, sessions_attended = 0,
           sessions_eligible = v_eligible,
           last_recalculated_at = now(), updated_at = now()
     WHERE season_id = p_season_id;

    -- Per-player contributions from every terminal, non-drill match.
    -- (2) Matches in a cancelled session are excluded.
    WITH parsed AS (
        SELECT sm.session_id, sm.status, sm.winner_team,
               sm.team_a_user_ids, sm.team_b_user_ids,
               ps.a_sets, ps.b_sets, ps.a_games, ps.b_games
          FROM session_matches sm
          JOIN sessions ss ON ss.id = sm.session_id
          CROSS JOIN LATERAL public.lt_parse_score(sm.score) ps
         WHERE ss.season_id = p_season_id
           AND ss.status <> 'cancelled'
           AND sm.is_drill = false
           AND sm.status IN ('completed', 'retired', 'walkover')
    ),
    contrib AS (
        -- team A
        SELECT unnest(team_a_user_ids) AS user_id, session_id,
               CASE status
                   WHEN 'completed' THEN CASE WHEN winner_team = 'a' THEN v_pt_win ELSE v_pt_loss END
                   WHEN 'retired'   THEN CASE WHEN winner_team = 'a' THEN v_pt_rw  ELSE v_pt_rl  END
                   WHEN 'walkover'  THEN CASE WHEN winner_team = 'a' THEN v_pt_ww  ELSE v_pt_wl  END
                   ELSE 0 END AS pts,
               (status IN ('completed','retired') AND winner_team = 'a')::int AS win,
               (status IN ('completed','retired') AND winner_team = 'b')::int AS loss,
               1 AS played,
               a_sets AS sw, b_sets AS sl, a_games AS gw, b_games AS gl
          FROM parsed
        UNION ALL
        -- team B
        SELECT unnest(team_b_user_ids) AS user_id, session_id,
               CASE status
                   WHEN 'completed' THEN CASE WHEN winner_team = 'b' THEN v_pt_win ELSE v_pt_loss END
                   WHEN 'retired'   THEN CASE WHEN winner_team = 'b' THEN v_pt_rw  ELSE v_pt_rl  END
                   WHEN 'walkover'  THEN CASE WHEN winner_team = 'b' THEN v_pt_ww  ELSE v_pt_wl  END
                   ELSE 0 END AS pts,
               (status IN ('completed','retired') AND winner_team = 'b')::int AS win,
               (status IN ('completed','retired') AND winner_team = 'a')::int AS loss,
               1 AS played,
               b_sets AS sw, a_sets AS sl, b_games AS gw, a_games AS gl
          FROM parsed
    ),
    agg AS (
        SELECT user_id,
               sum(pts) AS points, sum(win) AS wins, sum(loss) AS losses,
               sum(played) AS matches_played,
               sum(sw) AS sets_won, sum(sl) AS sets_lost,
               sum(gw) AS games_won, sum(gl) AS games_lost,
               count(DISTINCT session_id) AS sessions_attended
          FROM contrib
         GROUP BY user_id
    )
    UPDATE season_rankings sr
       SET points = a.points, wins = a.wins, losses = a.losses,
           matches_played = a.matches_played,
           sets_won = a.sets_won, sets_lost = a.sets_lost,
           games_won = a.games_won, games_lost = a.games_lost,
           sessions_attended = a.sessions_attended,
           updated_at = now()
      FROM agg a
     WHERE sr.season_id = p_season_id AND sr.user_id = a.user_id;

    -- Assign rank (points -> set diff -> game diff -> participation -> seed).
    WITH ranked AS (
        SELECT id, row_number() OVER (
            ORDER BY points DESC,
                     (sets_won - sets_lost) DESC,
                     (games_won - games_lost) DESC,
                     CASE WHEN sessions_eligible > 0
                          THEN sessions_attended::numeric / sessions_eligible ELSE 0 END DESC,
                     tiebreak_seed ASC
        ) AS rk
          FROM season_rankings WHERE season_id = p_season_id
    )
    UPDATE season_rankings sr SET rank = ranked.rk
      FROM ranked WHERE sr.id = ranked.id;
END;
$function$;


-- ---------------------------------------------------------------------------
-- (2) season_open: payout gate + roster-aware seed.
--
-- Re-emitted from 20260716190000's version (itself the live body plus the
-- LEAGUE_NOT_ACTIVE guard), with the payout gate and the seed swap added.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.season_open(p_season_id uuid, p_version_was integer)
 RETURNS seasons
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

    -- Added: never open a paid season the organizer can't be paid out for.
    -- Mirrors tournament_open_registration's gate.
    IF v_season.entry_fee_cents > 0
       AND NOT EXISTS (
           SELECT 1 FROM player_stripe_account psa
            WHERE psa.player_id = v_league.organizer_id
              AND psa.onboarding_completed = true
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


-- ---------------------------------------------------------------------------
-- (3) Reaper: revert abandoned season checkouts too.
--
-- Re-emitted from 20260629110100's version with a season branch. The cron
-- schedule it feeds is untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lt_expire_stale_registration_payments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer := 0;
    v_pay   record;
BEGIN
    FOR v_pay IN
        SELECT id, tournament_registration_id, season_user_id
          FROM lt_registration_payment
         WHERE status = 'pending'
           AND expires_at IS NOT NULL
           AND expires_at < now()
    LOOP
        UPDATE lt_registration_payment
           SET status = 'cancelled', updated_at = now()
         WHERE id = v_pay.id AND status = 'pending';

        UPDATE tournament_registrations
           SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_pay.tournament_registration_id
           AND status = 'payment_pending';

        -- Added: free the season slot an abandoned checkout was holding. The
        -- ledger's target CHECK makes these two mutually exclusive, so the
        -- tournament UPDATE above no-ops on a season row (NULL id matches nothing).
        UPDATE season_members
           SET status = 'withdrawn', withdrawn_at = now(), version = version + 1, updated_at = now()
         WHERE id = v_pay.season_user_id
           AND status = 'payment_pending';

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;
