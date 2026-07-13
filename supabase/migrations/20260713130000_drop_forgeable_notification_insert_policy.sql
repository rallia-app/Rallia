-- Drop the forgeable authenticated INSERT policy on `notification`.
--
-- The policy "Authenticated users can create notifications" was WITH CHECK (true),
-- letting any authenticated client insert a notification row with an arbitrary
-- user_id/title/body. Every notification INSERT fires notify_send_notification()
-- (push fan-out), so this was a push-spam / impersonation vector.
--
-- Safe to remove: no client code inserts into `notification` directly. All
-- legitimate writes go through SECURITY DEFINER paths that bypass RLS:
--   - insert_notification / insert_notifications RPCs (SECURITY DEFINER)
--   - notify_* trigger functions (all SECURITY DEFINER)
--   - service_role edge functions (covered by the retained
--     "Service role can manage all notifications" policy)
-- With this policy gone, authenticated users can no longer forge direct inserts,
-- while every real producer path is unaffected.

DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notification;
