-- ============================================
-- Tournament result share — per-player result record
-- Spec: specs/17-leagues-tournaments/result-share.md
--
-- lt_registration_result(p_registration_id):
--   Core derivation for one entry of one completed tournament. The placement
--   ladder mirrors award_tournament_ranking_points (latest body:
--   20260811230000) so the card and the ledger can never disagree, and adds
--   what the ledger does not carry: the contested record, the best scalp, the
--   pool finish, the seed, the field size. Points join in from the ledger and
--   are NULL whenever no row exists — which is every draw run by an
--   uncertified organizer, since the gate deletes those rows.
--
-- tournament_my_result(p_tournament_id)       — authenticated, own entry only.
-- tournament_result_for_share(p_registration) — service_role, the OG poster.
-- ============================================

CREATE OR REPLACE FUNCTION public.lt_registration_result(p_registration_id uuid)
RETURNS TABLE (
    registration_id uuid,
    tournament_id   uuid,
    user_id         uuid,
    display_name    text,
    partner_name    text,
    avatar_url      text,
    referral_code   text,
    stage           text,
    placement       text,
    pool_letter     text,
    pool_rank       integer,
    wins            integer,
    losses          integer,
    best_win_name   text,
    best_win_seed   integer,
    points          integer,
    seed_rank       integer,
    field_size      integer,
    forfeited       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reg   tournament_registrations;
    v_t     tournaments;
    v_pool  integer;
    v_prank integer;
BEGIN
    SELECT * INTO v_reg FROM tournament_registrations r WHERE r.id = p_registration_id;
    IF v_reg.id IS NULL THEN
        RETURN;
    END IF;

    SELECT * INTO v_t FROM tournaments t WHERE t.id = v_reg.tournament_id;
    IF v_t.id IS NULL OR v_t.status <> 'completed' THEN
        RETURN;
    END IF;

    -- A withdrawn entry has no result to show. A forfeited one does (it played
    -- until it walked), and is flagged so the client can withhold the share.
    IF v_reg.withdrawn_at IS NOT NULL OR v_reg.status = 'withdrawn' THEN
        RETURN;
    END IF;

    -- Pool finish, pool_knockout only. tournament_pool_standings enforces its
    -- own visibility, which service_role fails on a private draw; the rank is
    -- then simply absent rather than fatal.
    IF v_t.bracket_type = 'pool_knockout' THEN
        SELECT tm.pool_number INTO v_pool
          FROM tournament_matches tm
         WHERE tm.tournament_id = v_t.id
           AND tm.bracket_side  = 'pool'
           AND p_registration_id IN (tm.player1_registration_id, tm.player2_registration_id)
         LIMIT 1;

        BEGIN
            SELECT ps.pool_rank INTO v_prank
              FROM public.tournament_pool_standings(v_t.id) ps
             WHERE ps.registration_id = p_registration_id;
        EXCEPTION WHEN OTHERS THEN
            v_prank := NULL;
        END;
    END IF;

    RETURN QUERY
    WITH matches AS (
        SELECT tm.id, tm.round_number, tm.status, tm.winner_registration_id,
               tm.next_match_id,
               tm.player1_registration_id, tm.player1_is_bye,
               tm.player2_registration_id, tm.player2_is_bye
          FROM tournament_matches tm
         WHERE tm.tournament_id = v_t.id
           AND tm.bracket_side  = 'main'
    ),
    slots AS (
        SELECT m.round_number, m.status, m.winner_registration_id,
               m.player1_registration_id AS reg,       m.player1_is_bye AS is_bye,
               m.player2_registration_id AS other_reg, m.player2_is_bye AS other_bye
          FROM matches m
        UNION ALL
        SELECT m.round_number, m.status, m.winner_registration_id,
               m.player2_registration_id, m.player2_is_bye,
               m.player1_registration_id, m.player1_is_bye
          FROM matches m
    ),
    -- Pool rows never carry byes and both slots are always filled, so a slot
    -- is a real appearance and `won` needs no bye guard.
    pool_slots AS (
        SELECT p.reg, p.status, p.won, p.other_reg
          FROM tournament_matches tm
          CROSS JOIN LATERAL (VALUES
              (tm.player1_registration_id, tm.status,
               tm.winner_registration_id IS NOT NULL
                 AND tm.winner_registration_id = tm.player1_registration_id,
               tm.player2_registration_id),
              (tm.player2_registration_id, tm.status,
               tm.winner_registration_id IS NOT NULL
                 AND tm.winner_registration_id = tm.player2_registration_id,
               tm.player1_registration_id)
          ) AS p(reg, status, won, other_reg)
         WHERE tm.tournament_id = v_t.id
           AND tm.bracket_side  = 'pool'
           AND p.reg IS NOT NULL
    ),
    entries AS (
        SELECT DISTINCT s.reg AS rid
          FROM slots s
         WHERE s.reg IS NOT NULL AND s.is_bye = false
        UNION
        SELECT DISTINCT ps.reg FROM pool_slots ps
    ),
    final_round AS (
        SELECT max(m.round_number) AS r FROM matches m
    ),
    final_match AS (
        SELECT m.winner_registration_id,
               m.player1_registration_id, m.player1_is_bye,
               m.player2_registration_id, m.player2_is_bye
          FROM matches m
         WHERE m.next_match_id IS NULL
         LIMIT 1
    ),
    champion AS (
        SELECT fm.winner_registration_id AS rid FROM final_match fm
    ),
    final_loser AS (
        SELECT CASE
                 WHEN fm.player1_registration_id IS NOT NULL AND NOT fm.player1_is_bye
                      AND fm.player1_registration_id <> fm.winner_registration_id
                   THEN fm.player1_registration_id
                 WHEN fm.player2_registration_id IS NOT NULL AND NOT fm.player2_is_bye
                      AND fm.player2_registration_id <> fm.winner_registration_id
                   THEN fm.player2_registration_id
                 ELSE NULL
               END AS rid
          FROM final_match fm
    ),
    my_exit AS (
        SELECT min(s.round_number) AS exit_round
          FROM slots s
         WHERE s.reg = p_registration_id AND s.is_bye = false
           AND s.winner_registration_id IS NOT NULL
           AND s.winner_registration_id <> s.reg
    ),
    -- Contested only: byes and walkovers advance a side without being played,
    -- so neither shows up in the record nor lifts a placement.
    my_beaten AS (
        SELECT s.other_reg AS rid, s.round_number AS rnd
          FROM slots s
         WHERE s.reg = p_registration_id AND s.is_bye = false
           AND s.winner_registration_id = s.reg
           AND s.other_reg IS NOT NULL AND s.other_bye = false
           AND s.status IN ('completed', 'retired')
        UNION ALL
        SELECT ps.other_reg, 0
          FROM pool_slots ps
         WHERE ps.reg = p_registration_id AND ps.won
           AND ps.other_reg IS NOT NULL
           AND ps.status IN ('completed', 'retired')
    ),
    my_lost_to AS (
        SELECT s.other_reg AS rid
          FROM slots s
         WHERE s.reg = p_registration_id AND s.is_bye = false
           AND s.winner_registration_id IS NOT NULL
           AND s.winner_registration_id <> s.reg
           AND s.other_reg IS NOT NULL AND s.other_bye = false
           AND s.status IN ('completed', 'retired')
        UNION ALL
        SELECT ps.other_reg
          FROM pool_slots ps
         WHERE ps.reg = p_registration_id AND NOT ps.won
           AND ps.other_reg IS NOT NULL
           AND ps.status IN ('completed', 'retired')
    ),
    best_win AS (
        SELECT b.rid, tr.seed_rank
          FROM my_beaten b
          JOIN tournament_registrations tr ON tr.id = b.rid
         ORDER BY tr.seed_rank NULLS LAST, b.rnd DESC
         LIMIT 1
    )
    SELECT
        v_reg.id,
        v_t.id,
        v_reg.user_id,
        nullif(trim(coalesce(p1.first_name, '') || ' ' || coalesce(p1.last_name, '')), ''),
        nullif(trim(coalesce(p2.first_name, '') || ' ' || coalesce(p2.last_name, '')), ''),
        p1.profile_picture_url,
        p1.referral_code::text,
        CASE
            WHEN EXISTS (SELECT 1 FROM slots s
                          WHERE s.reg = p_registration_id AND s.is_bye = false) THEN 'knockout'
            WHEN EXISTS (SELECT 1 FROM pool_slots ps
                          WHERE ps.reg = p_registration_id)                     THEN 'pool'
            ELSE 'none'
        END,
        CASE
            WHEN p_registration_id = (SELECT c.rid FROM champion c) THEN 'champion'
            WHEN v_t.bracket_type = 'double_elimination' THEN
                CASE WHEN p_registration_id = (SELECT fl.rid FROM final_loser fl)
                     THEN 'finalist' ELSE 'participated' END
            WHEN (SELECT count(*) FROM my_beaten) = 0                            THEN 'participated'
            WHEN (SELECT e.exit_round FROM my_exit e) = (SELECT f.r FROM final_round f)     THEN 'finalist'
            WHEN (SELECT e.exit_round FROM my_exit e) = (SELECT f.r FROM final_round f) - 1 THEN 'semifinal'
            WHEN (SELECT e.exit_round FROM my_exit e) = (SELECT f.r FROM final_round f) - 2 THEN 'quarterfinal'
            WHEN (SELECT e.exit_round FROM my_exit e) = (SELECT f.r FROM final_round f) - 3 THEN 'round_of_16'
            WHEN (SELECT e.exit_round FROM my_exit e) = (SELECT f.r FROM final_round f) - 4 THEN 'round_of_32'
            WHEN (SELECT e.exit_round FROM my_exit e) = (SELECT f.r FROM final_round f) - 5 THEN 'round_of_64'
            ELSE 'participated'
        END,
        CASE WHEN v_pool IS NULL THEN NULL ELSE chr(64 + v_pool) END,
        v_prank,
        (SELECT count(*)::int FROM my_beaten),
        (SELECT count(*)::int FROM my_lost_to),
        (SELECT public.lt_registration_display_name(bw.rid) FROM best_win bw),
        (SELECT bw.seed_rank::int FROM best_win bw),
        (SELECT trp.points FROM tournament_ranking_points trp
          WHERE trp.tournament_id = v_t.id AND trp.user_id = v_reg.user_id),
        v_reg.seed_rank::int,
        (SELECT count(*)::int FROM entries),
        v_reg.forfeited_at IS NOT NULL
      FROM profile p1
      LEFT JOIN profile p2 ON p2.id = v_reg.partner_user_id
     WHERE p1.id = v_reg.user_id;
END;
$$;

COMMENT ON FUNCTION public.lt_registration_result(uuid) IS
  'Per-entry result of a completed tournament: placement (same ladder as the '
  'ranking award), contested record, best scalp, pool finish, seed, field '
  'size. Points are NULL when the ledger has no row (uncertified organizer).';

REVOKE ALL ON FUNCTION public.lt_registration_result(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lt_registration_result(uuid) TO service_role;


-- --------------------------------------------
-- Caller-scoped wrapper: the mobile result card.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.tournament_my_result(p_tournament_id uuid)
RETURNS TABLE (
    registration_id uuid,
    tournament_id   uuid,
    user_id         uuid,
    display_name    text,
    partner_name    text,
    avatar_url      text,
    referral_code   text,
    stage           text,
    placement       text,
    pool_letter     text,
    pool_rank       integer,
    wins            integer,
    losses          integer,
    best_win_name   text,
    best_win_seed   integer,
    points          integer,
    seed_rank       integer,
    field_size      integer,
    forfeited       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reg uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    -- A player may hold one entry as the primary and appear as a partner on
    -- another; the primary entry is theirs to share.
    SELECT r.id INTO v_reg
      FROM tournament_registrations r
     WHERE r.tournament_id = p_tournament_id
       AND (r.user_id = v_uid OR r.partner_user_id = v_uid)
     ORDER BY (r.user_id = v_uid) DESC
     LIMIT 1;

    IF v_reg IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT * FROM public.lt_registration_result(v_reg);
END;
$$;

COMMENT ON FUNCTION public.tournament_my_result(uuid) IS
  'The calling player''s own result in a completed tournament. Empty when they '
  'did not enter, withdrew, or the tournament is not completed.';

REVOKE ALL ON FUNCTION public.tournament_my_result(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tournament_my_result(uuid) TO authenticated;


-- --------------------------------------------
-- Share wrapper: the /api/og/result poster route (service_role).
--
-- Keyed on the registration uuid, which is unguessable and carries only what
-- the bracket already shows. Forfeited entries are refused outright so a
-- walkout never renders a poster.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.tournament_result_for_share(p_registration_id uuid)
RETURNS TABLE (
    registration_id uuid,
    tournament_id   uuid,
    user_id         uuid,
    display_name    text,
    partner_name    text,
    avatar_url      text,
    referral_code   text,
    stage           text,
    placement       text,
    pool_letter     text,
    pool_rank       integer,
    wins            integer,
    losses          integer,
    best_win_name   text,
    best_win_seed   integer,
    points          integer,
    seed_rank       integer,
    field_size      integer,
    forfeited       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM public.lt_registration_result(p_registration_id) r
     WHERE r.forfeited = false;
END;
$$;

COMMENT ON FUNCTION public.tournament_result_for_share(uuid) IS
  'Poster-facing result lookup by registration id. Service role only; refuses '
  'forfeited entries.';

REVOKE ALL ON FUNCTION public.tournament_result_for_share(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_result_for_share(uuid) TO service_role;
