-- ============================================================================
-- Pool + knockout notifications (spec formats/poules-puis-eliminatoires.md §12)
--
-- Three holes, all player-facing, all in the format's critical loop. In
-- distributed mode players arrange each game themselves between the organizer's
-- deadlines, so a player who is not told they have a game simply does not play,
-- and the phase stalls.
--
--   1. The cut-over to the knockout tree was completely SILENT.
--      tournament_generate_knockout only bumps tournaments.version, and the
--      lifecycle trigger keys on registration_closed -> in_progress, so nobody
--      learned the bracket had gone live. Fixed by calling the new
--      lt_notify_knockout_published from the cut-over itself.
--
--   2. The pools-published notice used single-elimination copy. The trigger
--      DOES fire when tournament_generate_pools flips the status, but its
--      round-1 join has no bracket_side filter, so it read pool games and
--      announced "round 1 vs X" under the title "Tableau dévoilé". Worse, a
--      3-player pool pads to 4 with a phantom, so one member has no round-1
--      game and was dropped from the notice entirely. Branch A now hands pool
--      tournaments to lt_notify_pools_published, which keys on pool
--      MEMBERSHIP and names every opponent.
--
--   3. Nobody was told they had been eliminated in the pools. With 2
--      qualifiers per pool that is half the field, and their tournament just
--      stopped with no word. New tournament_pool_eliminated notice carries
--      their pool placing.
--
-- Only one new notification type was needed: the pools notice and the
-- qualifiers' notice both reuse tournament_bracket_published, which is the
-- same moment for the player and keeps every existing client mapping, icon and
-- preference toggle working untouched.
--
-- notify_tournament_lifecycle is re-issued from 20260624100000 and
-- tournament_generate_knockout from 20260811160000, both extracted
-- programmatically with a single targeted edit so the untouched branches stay
-- byte-identical.
-- ============================================================================

-- ============================================
-- lt_notify_pools_published — "your pool and your opponents" (spec §12).
--
-- Reuses the tournament_bracket_published type: it is the same moment for the
-- player (the draw is out, here is who you face) and it keeps every existing
-- client mapping, icon and preference toggle working untouched. Only the copy
-- and the audience differ.
--
-- Audience is POOL MEMBERSHIP, deliberately, not the round-1 rows the
-- single-elimination branch keys on. A pool of 3 pads to 4 with a phantom, so
-- one member has no round-1 game and the old join dropped them silently.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_notify_pools_published(p_tournament_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $lt$
DECLARE
  v_t    tournaments;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
  IF v_t.id IS NULL THEN
    RETURN;
  END IF;

  WITH pool_of AS (
    SELECT DISTINCT tm.pool_number AS pool, r.reg
      FROM tournament_matches tm
      CROSS JOIN LATERAL (VALUES
          (tm.player1_registration_id), (tm.player2_registration_id)
      ) AS r(reg)
     WHERE tm.tournament_id = p_tournament_id
       AND tm.bracket_side  = 'pool'
       AND r.reg IS NOT NULL
  ),
  opponents AS (
    SELECT p.reg,
           p.pool,
           string_agg(public.lt_registration_display_name(o.reg), ', '
                      ORDER BY public.lt_registration_display_name(o.reg)) AS opps,
           count(*)::int AS opp_count
      FROM pool_of p
      JOIN pool_of o ON o.pool = p.pool AND o.reg <> p.reg
     GROUP BY p.reg, p.pool
  ),
  members AS (
    SELECT op.pool, op.opps, op.opp_count, m AS player_id
      FROM opponents op
      JOIN tournament_registrations r ON r.id = op.reg
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
     WHERE r.status = 'registered'
  )
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', mb.player_id,
    'type', 'tournament_bracket_published',
    'target_id', v_t.id,
    'title', CASE WHEN public.lt_user_is_fr(mb.player_id)
               THEN 'Poules dévoilées' ELSE 'Pools published' END,
    'body', CASE WHEN public.lt_user_is_fr(mb.player_id)
              THEN v_t.name || ' : poule ' || chr(64 + mb.pool)
                   || ', tu joues contre ' || mb.opps || '.'
              ELSE v_t.name || ': pool ' || chr(64 + mb.pool)
                   || ', you play ' || mb.opps || '.'
            END,
    'payload', jsonb_build_object(
      'tournamentId', v_t.id,
      'tournamentName', v_t.name,
      'poolNumber', mb.pool,
      'poolLetter', chr(64 + mb.pool),
      'opponentCount', mb.opp_count
    ),
    'priority', 'high'
  ))
  INTO v_rows
  FROM members mb;

  IF v_rows IS NOT NULL THEN
    PERFORM insert_notifications(v_rows);
  END IF;
END;
$lt$;

-- ============================================
-- lt_notify_knockout_published — the cut-over, both audiences (spec §12).
--
-- Qualifiers get their round-1 matchup (or bye) folded into the same notice
-- that tells them they advanced: two pushes for one event would be noise.
-- Everyone else gets their pool placing, which is the only word they ever
-- receive that their tournament is over.
--
-- Called from tournament_generate_knockout rather than a trigger: the cut-over
-- leaves tournaments.status at 'in_progress', so no status trigger fires.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_notify_knockout_published(p_tournament_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $lt$
DECLARE
  v_t    tournaments;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
  IF v_t.id IS NULL THEN
    RETURN;
  END IF;

  -- Through to the knockout.
  WITH r1 AS (
    SELECT tm.player1_registration_id AS reg,
           tm.player2_registration_id AS opp,
           coalesce(tm.player2_is_bye, false) AS opp_bye
      FROM tournament_matches tm
     WHERE tm.tournament_id = p_tournament_id
       AND tm.bracket_side = 'main' AND tm.round_number = 1
       AND tm.player1_registration_id IS NOT NULL
    UNION ALL
    SELECT tm.player2_registration_id,
           tm.player1_registration_id,
           coalesce(tm.player1_is_bye, false)
      FROM tournament_matches tm
     WHERE tm.tournament_id = p_tournament_id
       AND tm.bracket_side = 'main' AND tm.round_number = 1
       AND tm.player2_registration_id IS NOT NULL
  ),
  members AS (
    SELECT CASE WHEN r1.opp_bye THEN NULL ELSE r1.opp END AS opp,
           m AS player_id
      FROM r1
      JOIN tournament_registrations r ON r.id = r1.reg
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
     WHERE r.status = 'registered'
  )
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', mb.player_id,
    'type', 'tournament_bracket_published',
    'target_id', v_t.id,
    'title', CASE WHEN public.lt_user_is_fr(mb.player_id)
               THEN 'Tableau dévoilé' ELSE 'Bracket published' END,
    'body', CASE WHEN public.lt_user_is_fr(mb.player_id)
              THEN CASE WHEN mb.opp IS NULL
                     THEN v_t.name || ' : tu passes en éliminatoires et tu sautes le tour 1.'
                     ELSE v_t.name || ' : tu passes en éliminatoires. Tour 1 contre '
                          || coalesce(public.lt_registration_display_name(mb.opp), 'ton adversaire') || '.'
                   END
              ELSE CASE WHEN mb.opp IS NULL
                     THEN v_t.name || ': you are through to the knockout, with a bye in round 1.'
                     ELSE v_t.name || ': you are through to the knockout. Round 1 vs '
                          || coalesce(public.lt_registration_display_name(mb.opp), 'your opponent') || '.'
                   END
            END,
    'payload', jsonb_build_object(
      'tournamentId', v_t.id,
      'tournamentName', v_t.name,
      'round', 1,
      'opponentRegistrationId', mb.opp,
      'opponentName', public.lt_registration_display_name(mb.opp)
    ),
    'priority', 'high'
  ))
  INTO v_rows
  FROM members mb;

  IF v_rows IS NOT NULL THEN
    PERFORM insert_notifications(v_rows);
  END IF;

  -- Out at the pool stage. Withdrawn and disqualified entries are skipped:
  -- they already know, and the organizer told them.
  SELECT jsonb_agg(jsonb_build_object(
    'user_id', mb.player_id,
    'type', 'tournament_pool_eliminated',
    'target_id', v_t.id,
    'title', CASE WHEN public.lt_user_is_fr(mb.player_id)
               THEN 'Parcours terminé' ELSE 'Run complete' END,
    'body', CASE WHEN public.lt_user_is_fr(mb.player_id)
              THEN v_t.name || ' : ton parcours s''arrête en poules. Tu finis '
                   || mb.pool_rank || 'e de ta poule avec ' || mb.wins
                   || CASE WHEN mb.wins = 1 THEN ' victoire' ELSE ' victoires' END
                   || ' sur ' || mb.settled || ' parties. Merci d''avoir joué 🙌'
              ELSE v_t.name || ': your run ends in the pool stage. You finished #'
                   || mb.pool_rank || ' in your pool with ' || mb.wins
                   || CASE WHEN mb.wins = 1 THEN ' win' ELSE ' wins' END
                   || ' from ' || mb.settled || ' games. Thanks for playing 🙌'
            END,
    'payload', jsonb_build_object(
      'tournamentId', v_t.id,
      'tournamentName', v_t.name,
      'poolNumber', mb.pool_number,
      'poolRank', mb.pool_rank,
      'wins', mb.wins,
      'settled', mb.settled
    ),
    'priority', 'normal'
  ))
  INTO v_rows
  FROM (
    SELECT s.pool_number, s.pool_rank, s.wins, s.settled, m AS player_id
      FROM public.tournament_pool_standings(p_tournament_id) s
      JOIN tournament_registrations r ON r.id = s.registration_id
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
     WHERE r.status = 'registered'
       AND NOT EXISTS (
         SELECT 1 FROM tournament_matches tm
          WHERE tm.tournament_id = p_tournament_id
            AND tm.bracket_side  = 'main'
            AND s.registration_id IN (tm.player1_registration_id, tm.player2_registration_id)
       )
  ) mb;

  IF v_rows IS NOT NULL THEN
    PERFORM insert_notifications(v_rows);
  END IF;
END;
$lt$;

-- ============================================
-- notify_tournament_lifecycle — branch A delegates for pool tournaments.
-- Body from 20260624100000; only the added guard differs.
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_tournament_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rows jsonb;
  v_champion_name text;
BEGIN
  -- A) Bracket published: every member of every registered entry gets their
  --    round-1 matchup (or bye notice).
  IF OLD.status = 'registration_closed' AND NEW.status = 'in_progress' THEN
    -- A pool tournament publishes POOLS at this transition, not a knockout
    -- tree. Its round_number = 1 rows are pool games, so the single-elimination
    -- copy below would announce "round 1 vs X", and the join would silently
    -- skip whoever sits out round 1 in an odd pool. Hand off instead.
    IF NEW.bracket_type = 'pool_knockout' THEN
      PERFORM public.lt_notify_pools_published(NEW.id);
      RETURN NEW;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', r1.player_id,
      'type', 'tournament_bracket_published',
      'target_id', NEW.id,
      'title', CASE WHEN public.lt_user_is_fr(r1.player_id)
                 THEN 'Tableau dévoilé' ELSE 'Bracket published' END,
      'body', CASE WHEN public.lt_user_is_fr(r1.player_id)
                THEN CASE WHEN r1.opp_reg IS NULL
                       THEN NEW.name || ' : tu sautes le tour 1 et passes directement au suivant.'
                       ELSE NEW.name || ' : tour 1 contre '
                            || coalesce(public.lt_registration_display_name(r1.opp_reg), 'ton adversaire') || '.'
                     END
                ELSE CASE WHEN r1.opp_reg IS NULL
                       THEN NEW.name || ': you have a bye in round 1 and advance automatically.'
                       ELSE NEW.name || ': round 1 vs '
                            || coalesce(public.lt_registration_display_name(r1.opp_reg), 'your opponent') || '.'
                     END
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'round', 1,
        'opponentRegistrationId', r1.opp_reg,
        'opponentName', public.lt_registration_display_name(r1.opp_reg)
      ),
      'priority', 'high'
    ))
    INTO v_rows
    FROM (
      SELECT mem.player_id,
             CASE WHEN tm.player1_registration_id = mem.reg_id
                  THEN tm.player2_registration_id
                  ELSE tm.player1_registration_id
             END AS opp_reg
      FROM (
        SELECT r.id AS reg_id, m AS player_id
        FROM tournament_registrations r
        CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
        WHERE r.tournament_id = NEW.id AND r.status = 'registered'
      ) mem
      JOIN tournament_matches tm
        ON tm.tournament_id = NEW.id
       AND tm.round_number = 1
       AND mem.reg_id IN (tm.player1_registration_id, tm.player2_registration_id)
    ) r1;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- B) Cancelled: everyone with an invested entry, urgent.
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', mem.player_id,
      'type', 'tournament_cancelled',
      'target_id', NEW.id,
      'title', CASE WHEN public.lt_user_is_fr(mem.player_id)
                 THEN 'Tournoi annulé' ELSE 'Tournament cancelled' END,
      'body', CASE WHEN public.lt_user_is_fr(mem.player_id)
                THEN NEW.name || ' a été annulé'
                     || coalesce(' : ' || nullif(NEW.cancelled_reason, ''), '') || '.'
                ELSE NEW.name || ' has been cancelled'
                     || coalesce(': ' || nullif(NEW.cancelled_reason, ''), '') || '.'
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'reason', NEW.cancelled_reason
      ),
      'priority', 'urgent'
    ))
    INTO v_rows
    FROM (
      SELECT DISTINCT m AS player_id
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
      WHERE r.tournament_id = NEW.id
        AND r.status IN ('registered', 'pending', 'waitlisted')
    ) mem
    WHERE mem.player_id IS DISTINCT FROM v_actor;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- C) Completed: champion announcement to all registered entries.
  ELSIF OLD.status = 'in_progress' AND NEW.status = 'completed' THEN
    SELECT public.lt_registration_display_name(fm.winner_registration_id)
      INTO v_champion_name
      FROM tournament_matches fm
     WHERE fm.tournament_id = NEW.id
       AND fm.next_match_id IS NULL
       AND fm.bracket_side = 'main'
       AND fm.winner_registration_id IS NOT NULL
     LIMIT 1;

    SELECT jsonb_agg(jsonb_build_object(
      'user_id', mem.player_id,
      'type', 'tournament_completed',
      'target_id', NEW.id,
      'title', CASE WHEN public.lt_user_is_fr(mem.player_id)
                 THEN 'Tournoi terminé' ELSE 'Tournament complete' END,
      'body', CASE WHEN public.lt_user_is_fr(mem.player_id)
                THEN NEW.name || ' est terminé. Vainqueur : '
                     || coalesce(v_champion_name, 'à confirmer') || '. Merci d''avoir joué!'
                ELSE NEW.name || ' has wrapped up. Champion: '
                     || coalesce(v_champion_name, 'to be announced') || '. Thanks for playing!'
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'championName', v_champion_name
      ),
      'priority', 'normal'
    ))
    INTO v_rows
    FROM (
      SELECT DISTINCT m AS player_id
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
      WHERE r.tournament_id = NEW.id AND r.status = 'registered'
    ) mem;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;

  -- D) Impactful edits while the tournament is live: dates / venue.
  ELSIF NEW.status = OLD.status
        AND NEW.status IN ('registration_open', 'registration_closed', 'in_progress')
        AND (OLD.start_date IS DISTINCT FROM NEW.start_date
             OR OLD.end_date IS DISTINCT FROM NEW.end_date
             OR OLD.venue_name IS DISTINCT FROM NEW.venue_name
             OR OLD.venue_address IS DISTINCT FROM NEW.venue_address
             OR OLD.facility_id IS DISTINCT FROM NEW.facility_id) THEN
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', mem.player_id,
      'type', 'tournament_updated',
      'target_id', NEW.id,
      'title', CASE WHEN public.lt_user_is_fr(mem.player_id)
                 THEN 'Tournoi modifié' ELSE 'Tournament updated' END,
      'body', CASE WHEN public.lt_user_is_fr(mem.player_id)
                THEN NEW.name || ' : les dates ou le lieu ont changé. Touche pour voir les détails à jour.'
                ELSE NEW.name || ': the dates or venue changed. Check the latest details.'
              END,
      'payload', jsonb_build_object(
        'tournamentId', NEW.id,
        'tournamentName', NEW.name,
        'changedFields', (
          SELECT jsonb_agg(f) FROM unnest(ARRAY[
            CASE WHEN OLD.start_date IS DISTINCT FROM NEW.start_date THEN 'start_date' END,
            CASE WHEN OLD.end_date IS DISTINCT FROM NEW.end_date THEN 'end_date' END,
            CASE WHEN OLD.venue_name IS DISTINCT FROM NEW.venue_name THEN 'venue_name' END,
            CASE WHEN OLD.venue_address IS DISTINCT FROM NEW.venue_address THEN 'venue_address' END,
            CASE WHEN OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN 'facility_id' END
          ]) f WHERE f IS NOT NULL
        )
      ),
      'priority', 'normal'
    ))
    INTO v_rows
    FROM (
      SELECT DISTINCT m AS player_id
      FROM tournament_registrations r
      CROSS JOIN LATERAL unnest(array_remove(ARRAY[r.user_id, r.partner_user_id], NULL)) m
      WHERE r.tournament_id = NEW.id AND r.status = 'registered'
    ) mem
    WHERE mem.player_id IS DISTINCT FROM v_actor;

    IF v_rows IS NOT NULL THEN
      PERFORM insert_notifications(v_rows);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
-- ============================================
-- tournament_generate_knockout — announce the tree. Body from
-- 20260811160000; only the added PERFORM differs.
-- ============================================

CREATE OR REPLACE FUNCTION public.tournament_generate_knockout(
    p_tournament_id uuid,
    p_version_was   integer
)
RETURNS SETOF tournament_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_tournament  tournaments;
    v_q           integer;
    v_k           integer;
    v_size        integer;
    v_positions   integer[];
    v_half        integer[];
    v_w_half      integer[] := '{}';
    v_winners     uuid[];
    v_winner_pool integer[];
    v_runners     uuid[];
    v_runner_pool integer[];
    v_need1       uuid[];
    v_need2       uuid[];
    v_free        uuid[];
    v_c1          integer := 1;
    v_c2          integer := 1;
    v_cf          integer := 1;
    v_ordered     uuid[];
    v_row         record;
    v_new_id      uuid;
    v_relaxed     boolean := false;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_AUTHENTICATED';
    END IF;
    IF NOT public.is_tournament_organizer(p_tournament_id) AND NOT public.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_ORGANIZER';
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF v_tournament.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_FOUND';
    END IF;
    IF v_tournament.version <> p_version_was THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OPTIMISTIC_LOCK_CONFLICT';
    END IF;
    IF v_tournament.bracket_type <> 'pool_knockout' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_POOL_TOURNAMENT';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'main'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'KNOCKOUT_ALREADY_GENERATED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'pool'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOL_STAGE_REQUIRED';
    END IF;
    IF v_tournament.status <> 'in_progress' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOURNAMENT_NOT_READY';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tournament_matches
         WHERE tournament_id = p_tournament_id AND bracket_side = 'pool'
           AND status NOT IN ('completed', 'retired', 'walkover', 'cancelled')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'POOLS_NOT_COMPLETE';
    END IF;

    DROP TABLE IF EXISTS _ko_standings;
    CREATE TEMP TABLE _ko_standings ON COMMIT DROP AS
        SELECT s.pool_number, s.pool_rank, s.registration_id,
               s.wins, s.settled, s.sets_won, s.sets_lost, s.games_won, s.games_lost,
               CASE WHEN s.settled = 0 THEN -1
                    ELSE s.wins::numeric / s.settled END AS win_ratio,
               CASE WHEN s.sets_won + s.sets_lost = 0 THEN -1
                    ELSE s.sets_won::numeric / (s.sets_won + s.sets_lost) END AS set_ratio,
               CASE WHEN s.games_won + s.games_lost = 0 THEN -1
                    ELSE s.games_won::numeric / (s.games_won + s.games_lost) END AS game_ratio
          FROM public.tournament_pool_standings(p_tournament_id) s
         WHERE s.eligible
           AND s.pool_rank <= v_tournament.qualifiers_per_pool;

    SELECT count(*) INTO v_q FROM _ko_standings;
    IF v_q < 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_PARTICIPANTS';
    END IF;

    v_size := 2;
    WHILE v_size < v_q LOOP
        v_size := v_size * 2;
    END LOOP;

    -- Slot i of the round-1 grid holds seed positions[i]; a seed's half is
    -- the half its slot falls in.
    v_positions := public.lt_seed_positions(v_size);
    FOR i IN 1..v_size LOOP
        v_half[v_positions[i]] := CASE WHEN i <= v_size / 2 THEN 1 ELSE 2 END;
    END LOOP;

    -- Winners seeded 1..k by inter-pool comparison.
    SELECT array_agg(registration_id ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC),
           array_agg(pool_number     ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC)
      INTO v_winners, v_winner_pool
      FROM _ko_standings WHERE pool_rank = 1;
    v_k := coalesce(array_length(v_winners, 1), 0);
    FOR i IN 1..v_k LOOP
        v_w_half[v_winner_pool[i]] := v_half[i];
    END LOOP;

    SELECT array_agg(registration_id ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC),
           array_agg(pool_number     ORDER BY win_ratio DESC, set_ratio DESC, game_ratio DESC, pool_number ASC)
      INTO v_runners, v_runner_pool
      FROM _ko_standings WHERE pool_rank > 1;

    -- Runners-up: drawn at random into seeds k+1..q, each constrained to the
    -- half opposite its own pool winner so two players out of one pool can
    -- only meet again in the final (spec §7). Bucket by the half a runner
    -- MUST take, shuffle inside the bucket, then walk the runner seeds in
    -- order: random among the valid arrangements, and exact in one pass.
    -- v_free covers the degenerate pool that contributed a runner but no
    -- eligible winner, which carries no constraint.
    SELECT array_agg(t.r ORDER BY t.rnd) FILTER (WHERE v_w_half[t.p] = 2),
           array_agg(t.r ORDER BY t.rnd) FILTER (WHERE v_w_half[t.p] = 1),
           array_agg(t.r ORDER BY t.rnd) FILTER (WHERE v_w_half[t.p] IS NULL)
      INTO v_need1, v_need2, v_free
      FROM (SELECT u.r, u.p, random() AS rnd
              FROM unnest(v_runners, v_runner_pool) AS u(r, p)) t;

    v_ordered := v_winners;
    FOR s IN v_k + 1 .. v_q LOOP
        IF v_half[s] = 1 THEN
            IF v_c1 <= coalesce(array_length(v_need1, 1), 0) THEN
                v_ordered[s] := v_need1[v_c1]; v_c1 := v_c1 + 1;
            ELSIF v_cf <= coalesce(array_length(v_free, 1), 0) THEN
                v_ordered[s] := v_free[v_cf];  v_cf := v_cf + 1;
            ELSE
                v_ordered[s] := v_need2[v_c2]; v_c2 := v_c2 + 1; v_relaxed := true;
            END IF;
        ELSE
            IF v_c2 <= coalesce(array_length(v_need2, 1), 0) THEN
                v_ordered[s] := v_need2[v_c2]; v_c2 := v_c2 + 1;
            ELSIF v_cf <= coalesce(array_length(v_free, 1), 0) THEN
                v_ordered[s] := v_free[v_cf];  v_cf := v_cf + 1;
            ELSE
                v_ordered[s] := v_need1[v_c1]; v_c1 := v_c1 + 1; v_relaxed := true;
            END IF;
        END IF;
    END LOOP;

    CREATE TEMP TABLE IF NOT EXISTS _gen_map (
        round_number   smallint NOT NULL,
        match_position smallint NOT NULL,
        match_id       uuid NOT NULL,
        PRIMARY KEY (round_number, match_position)
    ) ON COMMIT DROP;
    TRUNCATE _gen_map;

    FOR v_row IN
        SELECT * FROM public._lt_compute_bracket(v_ordered, v_size)
    LOOP
        INSERT INTO tournament_matches (
            tournament_id, round_number, match_position,
            player1_registration_id, player2_registration_id,
            player1_is_bye, player2_is_bye,
            winner_registration_id, status
        )
        VALUES (
            p_tournament_id, v_row.round_number, v_row.match_position,
            v_row.player1_registration_id, v_row.player2_registration_id,
            v_row.player1_is_bye, v_row.player2_is_bye,
            v_row.winner_registration_id, v_row.status
        )
        RETURNING id INTO v_new_id;

        INSERT INTO _gen_map VALUES (v_row.round_number, v_row.match_position, v_new_id);
    END LOOP;

    UPDATE tournament_matches tm
       SET next_match_id   = nxt.match_id,
           next_match_slot = CASE WHEN cur.match_position % 2 = 1 THEN 1 ELSE 2 END
      FROM _gen_map cur
      JOIN _gen_map nxt
        ON nxt.round_number   = cur.round_number + 1
       AND nxt.match_position = (cur.match_position + 1) / 2
     WHERE tm.id = cur.match_id;

    UPDATE tournaments
       SET version    = version + 1,
           updated_at = now()
     WHERE id = p_tournament_id;

    PERFORM public._lt_seed_default_deadlines(
        p_tournament_id, 'main', now(), v_tournament.end_date,
        (ln(v_size) / ln(2))::integer);

    -- Nothing else tells anyone the tree is live: this call does not change
    -- tournaments.status, so the lifecycle trigger never fires for it.
    PERFORM public.lt_notify_knockout_published(p_tournament_id);

    INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    VALUES (
        'tournament', p_tournament_id, 'generate_knockout', v_caller_id,
        jsonb_build_object(
            'qualifiers', v_q,
            'draw_size', v_size,
            'byes', v_size - v_q,
            'half_constraint_relaxed', v_relaxed
        )
    );

    RETURN QUERY
        SELECT * FROM tournament_matches
         WHERE tournament_id = p_tournament_id
           AND bracket_side = 'main'
         ORDER BY round_number, match_position;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tournament_generate_knockout(uuid, integer) TO authenticated;
