-- Notification delivery observability
--
-- Provides a rolling 24h summary of delivery_attempt rows grouped by
-- (notification_type, channel, status). Read by the admin dashboard and
-- by humans investigating a regression.

CREATE OR REPLACE VIEW public.delivery_attempt_24h_summary
WITH (security_invoker = true) AS
SELECT
  n.type AS notification_type,
  da.channel,
  da.status,
  count(*)::bigint AS attempt_count,
  max(da.created_at) AS last_attempt_at
FROM public.delivery_attempt da
JOIN public.notification n ON n.id = da.notification_id
WHERE da.created_at >= now() - interval '24 hours'
GROUP BY n.type, da.channel, da.status;

COMMENT ON VIEW public.delivery_attempt_24h_summary IS
  'Rolling 24-hour summary of notification delivery attempts. Use to detect spikes in failed/skipped channels per notification type.';

-- Restrict read access to authenticated/service_role; security_invoker means
-- callers must already have RLS-allowed access to the underlying tables.
GRANT SELECT ON public.delivery_attempt_24h_summary TO authenticated, service_role;
