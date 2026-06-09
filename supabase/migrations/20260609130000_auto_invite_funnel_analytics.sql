-- Migration: "Génération auto" invitation funnel analytics.
-- Powers the auto-generated-match invitation funnel in the admin Matches tab:
--   matches created -> invitations sent -> responded -> (oui / non / nouvel horaire)
-- plus the self-request approval flow (request-to-join -> approved / refused).
--
-- Two distinct populations live on an auto-generated match and must NOT be chained
-- into one funnel:
--   * invited candidates  -> match_participant rows auto-inserted at status 'pending'
--   * self-requesters      -> rows created at status 'requested' (join_mode='request')
-- We disambiguate them with a new requested_at timestamp (stamped by trigger), so the
-- invitation funnel (invited candidates) excludes self-requesters, and vice versa.

-- 1. requested_at: when a player self-requested to join. Lets us separate the
--    self-request approval flow from auto-invite accepts (both can end at 'joined').
ALTER TABLE public.match_participant
  ADD COLUMN IF NOT EXISTS requested_at timestamptz;

COMMENT ON COLUMN public.match_participant.requested_at IS
  'Timestamp a player self-requested to join (status -> requested). NULL for host-invited candidates. Stamped by trigger trg_match_participant_requested_at.';

-- Best-effort backfill: rows currently in a self-request state get created_at as the
-- request time (their row was created at request time). Historical self-requesters that
-- were already approved (now joined) cannot be recovered and stay NULL.
UPDATE public.match_participant
SET requested_at = created_at
WHERE status IN ('requested', 'refused')
  AND requested_at IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_match_participant_requested_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.requested_at IS NULL THEN
    NEW.requested_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_participant_requested_at ON public.match_participant;
CREATE TRIGGER trg_match_participant_requested_at
  BEFORE INSERT OR UPDATE OF status ON public.match_participant
  FOR EACH ROW
  WHEN (NEW.status = 'requested')
  EXECUTE FUNCTION public.stamp_match_participant_requested_at();

CREATE INDEX IF NOT EXISTS idx_match_participant_requested_at
  ON public.match_participant (requested_at)
  WHERE requested_at IS NOT NULL;

-- 2. Funnel RPC. Cohorts are anchored on send/request time (not play date). Response
--    rates are measured over the SETTLED cohort only — invitations younger than
--    p_settle_hours haven't had a fair chance to convert (right-censoring), so they are
--    reported as in-flight and excluded from the rate denominators.
CREATE OR REPLACE FUNCTION public.get_auto_invite_funnel(
  p_start_date   date,
  p_end_date     date,
  p_settle_hours int DEFAULT 48
) RETURNS TABLE (
  sport_id          uuid,
  sport_name        text,
  -- Fan-out head (auto matches created in window, anchored on creation)
  matches_created   bigint,
  -- Invitation funnel (invited candidates only; self-requesters & voided invites excluded)
  invites_sent      bigint,
  invites_settled   bigint,
  invites_in_flight bigint,
  responded         bigint,
  accepted          bigint,   -- oui
  declined          bigint,   -- non
  time_suggested    bigint,   -- nouvel horaire
  no_response       bigint,
  -- Self-request approval flow (separate population)
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
    WHERE m.is_auto_generated = true
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
    WHERE m.is_auto_generated = true
      AND mp.is_host = false
      AND mp.requested_at IS NULL          -- exclude self-requesters
      AND mp.status <> 'cancelled'         -- exclude invites voided by match cancellation
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
    WHERE m.is_auto_generated = true
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

GRANT EXECUTE ON FUNCTION public.get_auto_invite_funnel(date, date, int) TO authenticated;

COMMENT ON FUNCTION public.get_auto_invite_funnel IS
  'Per-sport auto-generation invitation funnel anchored on invite-sent time. Invited candidates (host-invited, status pending->joined/declined/etc.) flow created -> sent -> settled -> responded -> oui/non/nouvel horaire, with response categories under precedence oui > non > nouvel horaire. Rates measured over the settled cohort (invites older than p_settle_hours); younger invites are reported as in_flight. Self-requesters (requested_at set) are tracked separately as the request-to-join approval flow. Historical self-requesters approved before requested_at existed may be undercounted.';
