-- Migration: get_player_match_history RPC
-- Returns a target player's past games that have a verified, non-disputed score,
-- fully hydrated (participants + sets as jsonb) so the mobile profile can render
-- both the compact history row AND the PlayedMatchDetail screen with no second
-- round-trip.
--
-- SECURITY DEFINER: match/match_participant are RLS-gated to participants + public
-- matches, so a prospective opponent viewing someone's profile cannot read their
-- private-match rows directly. This function bypasses that to expose a controlled
-- projection. Per product decision, any verified score is visible to any
-- authenticated viewer (scores already live in publicly-readable tables).

CREATE OR REPLACE FUNCTION get_player_match_history(
  p_player_id UUID,
  p_sport_id  UUID DEFAULT NULL,
  p_limit     INT  DEFAULT 10,
  p_offset    INT  DEFAULT 0
)
RETURNS TABLE (
  match_id           UUID,
  match_date         DATE,
  start_time         TIME,
  sport_id           UUID,
  sport_name         TEXT,
  sport_icon_url     TEXT,
  format             TEXT,
  player_expectation TEXT,
  location_name      TEXT,
  target_team_number INT,
  result_id          UUID,
  winning_team       INT,
  team1_score        INT,
  team2_score        INT,
  is_verified        BOOLEAN,
  created_by         UUID,
  participants       JSONB,
  sets               JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.match_date,
    m.start_time,
    m.sport_id,
    s.name::text,
    s.icon_url::text,
    m.format::text,
    m.player_expectation::text,
    COALESCE(f.name, m.location_name)::text,
    tmp.team_number,
    mr.id,
    mr.winning_team,
    mr.team1_score,
    mr.team2_score,
    mr.is_verified,
    m.created_by,
    -- Both teams' participants, shaped exactly as PlayedMatchDetail expects.
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          mp.id,
          'player_id',   mp.player_id,
          'team_number', mp.team_number,
          'is_host',     mp.is_host,
          'player', jsonb_build_object(
            'id', mp.player_id,
            'profile', jsonb_build_object(
              'first_name',          p.first_name,
              'last_name',           p.last_name,
              'display_name',        p.display_name,
              'profile_picture_url', p.profile_picture_url
            )
          )
        )
        ORDER BY mp.team_number, mp.created_at
      )
      FROM match_participant mp
      JOIN profile p ON p.id = mp.player_id
      WHERE mp.match_id = m.id
        AND mp.status = 'joined'
    ), '[]'::jsonb),
    -- Ordered set list (empty array when no per-set scores were recorded).
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          ms.id,
          'set_number',  ms.set_number,
          'team1_score', ms.team1_score,
          'team2_score', ms.team2_score
        )
        ORDER BY ms.set_number
      )
      FROM match_set ms
      WHERE ms.match_result_id = mr.id
    ), '[]'::jsonb)
  FROM match m
  JOIN match_participant tmp
    ON tmp.match_id = m.id
   AND tmp.player_id = p_player_id
   AND tmp.status = 'joined'
  JOIN match_result mr ON mr.match_id = m.id
  JOIN sport s ON s.id = m.sport_id
  LEFT JOIN facility f ON f.id = m.facility_id
  WHERE mr.is_verified = TRUE
    AND COALESCE(mr.disputed, FALSE) = FALSE
    AND m.cancelled_at IS NULL
    AND COALESCE(m.mutually_cancelled, FALSE) = FALSE
    AND (p_sport_id IS NULL OR m.sport_id = p_sport_id)
  ORDER BY (m.match_date + m.start_time) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION get_player_match_history(UUID, UUID, INT, INT) IS
  'Returns a target player''s past games that have a verified, non-disputed score, fully hydrated (participants + sets as jsonb) for the mobile profile game-history section. SECURITY DEFINER to allow cross-player reads of private-match scores; any verified score is visible to any authenticated viewer.';

GRANT EXECUTE ON FUNCTION get_player_match_history(UUID, UUID, INT, INT) TO authenticated;
