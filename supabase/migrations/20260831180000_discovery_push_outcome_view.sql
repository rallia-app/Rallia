-- =============================================================================
-- Discovery push outcome: attribute pushes to joins, not opens
--
-- read_at is a bad proxy. new_message rows are marked read within 2 seconds of
-- creation, and for nearby pushes the open rate moved opposite to the outcome
-- we actually care about: opens fell 20.4% -> 12.3% June to August while the
-- join rate rose 0.21% -> 0.91% over the same period.
--
-- No schema change is needed to measure this. A discovery push targets a player
-- who is NOT yet a participant on that match, so any match_participant row for
-- (target_id, user_id) created after the push is attributable to it. This does
-- NOT hold for match_invitation, where the pending row is written before the
-- notification, so that type is deliberately excluded.
--
-- Attribution is correlational: a player could have found the game by browsing.
-- It is still a far better signal than read_at, and it is the baseline for
-- tuning the discovery budget.
--
-- service_role only: the view spans all users' notifications and is for admin
-- analytics, not client reads.
-- =============================================================================

CREATE OR REPLACE VIEW public.discovery_push_outcome
WITH (security_invoker = on) AS
SELECT
  n.id                        AS notification_id,
  n.user_id,
  n.type                      AS push_type,
  n.target_id                 AS match_id,
  n.created_at                AS pushed_at,
  (n.read_at IS NOT NULL)     AS opened,
  mp.status                   AS participant_status,
  COALESCE(mp.joined_at, mp.requested_at, mp.created_at) AS acted_at,
  (mp.id IS NOT NULL)         AS converted
FROM public.notification n
LEFT JOIN public.match_participant mp
       ON mp.match_id  = n.target_id
      AND mp.player_id = n.user_id
      AND mp.status IN ('joined', 'requested')
      AND COALESCE(mp.joined_at, mp.requested_at, mp.created_at) > n.created_at
WHERE n.type IN ('nearby_match_available', 'match_last_minute_spots');

COMMENT ON VIEW public.discovery_push_outcome IS
  'One row per discovery push with whether the recipient then joined or requested that match. Excludes match_invitation, whose participant row predates the push. Correlational, not causal.';

REVOKE ALL ON public.discovery_push_outcome FROM PUBLIC;
REVOKE ALL ON public.discovery_push_outcome FROM anon;
REVOKE ALL ON public.discovery_push_outcome FROM authenticated;
GRANT SELECT ON public.discovery_push_outcome TO service_role;
