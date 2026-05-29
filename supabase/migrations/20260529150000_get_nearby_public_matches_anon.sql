-- =============================================================================
-- RPC: get_nearby_public_matches  (signed-out "Nearby" carousel)
-- =============================================================================
-- Single-round-trip match pool for the Home "Nearby" carousel when SIGNED OUT.
--
-- Replaces the legacy anon path for that carousel — which was:
--   search_matches_nearby (match IDs) → match-detail SELECT (hydrate) → JS
--   scoreNearbyMatch + getTopSuggestions (get_match_suggestions_anon) → merge —
-- with one RPC that geo-filters joinable public matches, ranks them on a simple
-- caller-independent signal, and returns the top p_limit rows as full
-- MatchWithDetails JSONB so the carousel renders (and the detail sheet opens)
-- with no follow-up fetch.
--
-- WHY a dedicated anon RPC (not get_just_for_you): get_just_for_you is built
-- entirely around p_caller_id — effective rating, history, blocks, availability
-- overlap. An anon user supplies none of those, so its caller-scoped scoring
-- CTEs have no inputs. The signed-out carousel is a different, simpler product
-- ("top nearby public matches"), and dropping the suggestion pool removes
-- get_match_suggestions_anon — the worst-performing anon RPC (scans the whole
-- player pool; see project memory suggestion-rpc-perf) — from this path
-- entirely. Net: signed-out goes from N round-trips + a player-pool scan to one
-- bounded, match-only query.
--
-- Ranking (caller-independent, deterministic — no random jitter, so results are
-- stable and the 10-min client cache is meaningful):
--     0.45 * proximity   (closer to the searched point ranks higher)
--   + 0.35 * urgency      (sooner match_date ranks higher)
--   + 0.20 * spots_left   (a match needing ~1 more player is most actionable)
-- Full matches (spots_left <= 0) are kept but sink to the bottom — mirrors
-- search_matches_nearby's deliberate inclusion of full matches in browse.
--
-- SECURITY: SECURITY DEFINER + granted to anon, like search_matches_nearby /
-- the scored RPCs. Safe because the candidate set is restricted to
-- visibility='public' matches, and the JSONB payload exposes exactly the
-- columns the anon client already reads today via RLS (from('match').select('*'
-- + sport/facility/court/min_rating_score/participants) and
-- from('profile').select('*')). No new column or row exposure.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_nearby_public_matches(
  p_sport_id        uuid,
  p_latitude        double precision,
  p_longitude       double precision,
  p_max_distance_km double precision,
  p_user_gender     text             DEFAULT NULL,
  p_limit           integer          DEFAULT 5
)
RETURNS TABLE(
  score         numeric,
  match_payload jsonb
)
LANGUAGE plpgsql
-- STABLE: reads only, no random() (unlike get_just_for_you). Deterministic
-- output for a given (point, sport, radius) within a statement.
STABLE
SECURITY DEFINER
AS $function$
DECLARE
  v_point extensions.geography;
  v_now   TIMESTAMPTZ := NOW();
BEGIN
  IF p_sport_id IS NULL OR p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN;
  END IF;

  v_point :=
    extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::extensions.geography;

  RETURN QUERY
  WITH
  -- ── Per-player effective rating for this sport (cert > self > disputed;
  --    recency tiebreak). Caller-independent — needed only to fill the
  --    sportRating* fields in the JSONB payload. ──────────────────────────
  effective_rating AS (
    SELECT DISTINCT ON (prs.player_id)
      prs.player_id,
      rs.value::DOUBLE PRECISION AS rating_value,
      rs.label::TEXT             AS rating_label,
      prs.badge_status           AS badge_status
    FROM player_rating_score prs
    JOIN rating_score rs    ON rs.id   = prs.rating_score_id
    JOIN rating_system rsys ON rsys.id = rs.rating_system_id
    WHERE rsys.sport_id = p_sport_id
    ORDER BY prs.player_id,
      CASE
        WHEN prs.badge_status = 'certified'::badge_status_enum
          OR prs.is_certified
          OR prs.referrals_count >= 3
          OR prs.approved_proofs_count >= 1 THEN 2
        WHEN prs.badge_status = 'disputed'::badge_status_enum THEN 0
        ELSE 1
      END DESC,
      prs.assigned_at DESC
  ),

  -- ── Nearby joinable public matches (mirrors search_matches_nearby's
  --    visibility/location/gender filter; future start with a 30-min lead
  --    to match isMatchStillJoinable's default). ─────────────────────────
  candidate_matches AS (
    SELECT
      m.id         AS m_id,
      m.match_date AS m_date,
      extensions.ST_Distance(
        CASE
          WHEN m.location_type = 'facility' AND f.location IS NOT NULL THEN f.location
          WHEN m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL THEN
            extensions.ST_SetSRID(
              extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
            )::extensions.geography
          ELSE NULL
        END,
        v_point
      ) AS m_distance_meters,
      (
        (CASE WHEN m.format = 'doubles' THEN 4 ELSE 2 END)
        - COALESCE((
            SELECT COUNT(*) FROM match_participant pp
             WHERE pp.match_id = m.id AND pp.status = 'joined'
          ), 0)
      ) AS spots_left
    FROM match m
    LEFT JOIN facility f ON f.id = m.facility_id
    WHERE m.visibility = 'public'
      AND m.cancelled_at IS NULL
      AND m.sport_id    = p_sport_id
      AND (
        CASE
          WHEN m.timezone IS NOT NULL THEN
            timezone(m.timezone, (m.match_date + m.start_time)::timestamp)
          ELSE
            (m.match_date + m.start_time) AT TIME ZONE 'UTC'
        END
      ) > v_now + INTERVAL '30 minutes'
      AND (
        (m.location_type = 'facility' AND f.is_active = TRUE AND f.location IS NOT NULL)
        OR (m.location_type = 'custom'
            AND m.custom_latitude IS NOT NULL
            AND m.custom_longitude IS NOT NULL)
      )
      AND extensions.ST_DWithin(
        CASE
          WHEN m.location_type = 'facility' THEN f.location
          ELSE extensions.ST_SetSRID(
            extensions.ST_MakePoint(m.custom_longitude, m.custom_latitude), 4326
          )::extensions.geography
        END,
        v_point,
        p_max_distance_km * 1000
      )
      AND (
        p_user_gender IS NULL
        OR m.preferred_opponent_gender IS NULL
        OR m.preferred_opponent_gender = p_user_gender::gender_enum
      )
  ),

  -- ── Rank + cap to p_limit BEFORE building the (expensive) JSONB. ────────
  top_matches AS (
    SELECT
      cm.m_id,
      cm.m_distance_meters,
      (
          0.45 * GREATEST(0::numeric,
                   1.0 - cm.m_distance_meters::numeric / NULLIF(p_max_distance_km * 1000, 0))
        + 0.35 * (CASE
                    WHEN cm.m_date <= CURRENT_DATE     THEN 1.00
                    WHEN cm.m_date  = CURRENT_DATE + 1 THEN 0.85
                    WHEN cm.m_date  = CURRENT_DATE + 2 THEN 0.70
                    WHEN cm.m_date  = CURRENT_DATE + 3 THEN 0.55
                    WHEN cm.m_date <= CURRENT_DATE + 7 THEN 0.40
                    ELSE 0.25
                  END)
        + 0.20 * (CASE
                    WHEN cm.spots_left <= 0 THEN 0.10
                    WHEN cm.spots_left  = 1 THEN 1.00
                    WHEN cm.spots_left  = 2 THEN 0.80
                    WHEN cm.spots_left  = 3 THEN 0.60
                    ELSE 0.40
                  END)
      )::DECIMAL(8,4) AS final_score
    FROM candidate_matches cm
    ORDER BY final_score DESC, cm.m_distance_meters ASC NULLS LAST
    LIMIT p_limit
  ),

  -- ── Full MatchWithDetails JSONB (byte-shape mirror of get_just_for_you's
  --    match_payloads builder, which mirrors getMatchWithDetails). The
  --    caller-scoped score fields are null in anon mode. ────────────────────
  match_payloads AS (
    SELECT
      tm.final_score AS score,
      to_jsonb(m.*)
        || jsonb_build_object(
          'distance_meters', tm.m_distance_meters,
          'player_compatibility', NULL::numeric,
          'facility_affinity', NULL::numeric,
          'score_history', NULL::numeric,
          'sport', to_jsonb(sp.*),
          'facility', CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f.*) END,
          'court', CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c.*) END,
          'min_rating_score', CASE WHEN mrs.id IS NULL THEN NULL ELSE to_jsonb(mrs.*) END,
          'created_by_player', (
            SELECT jsonb_build_object(
              'id', cp.id,
              'gender', cp.gender,
              'playing_hand', cp.playing_hand,
              'max_travel_distance', cp.max_travel_distance,
              'notification_match_requests', cp.notification_match_requests,
              'notification_messages', cp.notification_messages,
              'notification_reminders', cp.notification_reminders,
              'privacy_show_age', cp.privacy_show_age,
              'privacy_show_location', cp.privacy_show_location,
              'privacy_show_stats', cp.privacy_show_stats,
              'profile', to_jsonb(cprof.*),
              'player_reputation', CASE WHEN crep.player_id IS NULL THEN NULL
                                        ELSE jsonb_build_object(
                                          'reputation_score', crep.reputation_score,
                                          'total_events', crep.total_events
                                        ) END,
              'sportRatingLabel', cer.rating_label,
              'sportRatingValue', cer.rating_value,
              'sportCertificationStatus', cer.badge_status
            )
            FROM player cp
            LEFT JOIN profile cprof ON cprof.id = cp.id
            LEFT JOIN player_reputation crep ON crep.player_id = cp.id
            LEFT JOIN effective_rating cer ON cer.player_id = cp.id
            WHERE cp.id = m.created_by
          ),
          'participants', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', mp.id,
                'match_id', mp.match_id,
                'player_id', mp.player_id,
                'status', mp.status,
                'is_host', mp.is_host,
                'score', mp.score,
                'team_number', mp.team_number,
                'feedback_completed', mp.feedback_completed,
                'has_paid', mp.has_paid,
                'payment_intent_id', mp.payment_intent_id,
                'checked_in_at', mp.checked_in_at,
                'joined_at', mp.joined_at,
                'created_at', mp.created_at,
                'updated_at', mp.updated_at,
                'player', jsonb_build_object(
                  'id', pp.id,
                  'gender', pp.gender,
                  'playing_hand', pp.playing_hand,
                  'max_travel_distance', pp.max_travel_distance,
                  'notification_match_requests', pp.notification_match_requests,
                  'notification_messages', pp.notification_messages,
                  'notification_reminders', pp.notification_reminders,
                  'privacy_show_age', pp.privacy_show_age,
                  'privacy_show_location', pp.privacy_show_location,
                  'privacy_show_stats', pp.privacy_show_stats,
                  'profile', to_jsonb(pprof.*),
                  'player_reputation', CASE WHEN prep2.player_id IS NULL THEN NULL
                                            ELSE jsonb_build_object(
                                              'reputation_score', prep2.reputation_score,
                                              'total_events', prep2.total_events
                                            ) END,
                  'sportRatingLabel', per.rating_label,
                  'sportRatingValue', per.rating_value,
                  'sportCertificationStatus', per.badge_status
                )
              )
            )
            FROM match_participant mp
            LEFT JOIN player pp ON pp.id = mp.player_id
            LEFT JOIN profile pprof ON pprof.id = mp.player_id
            LEFT JOIN player_reputation prep2 ON prep2.player_id = mp.player_id
            LEFT JOIN effective_rating per ON per.player_id = mp.player_id
            WHERE mp.match_id = m.id
          ), '[]'::jsonb),
          'result', (
            SELECT jsonb_build_object(
              'id', mr.id,
              'winning_team', mr.winning_team,
              'team1_score', mr.team1_score,
              'team2_score', mr.team2_score,
              'is_verified', mr.is_verified,
              'disputed', mr.disputed,
              'submitted_by', mr.submitted_by,
              'confirmation_deadline', mr.confirmation_deadline,
              'confirmed_by', mr.confirmed_by,
              'verified_at', mr.verified_at,
              'created_at', mr.created_at,
              'updated_at', mr.updated_at,
              'rebuttal_team1_score', mr.rebuttal_team1_score,
              'rebuttal_team2_score', mr.rebuttal_team2_score,
              'rebuttal_winning_team', mr.rebuttal_winning_team,
              'rebuttal_sets', mr.rebuttal_sets,
              'rebuttal_submitted_by', mr.rebuttal_submitted_by,
              'rebuttal_submitted_at', mr.rebuttal_submitted_at,
              'rebuttal_deadline', mr.rebuttal_deadline,
              'sets', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'set_number', ms.set_number,
                  'team1_score', ms.team1_score,
                  'team2_score', ms.team2_score
                ) ORDER BY ms.set_number)
                FROM match_set ms WHERE ms.match_result_id = mr.id
              ), '[]'::jsonb),
              'confirmations', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'player_id', sc.player_id,
                  'action', sc.action
                ))
                FROM score_confirmation sc WHERE sc.match_result_id = mr.id
              ), '[]'::jsonb)
            )
            FROM match_result mr WHERE mr.match_id = m.id
            LIMIT 1
          )
        ) AS payload
    FROM top_matches tm
    JOIN match m               ON m.id   = tm.m_id
    LEFT JOIN sport sp         ON sp.id  = m.sport_id
    LEFT JOIN facility f       ON f.id   = m.facility_id
    LEFT JOIN court c          ON c.id   = m.court_id
    LEFT JOIN rating_score mrs ON mrs.id = m.min_rating_score_id
  )

  SELECT mp.score::numeric, mp.payload
  FROM match_payloads mp
  ORDER BY mp.score DESC
  LIMIT p_limit;

END;
$function$;

-- Defensive: keep the anon path off the per-backend JIT compile tax. The query
-- is small (match-only, bounded to p_limit JSONB builds) so JIT likely never
-- triggers, but the anon role has only a 3s statement_timeout and cold pooled
-- backends pay the compile cost up front — see get_just_for_you (jit=off) and
-- the suggestion-rpc-perf project memory. Body unchanged; trivially reversible.
ALTER FUNCTION public.get_nearby_public_matches(
  uuid, double precision, double precision, double precision, text, integer
) SET jit = off;

GRANT EXECUTE ON FUNCTION public.get_nearby_public_matches(
  uuid, double precision, double precision, double precision, text, integer
) TO anon, authenticated;

COMMENT ON FUNCTION public.get_nearby_public_matches(
  uuid, double precision, double precision, double precision, text, integer
) IS
  'Signed-out "Nearby" carousel: top p_limit joinable public matches near a point for a sport, ranked by proximity + urgency + spots-left, returned as full MatchWithDetails JSONB. One round trip; no caller context, no suggestion pool. Anon-callable.';
