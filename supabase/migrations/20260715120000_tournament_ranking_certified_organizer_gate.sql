-- ============================================
-- Circuit Rallia — certified-organizer gate
-- ============================================
-- Only tournaments run by a certified organizer award Points Rallia. A
-- tournament from a random (non-certified) organizer completes normally but
-- contributes nothing to the Circuit Rallia ranking.
--
-- Certification is a per-player attribute (the organizer is a player), granted
-- by an admin — mirrors the existing community-network certification flow
-- (network.is_certified / admin_certify_network).
--
-- This migration:
--   1. Adds certification columns to public.player.
--   2. Adds admin_certify_organizer(player, bool, notes) — the admin grant RPC.
--   3. Re-creates award_tournament_ranking_points with the gate: a non-certified
--      organizer's tournament awards nothing (and any stale ledger rows are
--      cleared, so de-certifying + recomputing removes prior points).
-- ============================================


-- --------------------------------------------
-- 1. Per-player certified-organizer flag
-- --------------------------------------------
ALTER TABLE public.player
  ADD COLUMN IF NOT EXISTS is_certified_organizer   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certified_organizer_at    timestamptz,
  ADD COLUMN IF NOT EXISTS certified_organizer_by    uuid REFERENCES public.profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS certified_organizer_notes text;

COMMENT ON COLUMN public.player.is_certified_organizer IS
  'Whether this player is a certified tournament organizer. Only certified '
  'organizers'' tournaments award Circuit Rallia (Points Rallia) ranking points.';
COMMENT ON COLUMN public.player.certified_organizer_at IS
  'When the organizer certification was granted (NULL when not certified).';
COMMENT ON COLUMN public.player.certified_organizer_by IS
  'Admin who granted the organizer certification (NULL when not certified).';
COMMENT ON COLUMN public.player.certified_organizer_notes IS
  'Admin notes about the organizer certification.';

CREATE INDEX IF NOT EXISTS player_is_certified_organizer_idx
    ON public.player (is_certified_organizer)
    WHERE is_certified_organizer = true;


-- --------------------------------------------
-- 2. Admin grant RPC
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_certify_organizer(
    p_player_id   uuid,
    p_is_certified boolean,
    p_notes       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_id uuid;
BEGIN
    v_admin_id := auth.uid();

    IF NOT public.is_admin(v_admin_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.player WHERE id = p_player_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Player not found');
    END IF;

    UPDATE public.player
       SET is_certified_organizer    = p_is_certified,
           certified_organizer_at    = CASE WHEN p_is_certified THEN now() ELSE NULL END,
           certified_organizer_by    = CASE WHEN p_is_certified THEN v_admin_id ELSE NULL END,
           certified_organizer_notes = p_notes,
           updated_at                = now()
     WHERE id = p_player_id;

    RETURN jsonb_build_object(
        'success', true,
        'player_id', p_player_id,
        'is_certified', p_is_certified
    );
END;
$$;

COMMENT ON FUNCTION public.admin_certify_organizer(uuid, boolean, text) IS
  'Admin: certify or uncertify a player as a tournament organizer. Only '
  'certified organizers'' tournaments award Circuit Rallia ranking points.';

REVOKE ALL ON FUNCTION public.admin_certify_organizer(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_certify_organizer(uuid, boolean, text) TO authenticated;


-- --------------------------------------------
-- 3. Gate the award function on organizer certification
-- --------------------------------------------
-- Body is unchanged from 20260714120100 except the new certified-organizer
-- short-circuit inserted right after the completion checks: a non-certified
-- organizer awards nothing, and any stale ledger rows are cleared (idempotent).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.award_tournament_ranking_points(
    p_tournament_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t           tournaments;
    v_sport_id    uuid;
    v_season_id   uuid;
    v_double_elim boolean;
    v_certified   boolean;
BEGIN
    SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
    IF v_t.id IS NULL THEN
        RAISE EXCEPTION 'AWARD_TOURNAMENT_NOT_FOUND: %', p_tournament_id;
    END IF;
    IF v_t.status <> 'completed' OR v_t.completed_at IS NULL THEN
        RAISE EXCEPTION 'AWARD_TOURNAMENT_NOT_COMPLETED: % (status=%, completed_at=%)',
            p_tournament_id, v_t.status, v_t.completed_at;
    END IF;

    -- Certified-organizer gate: only a certified organizer's tournament awards
    -- Points Rallia. Non-certified → clear any stale rows and award nothing.
    SELECT p.is_certified_organizer INTO v_certified
      FROM player p WHERE p.id = v_t.organizer_id;
    IF v_certified IS NOT TRUE THEN
        DELETE FROM tournament_ranking_points WHERE tournament_id = p_tournament_id;
        RAISE NOTICE 'award_tournament_ranking_points: tournament % organizer % not '
            'certified — no ranking points awarded', p_tournament_id, v_t.organizer_id;
        RETURN;
    END IF;

    v_sport_id    := v_t.sport_id;
    v_double_elim := (v_t.bracket_type = 'double_elimination');

    -- Season (fail loudly — never award into a NULL season)
    SELECT id INTO v_season_id
      FROM ranking_season
     WHERE v_t.completed_at >= starts_at
       AND v_t.completed_at <  ends_at;
    IF v_season_id IS NULL THEN
        RAISE EXCEPTION 'AWARD_NO_RANKING_SEASON: tournament % completed_at %',
            p_tournament_id, v_t.completed_at;
    END IF;

    IF v_double_elim THEN
        RAISE WARNING 'award_tournament_ranking_points: double_elimination bracket % '
            '— awarding champion/finalist + participated only (full placement is v2)',
            p_tournament_id;
    END IF;

    -- Idempotent recompute
    DELETE FROM tournament_ranking_points WHERE tournament_id = p_tournament_id;

    INSERT INTO tournament_ranking_points (
        season_id, tournament_id, registration_id, user_id, sport_id,
        level_bucket, placement, tier, points, computed_at
    )
    WITH matches AS (
        SELECT id, round_number, status, winner_registration_id, next_match_id,
               player1_registration_id, player1_is_bye,
               player2_registration_id, player2_is_bye
          FROM tournament_matches
         WHERE tournament_id = p_tournament_id
           AND bracket_side  = 'main'
    ),
    slots AS (
        SELECT id AS match_id, round_number, winner_registration_id,
               player1_registration_id AS reg,       player1_is_bye AS is_bye,
               player2_registration_id AS other_reg, player2_is_bye AS other_bye
          FROM matches
        UNION ALL
        SELECT id, round_number, winner_registration_id,
               player2_registration_id, player2_is_bye,
               player1_registration_id, player1_is_bye
          FROM matches
    ),
    entries AS (
        SELECT DISTINCT reg AS registration_id
          FROM slots
         WHERE reg IS NOT NULL AND is_bye = false
    ),
    final_round AS (
        SELECT max(round_number) AS r FROM matches
    ),
    final_match AS (
        SELECT id, winner_registration_id,
               player1_registration_id, player1_is_bye,
               player2_registration_id, player2_is_bye
          FROM matches
         WHERE next_match_id IS NULL
         LIMIT 1
    ),
    champion AS (
        SELECT winner_registration_id AS reg FROM final_match
    ),
    final_loser AS (
        -- the real, non-winning slot of the final (only used for double-elim)
        SELECT CASE
                 WHEN fm.player1_registration_id IS NOT NULL AND NOT fm.player1_is_bye
                      AND fm.player1_registration_id <> fm.winner_registration_id
                   THEN fm.player1_registration_id
                 WHEN fm.player2_registration_id IS NOT NULL AND NOT fm.player2_is_bye
                      AND fm.player2_registration_id <> fm.winner_registration_id
                   THEN fm.player2_registration_id
                 ELSE NULL
               END AS reg
          FROM final_match fm
    ),
    exits AS (
        SELECT s.reg AS registration_id, min(s.round_number) AS exit_round
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.winner_registration_id IS NOT NULL
           AND s.winner_registration_id <> s.reg
         GROUP BY s.reg
    ),
    real_wins AS (
        SELECT s.reg AS registration_id, count(*) AS wins
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
           AND s.winner_registration_id = s.reg
           AND s.other_reg IS NOT NULL AND s.other_bye = false
         GROUP BY s.reg
    ),
    -- Tier field: expand entries to players, resolve active skill ordinal
    entry_players AS (
        SELECT r.user_id AS player_id
          FROM tournament_registrations r
          JOIN entries e ON e.registration_id = r.id
        UNION ALL
        SELECT r.partner_user_id
          FROM tournament_registrations r
          JOIN entries e ON e.registration_id = r.id
         WHERE r.partner_user_id IS NOT NULL
    ),
    player_skill AS (
        SELECT ep.player_id,
               CASE rs.skill_level
                 WHEN 'beginner'     THEN 1
                 WHEN 'intermediate' THEN 2
                 WHEN 'advanced'     THEN 3
                 WHEN 'professional' THEN 4
               END AS ord
          FROM entry_players ep
          LEFT JOIN player_sport ps
                 ON ps.player_id = ep.player_id AND ps.sport_id = v_sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs        ON rs.id  = prs.rating_score_id
    ),
    field AS (
        SELECT
            (SELECT count(*) FROM entries)                                   AS n,
            (SELECT avg(ord) FROM player_skill WHERE ord IS NOT NULL)        AS strength,
            (SELECT count(*) FILTER (WHERE ord IS NOT NULL)::numeric
                    / NULLIF(count(*), 0) FROM player_skill)                 AS rated_frac
    ),
    tier AS (
        SELECT
            CASE
                WHEN n >= 16 AND strength >= 2.5 AND rated_frac >= 0.5 THEN 'vedette'
                WHEN n >= 8                                            THEN 'regional'
                ELSE 'local'
            END AS tier,
            CASE
                WHEN n >= 16 AND strength >= 2.5 AND rated_frac >= 0.5 THEN 2.0
                WHEN n >= 8                                            THEN 1.0
                ELSE 0.5
            END AS mult
          FROM field
    ),
    placed AS (
        SELECT
            e.registration_id,
            CASE
                WHEN e.registration_id = (SELECT reg FROM champion) THEN 'champion'
                WHEN v_double_elim THEN
                    CASE WHEN e.registration_id = (SELECT reg FROM final_loser)
                         THEN 'finalist' ELSE 'participated' END
                WHEN coalesce(rw.wins, 0) = 0                          THEN 'participated'
                WHEN ex.exit_round = (SELECT r FROM final_round)       THEN 'finalist'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 1   THEN 'semifinal'
                WHEN ex.exit_round = (SELECT r FROM final_round) - 2   THEN 'quarterfinal'
                ELSE 'participated'
            END AS placement
          FROM entries e
          LEFT JOIN exits     ex ON ex.registration_id = e.registration_id
          LEFT JOIN real_wins rw ON rw.registration_id = e.registration_id
    ),
    -- One row per (registration, player); local tier floors points to participation
    expanded AS (
        SELECT r.id AS registration_id, r.user_id AS player_id, p.placement, t.tier,
               CASE WHEN t.tier = 'local' THEN 'participated' ELSE p.placement END AS eff_placement,
               t.mult
          FROM placed p
          JOIN tournament_registrations r ON r.id = p.registration_id
          CROSS JOIN tier t
        UNION ALL
        SELECT r.id, r.partner_user_id, p.placement, t.tier,
               CASE WHEN t.tier = 'local' THEN 'participated' ELSE p.placement END,
               t.mult
          FROM placed p
          JOIN tournament_registrations r ON r.id = p.registration_id
          CROSS JOIN tier t
         WHERE r.partner_user_id IS NOT NULL
    ),
    scored AS (
        SELECT
            ex.registration_id, ex.player_id, ex.placement, ex.tier,
            round(
                CASE ex.eff_placement
                    WHEN 'champion'     THEN 500
                    WHEN 'finalist'     THEN 300
                    WHEN 'semifinal'    THEN 180
                    WHEN 'quarterfinal' THEN 90
                    ELSE 20
                END * ex.mult
            )::int AS points,
            CASE rs.skill_level
                WHEN 'professional' THEN 'advanced'
                WHEN 'advanced'     THEN 'advanced'
                WHEN 'intermediate' THEN 'intermediate'
                WHEN 'beginner'     THEN 'beginner'
                ELSE NULL
            END AS level_bucket
          FROM expanded ex
          LEFT JOIN player_sport ps
                 ON ps.player_id = ex.player_id AND ps.sport_id = v_sport_id
          LEFT JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
          LEFT JOIN rating_score rs        ON rs.id  = prs.rating_score_id
    ),
    -- Dedupe a player who appears in >1 entry (primary + partner) to one row,
    -- keeping the higher-points result — avoids ON CONFLICT hitting a row twice.
    deduped AS (
        SELECT DISTINCT ON (player_id)
               registration_id, player_id, placement, tier, points, level_bucket
          FROM scored
         ORDER BY player_id, points DESC
    )
    SELECT
        v_season_id, p_tournament_id, d.registration_id, d.player_id, v_sport_id,
        d.level_bucket, d.placement, d.tier, d.points, now()
      FROM deduped d
    ON CONFLICT (tournament_id, user_id) DO UPDATE
        SET registration_id = EXCLUDED.registration_id,
            placement       = EXCLUDED.placement,
            tier            = EXCLUDED.tier,
            points          = EXCLUDED.points,
            level_bucket    = EXCLUDED.level_bucket,
            computed_at     = EXCLUDED.computed_at
      WHERE EXCLUDED.points > tournament_ranking_points.points;
END;
$$;

REVOKE ALL ON FUNCTION public.award_tournament_ranking_points(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_tournament_ranking_points(uuid) TO service_role;
