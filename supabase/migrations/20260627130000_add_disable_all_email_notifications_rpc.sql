-- One-click email unsubscribe support for transactional notification emails.
--
-- Transactional emails (match_invitation, feedback_request, etc.) previously had
-- no working unsubscribe affordance: the footer link pointed at a non-existent
-- consumer settings page and there was no List-Unsubscribe header. The new
-- /api/notifications/unsubscribe route calls this function to disable the email
-- channel for every notification type at once (a true "stop emailing me").
--
-- Enumerating notification_type_enum from pg_enum keeps this drift-proof: any
-- type added to the enum later is covered automatically.
create or replace function public.disable_all_email_notifications(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_preference (user_id, notification_type, channel, enabled)
  select p_user_id, e.enumlabel::notification_type_enum, 'email'::delivery_channel_enum, false
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'notification_type_enum'
  on conflict (user_id, notification_type, channel)
  do update set enabled = false, updated_at = now();
end;
$$;

-- Invoked by the web unsubscribe route with the service role key.
grant execute on function public.disable_all_email_notifications(uuid) to service_role;
