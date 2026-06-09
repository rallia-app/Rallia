-- Generalize get_auto_invite_funnel to either match source so the admin Matches tab
-- can render the SAME invitation funnel for human-created matches, not just
-- auto-generated ones. Adds p_is_auto: true = auto (current behaviour, default),
-- false = human-created, NULL = all. Everything else is unchanged.
--
-- The signature changes (extra arg), so we drop the old 3-arg function first to
-- avoid an ambiguous overload for existing 3-named-arg PostgREST calls.

DROP FUNCTION IF EXISTS public.get_auto_invite_funnel(date, date, int);

CREATE OR REPLACE FUNCTION public.get_auto_invite_funnel(
  p_start_date   date,
  p_end_date     date,
  p_settle_hours int DEFAULT 48,
  p_is_auto      boolean DEFAULT true   -- true=auto, false=human-created, NULL=all
) RETURNS TABLE (
  sport_id          uuid,
  sport_name        text,
  matches_created   bigint,
  invites_sent      bigint,
  invites_settled   bigint,
  invites_in_flight bigint,
  responded         bigint,
  accepted          bigint,
  declined          bigint,
  time_suggested    bigint,
  no_response       bigint,
  requests_total    bigint,
  requests_approved bigint,
  requests_refused  bigint,
  requests_pending  bigint
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
      i.sport_id,
      i.is_settled,
      i.is_accepted,
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
      COUNT(*) FILTER (WHERE is_settled AND cat_suggested)                  AS time_suggested
    FROM invited_cat
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
    COALESCE(rq.pending, 0)::bigint                       AS requests_pending
  FROM sports sp
  INNER JOIN sport s        ON s.id = sp.sport_id
  LEFT JOIN created c       ON c.sport_id = sp.sport_id
  LEFT JOIN invited_agg ia  ON ia.sport_id = sp.sport_id
  LEFT JOIN requests rq     ON rq.sport_id = sp.sport_id
  ORDER BY s.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auto_invite_funnel(date, date, int, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_auto_invite_funnel IS
  'Per-sport invitation funnel anchored on invite-sent time, for matches of source p_is_auto (true=auto, false=human-created, NULL=all). Invited candidates flow created -> sent -> settled -> responded -> oui/non/nouvel horaire (precedence oui > non > nouvel horaire). Rates over the settled cohort (invites older than p_settle_hours); younger invites are in_flight. Self-requesters (requested_at set) tracked separately as the request-to-join approval flow.';
