-- "Why invites die" panel data: extend get_auto_invite_funnel with
--   * decline_reasons        — jsonb {reason: count} over declined invites ('unspecified' when null)
--   * median_response_hours  — median (responded_at - created_at) over invites that responded
--   * no_response_expired    — invites that lapsed unanswered (pending + expired_at, per the A1 sweep)
-- Return table changes, so the function is dropped and recreated; callers select named
-- columns via PostgREST, so the additions are backward-compatible.

DROP FUNCTION IF EXISTS public.get_auto_invite_funnel(date, date, int, boolean);

CREATE OR REPLACE FUNCTION public.get_auto_invite_funnel(
  p_start_date   date,
  p_end_date     date,
  p_settle_hours int DEFAULT 48,
  p_is_auto      boolean DEFAULT true   -- true=auto, false=human-created, NULL=all
) RETURNS TABLE (
  sport_id              uuid,
  sport_name            text,
  matches_created       bigint,
  invites_sent          bigint,
  invites_settled       bigint,
  invites_in_flight     bigint,
  responded             bigint,
  accepted              bigint,
  declined              bigint,
  time_suggested        bigint,
  no_response           bigint,
  requests_total        bigint,
  requests_approved     bigint,
  requests_refused      bigint,
  requests_pending      bigint,
  decline_reasons       jsonb,
  median_response_hours numeric,
  no_response_expired   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_settle_before timestamptz := now() - make_interval(hours => GREATEST(p_settle_hours, 0));
BEGIN
  RETURN QUERY
  WITH created AS (
    SELECT m.sport_id, COUNT(*) AS n
    FROM match m
    WHERE (p_is_auto IS NULL OR m.is_auto_generated = p_is_auto)
      AND m.created_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY m.sport_id
  ),
  invited AS (
    SELECT
      m.sport_id,
      mp.status,
      mp.cancellation_reason,
      mp.created_at,
      mp.responded_at,
      mp.expired_at,
      (mp.created_at <= v_settle_before)                                                  AS is_settled,
      (mp.joined_at IS NOT NULL OR mp.status IN ('joined','left','kicked','waitlisted'))  AS is_accepted,
      (mp.status = 'declined')                                                            AS is_declined,
      EXISTS (
        SELECT 1 FROM match_time_suggestion ts
        WHERE ts.match_id = mp.match_id AND ts.suggester_id = mp.player_id
      )                                                                                   AS has_suggestion
    FROM match_participant mp
    INNER JOIN match m ON m.id = mp.match_id
    WHERE (p_is_auto IS NULL OR m.is_auto_generated = p_is_auto)
      AND mp.is_host = false
      AND mp.requested_at IS NULL
      AND mp.status <> 'cancelled'
      AND mp.created_at::date BETWEEN p_start_date AND p_end_date
  ),
  invited_cat AS (
    SELECT
      i.*,
      (NOT i.is_accepted AND i.is_declined)                          AS cat_declined,
      (NOT i.is_accepted AND NOT i.is_declined AND i.has_suggestion) AS cat_suggested
    FROM invited i
  ),
  invited_agg AS (
    SELECT
      sport_id,
      COUNT(*)                                                              AS sent,
      COUNT(*) FILTER (WHERE is_settled)                                    AS settled,
      COUNT(*) FILTER (WHERE is_settled AND (is_accepted OR cat_declined OR cat_suggested)) AS responded,
      COUNT(*) FILTER (WHERE is_settled AND is_accepted)                    AS accepted,
      COUNT(*) FILTER (WHERE is_settled AND cat_declined)                   AS declined,
      COUNT(*) FILTER (WHERE is_settled AND cat_suggested)                  AS time_suggested,
      COUNT(*) FILTER (WHERE status = 'pending' AND expired_at IS NOT NULL) AS no_response_expired,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(epoch FROM (responded_at - created_at)) / 3600.0
      ) FILTER (WHERE responded_at IS NOT NULL)                             AS median_response_hours
    FROM invited_cat
    GROUP BY sport_id
  ),
  reasons AS (
    SELECT sport_id,
           COALESCE(cancellation_reason::text, 'unspecified') AS reason,
           COUNT(*) AS n
    FROM invited_cat
    WHERE cat_declined
    GROUP BY sport_id, COALESCE(cancellation_reason::text, 'unspecified')
  ),
  reasons_agg AS (
    SELECT sport_id, jsonb_object_agg(reason, n) AS decline_reasons
    FROM reasons
    GROUP BY sport_id
  ),
  requests AS (
    SELECT
      m.sport_id,
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE mp.joined_at IS NOT NULL)  AS approved,
      COUNT(*) FILTER (WHERE mp.status = 'refused')     AS refused,
      COUNT(*) FILTER (WHERE mp.status = 'requested')   AS pending
    FROM match_participant mp
    INNER JOIN match m ON m.id = mp.match_id
    WHERE (p_is_auto IS NULL OR m.is_auto_generated = p_is_auto)
      AND mp.requested_at IS NOT NULL
      AND mp.requested_at::date BETWEEN p_start_date AND p_end_date
    GROUP BY m.sport_id
  ),
  sports AS (
    SELECT sport_id FROM created
    UNION SELECT sport_id FROM invited_agg
    UNION SELECT sport_id FROM requests
  )
  SELECT
    sp.sport_id,
    s.display_name::text                                  AS sport_name,
    COALESCE(c.n, 0)::bigint                              AS matches_created,
    COALESCE(ia.sent, 0)::bigint                          AS invites_sent,
    COALESCE(ia.settled, 0)::bigint                       AS invites_settled,
    COALESCE(ia.sent - ia.settled, 0)::bigint             AS invites_in_flight,
    COALESCE(ia.responded, 0)::bigint                     AS responded,
    COALESCE(ia.accepted, 0)::bigint                      AS accepted,
    COALESCE(ia.declined, 0)::bigint                      AS declined,
    COALESCE(ia.time_suggested, 0)::bigint                AS time_suggested,
    COALESCE(ia.settled - ia.responded, 0)::bigint        AS no_response,
    COALESCE(rq.total, 0)::bigint                         AS requests_total,
    COALESCE(rq.approved, 0)::bigint                      AS requests_approved,
    COALESCE(rq.refused, 0)::bigint                       AS requests_refused,
    COALESCE(rq.pending, 0)::bigint                       AS requests_pending,
    COALESCE(ra.decline_reasons, '{}'::jsonb)             AS decline_reasons,
    ROUND(ia.median_response_hours::numeric, 1)           AS median_response_hours,
    COALESCE(ia.no_response_expired, 0)::bigint           AS no_response_expired
  FROM sports sp
  INNER JOIN sport s        ON s.id = sp.sport_id
  LEFT JOIN created c       ON c.sport_id = sp.sport_id
  LEFT JOIN invited_agg ia  ON ia.sport_id = sp.sport_id
  LEFT JOIN reasons_agg ra  ON ra.sport_id = sp.sport_id
  LEFT JOIN requests rq     ON rq.sport_id = sp.sport_id
  ORDER BY s.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auto_invite_funnel(date, date, int, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_auto_invite_funnel IS
  'Per-sport invitation funnel anchored on invite-sent time, for matches of source p_is_auto (true=auto, false=human-created, NULL=all). Adds why-invites-die data: decline_reasons jsonb mix (unspecified when no reason given), median_response_hours over responded invites, and no_response_expired (pending invites lapsed per the A1 expiry sweep).';
