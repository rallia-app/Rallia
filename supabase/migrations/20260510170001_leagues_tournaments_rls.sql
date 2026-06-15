-- ============================================
-- Leagues & Tournaments — RLS helpers + policies (Phase 1 / migration 2 of 3)
-- ============================================
-- Spec: specs/17-leagues-tournaments/permissions.md
--
-- Reuses public.is_admin() from 20260321090000_fix_admin_rls_infinite_recursion.sql.
--
-- Helpers are SECURITY DEFINER so they bypass RLS on their target tables.
-- Without that, policies that call is_tournament_organizer (etc.) would
-- recurse into their own table's policies.
--
-- Write policies on every L&T table deny direct mutation; all writes flow
-- through SECURITY DEFINER RPCs landing in the next migration. Tournament
-- and league rows can still be inserted directly (they need an INSERT
-- policy because the create RPCs run as the caller for the row's
-- organizer_id check); the no-direct-write pattern starts at the children.
-- ============================================


-- ============================================
-- HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.is_tournament_organizer(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM tournaments t
         WHERE t.id = p_tournament_id AND t.organizer_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM tournament_co_organizers c
         WHERE c.tournament_id = p_tournament_id AND c.user_id = auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_tournament_organizer(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.is_league_organizer(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM leagues l
         WHERE l.id = p_league_id AND l.organizer_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM league_members m
         WHERE m.league_id = p_league_id
           AND m.user_id = auth.uid()
           AND m.role = 'co_organizer'
           AND m.status = 'active'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_league_organizer(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.is_active_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM league_members m
         WHERE m.league_id = p_league_id
           AND m.user_id  = auth.uid()
           AND m.status   = 'active'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_league_member(uuid) TO authenticated;


-- Sport-scope helper used by every L&T write RPC (migration 3). Defined here
-- so it's available immediately for RLS testing or manual sanity checks.
CREATE OR REPLACE FUNCTION public.assert_caller_plays_sport(p_sport_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM player_sport
         WHERE player_id = auth.uid()
           AND sport_id  = p_sport_id
           AND is_active = true
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SPORT_MISMATCH';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_caller_plays_sport(uuid) TO authenticated;


-- ============================================
-- ENABLE RLS
-- ============================================

ALTER TABLE tournaments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_invite_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_co_organizers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_waitlist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_match_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_invite_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_member_waitlist    ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_courts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_presence          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_matches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_match_scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_rankings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues_tournaments_audit ENABLE ROW LEVEL SECURITY;


-- ============================================
-- TOURNAMENT POLICIES
-- ============================================

DROP POLICY IF EXISTS tournaments_select ON tournaments;
CREATE POLICY tournaments_select ON tournaments FOR SELECT
USING (
    public.is_admin()
    OR visibility = 'public'
    OR organizer_id = auth.uid()
    OR public.is_tournament_organizer(id)
    OR EXISTS (
        SELECT 1 FROM tournament_registrations r
         WHERE r.tournament_id = tournaments.id AND r.user_id = auth.uid()
    )
    OR (
        visibility = 'community'
        AND network_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM network_member nm
             WHERE nm.network_id = tournaments.network_id
               AND nm.player_id  = auth.uid()
               AND nm.status     = 'active'
        )
    )
);

DROP POLICY IF EXISTS tournaments_insert ON tournaments;
CREATE POLICY tournaments_insert ON tournaments FOR INSERT
WITH CHECK (organizer_id = auth.uid());

DROP POLICY IF EXISTS tournaments_update ON tournaments;
CREATE POLICY tournaments_update ON tournaments FOR UPDATE
USING     (public.is_admin() OR public.is_tournament_organizer(id))
WITH CHECK (public.is_admin() OR public.is_tournament_organizer(id));

DROP POLICY IF EXISTS tournaments_delete ON tournaments;
CREATE POLICY tournaments_delete ON tournaments FOR DELETE
USING (public.is_admin() OR organizer_id = auth.uid());


DROP POLICY IF EXISTS tinvite_select ON tournament_invite_links;
CREATE POLICY tinvite_select ON tournament_invite_links FOR SELECT
USING (public.is_admin() OR public.is_tournament_organizer(tournament_id));

DROP POLICY IF EXISTS tinvite_no_direct_write ON tournament_invite_links;
CREATE POLICY tinvite_no_direct_write ON tournament_invite_links FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS tco_select ON tournament_co_organizers;
CREATE POLICY tco_select ON tournament_co_organizers FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_tournament_organizer(tournament_id)
);

DROP POLICY IF EXISTS tco_no_direct_write ON tournament_co_organizers;
CREATE POLICY tco_no_direct_write ON tournament_co_organizers FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS treg_select ON tournament_registrations;
CREATE POLICY treg_select ON tournament_registrations FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_tournament_organizer(tournament_id)
    OR EXISTS (
        SELECT 1 FROM tournaments t
         WHERE t.id = tournament_registrations.tournament_id
           AND t.visibility = 'public'
    )
);

DROP POLICY IF EXISTS treg_no_direct_write ON tournament_registrations;
CREATE POLICY treg_no_direct_write ON tournament_registrations FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS twait_select ON tournament_waitlist;
CREATE POLICY twait_select ON tournament_waitlist FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_tournament_organizer(tournament_id)
);

DROP POLICY IF EXISTS twait_no_direct_write ON tournament_waitlist;
CREATE POLICY twait_no_direct_write ON tournament_waitlist FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS tmatches_select ON tournament_matches;
CREATE POLICY tmatches_select ON tournament_matches FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1 FROM tournaments t
         WHERE t.id = tournament_matches.tournament_id
           AND t.visibility = 'public'
    )
    OR public.is_tournament_organizer(tournament_id)
    OR EXISTS (
        SELECT 1 FROM tournament_registrations r
         WHERE r.tournament_id = tournament_matches.tournament_id
           AND r.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS tmatches_no_direct_write ON tournament_matches;
CREATE POLICY tmatches_no_direct_write ON tournament_matches FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS tmscores_select ON tournament_match_scores;
CREATE POLICY tmscores_select ON tournament_match_scores FOR SELECT
USING (
    public.is_admin()
    OR submitted_by = auth.uid()
    OR EXISTS (
        SELECT 1
          FROM tournament_matches m
         WHERE m.id = tournament_match_scores.tournament_match_id
           AND public.is_tournament_organizer(m.tournament_id)
    )
);

DROP POLICY IF EXISTS tmscores_no_direct_write ON tournament_match_scores;
CREATE POLICY tmscores_no_direct_write ON tournament_match_scores FOR ALL
USING (false) WITH CHECK (false);


-- ============================================
-- LEAGUE POLICIES
-- ============================================

DROP POLICY IF EXISTS leagues_select ON leagues;
CREATE POLICY leagues_select ON leagues FOR SELECT
USING (
    public.is_admin()
    OR visibility = 'public'
    OR organizer_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM league_members m
         WHERE m.league_id = leagues.id AND m.user_id = auth.uid()
    )
    OR (
        visibility = 'community'
        AND network_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM network_member nm
             WHERE nm.network_id = leagues.network_id
               AND nm.player_id  = auth.uid()
               AND nm.status     = 'active'
        )
    )
);

DROP POLICY IF EXISTS leagues_insert ON leagues;
CREATE POLICY leagues_insert ON leagues FOR INSERT
WITH CHECK (organizer_id = auth.uid());

DROP POLICY IF EXISTS leagues_update ON leagues;
CREATE POLICY leagues_update ON leagues FOR UPDATE
USING     (public.is_admin() OR public.is_league_organizer(id))
WITH CHECK (public.is_admin() OR public.is_league_organizer(id));

DROP POLICY IF EXISTS leagues_delete ON leagues;
CREATE POLICY leagues_delete ON leagues FOR DELETE
USING (public.is_admin() OR organizer_id = auth.uid());


DROP POLICY IF EXISTS linvite_select ON league_invite_links;
CREATE POLICY linvite_select ON league_invite_links FOR SELECT
USING (public.is_admin() OR public.is_league_organizer(league_id));

DROP POLICY IF EXISTS linvite_no_direct_write ON league_invite_links;
CREATE POLICY linvite_no_direct_write ON league_invite_links FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS lm_select ON league_members;
CREATE POLICY lm_select ON league_members FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_league_organizer(league_id)
    OR public.is_active_league_member(league_id)
);

DROP POLICY IF EXISTS lm_no_direct_write ON league_members;
CREATE POLICY lm_no_direct_write ON league_members FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS lmw_select ON league_member_waitlist;
CREATE POLICY lmw_select ON league_member_waitlist FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_league_organizer(league_id)
);

DROP POLICY IF EXISTS lmw_no_direct_write ON league_member_waitlist;
CREATE POLICY lmw_no_direct_write ON league_member_waitlist FOR ALL
USING (false) WITH CHECK (false);


-- ============================================
-- SEASON / SESSION POLICIES
-- ============================================

DROP POLICY IF EXISTS seasons_select ON seasons;
CREATE POLICY seasons_select ON seasons FOR SELECT
USING (
    public.is_admin()
    OR public.is_league_organizer(league_id)
    OR public.is_active_league_member(league_id)
    OR EXISTS (
        SELECT 1 FROM leagues l
         WHERE l.id = seasons.league_id AND l.visibility = 'public'
    )
);

DROP POLICY IF EXISTS seasons_no_direct_write ON seasons;
CREATE POLICY seasons_no_direct_write ON seasons FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS sessions_select ON sessions;
CREATE POLICY sessions_select ON sessions FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1 FROM seasons s
          JOIN leagues l ON l.id = s.league_id
         WHERE s.id = sessions.season_id
           AND (
               l.visibility = 'public'
               OR public.is_league_organizer(l.id)
               OR public.is_active_league_member(l.id)
           )
    )
);

DROP POLICY IF EXISTS sessions_no_direct_write ON sessions;
CREATE POLICY sessions_no_direct_write ON sessions FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS scourts_select ON session_courts;
CREATE POLICY scourts_select ON session_courts FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1
          FROM sessions ss
          JOIN seasons  s ON s.id = ss.season_id
          JOIN leagues  l ON l.id = s.league_id
         WHERE ss.id = session_courts.session_id
           AND (
               l.visibility = 'public'
               OR public.is_league_organizer(l.id)
               OR public.is_active_league_member(l.id)
           )
    )
);

DROP POLICY IF EXISTS scourts_no_direct_write ON session_courts;
CREATE POLICY scourts_no_direct_write ON session_courts FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS spresence_select ON session_presence;
CREATE POLICY spresence_select ON session_presence FOR SELECT
USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
        SELECT 1
          FROM sessions ss
          JOIN seasons  s ON s.id = ss.season_id
          JOIN leagues  l ON l.id = s.league_id
         WHERE ss.id = session_presence.session_id
           AND (public.is_league_organizer(l.id) OR public.is_active_league_member(l.id))
    )
);

DROP POLICY IF EXISTS spresence_no_direct_write ON session_presence;
CREATE POLICY spresence_no_direct_write ON session_presence FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS smatches_select ON session_matches;
CREATE POLICY smatches_select ON session_matches FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1
          FROM sessions ss
          JOIN seasons  s ON s.id = ss.season_id
          JOIN leagues  l ON l.id = s.league_id
         WHERE ss.id = session_matches.session_id
           AND (
               l.visibility = 'public'
               OR public.is_league_organizer(l.id)
               OR public.is_active_league_member(l.id)
           )
    )
);

DROP POLICY IF EXISTS smatches_no_direct_write ON session_matches;
CREATE POLICY smatches_no_direct_write ON session_matches FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS smscores_select ON session_match_scores;
CREATE POLICY smscores_select ON session_match_scores FOR SELECT
USING (
    public.is_admin()
    OR submitted_by = auth.uid()
    OR EXISTS (
        SELECT 1
          FROM session_matches m
          JOIN sessions ss      ON ss.id = m.session_id
          JOIN seasons  s       ON s.id  = ss.season_id
          JOIN leagues  l       ON l.id  = s.league_id
         WHERE m.id = session_match_scores.session_match_id
           AND (public.is_league_organizer(l.id) OR public.is_active_league_member(l.id))
    )
);

DROP POLICY IF EXISTS smscores_no_direct_write ON session_match_scores;
CREATE POLICY smscores_no_direct_write ON session_match_scores FOR ALL
USING (false) WITH CHECK (false);


DROP POLICY IF EXISTS rankings_select ON season_rankings;
CREATE POLICY rankings_select ON season_rankings FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1 FROM seasons s
          JOIN leagues l ON l.id = s.league_id
         WHERE s.id = season_rankings.season_id
           AND (
               l.visibility = 'public'
               OR public.is_league_organizer(l.id)
               OR public.is_active_league_member(l.id)
           )
    )
);

DROP POLICY IF EXISTS rankings_no_direct_write ON season_rankings;
CREATE POLICY rankings_no_direct_write ON season_rankings FOR ALL
USING (false) WITH CHECK (false);


-- ============================================
-- AUDIT POLICIES
-- ============================================

DROP POLICY IF EXISTS audit_select ON leagues_tournaments_audit;
CREATE POLICY audit_select ON leagues_tournaments_audit FOR SELECT
USING (
    public.is_admin()
    OR (scope = 'tournament' AND public.is_tournament_organizer(entity_id))
    OR (scope = 'league'     AND public.is_league_organizer(entity_id))
);

DROP POLICY IF EXISTS audit_no_direct_write ON leagues_tournaments_audit;
CREATE POLICY audit_no_direct_write ON leagues_tournaments_audit FOR ALL
USING (false) WITH CHECK (false);
