-- App-icon badge: switch from "lifetime unread" to the canonical "unseen" model.
--
-- Most notification apps badge the icon with notifications that arrived since the
-- user last opened the app, and reset to 0 on open. We track that cursor per
-- player as `notifications_seen_at`. The badge number on each push is computed
-- server-side as the count of notifications created after this timestamp; the
-- client advances it (and clears the icon) every time the app is foregrounded.
--
-- Per-item read state (`notification.read_at`, drives the in-app bell/bold rows)
-- stays separate and unchanged.

alter table public.player
  add column if not exists notifications_seen_at timestamptz not null default now();

comment on column public.player.notifications_seen_at is
  'Cursor for the home-screen app-icon badge. Notifications created after this are "unseen" and counted toward the badge. Advanced to now() whenever the user foregrounds the app. Distinct from notification.read_at (per-item read state).';

-- Advance the seen cursor for the calling user. Server time (now()) avoids client
-- clock skew. Called on every app foreground; clears the icon badge.
create or replace function public.mark_notifications_seen()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.player
  set notifications_seen_at = now()
  where id = auth.uid();
$function$;

revoke all on function public.mark_notifications_seen() from public;
grant execute on function public.mark_notifications_seen() to authenticated;
