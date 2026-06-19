-- Cap web joins at one match per player to push app adoption.
-- One row per (player, match) joined through the web-join flow; the web-join
-- API rejects a player who already has a row for a DIFFERENT match and tells
-- them to use the app.

create table if not exists public.web_join (
  player_id uuid not null references public.player(id) on delete cascade,
  match_id uuid not null references public.match(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_id, match_id)
);

alter table public.web_join enable row level security;
-- Intentionally no RLS policies: only the service_role (the web-join API)
-- reads/writes this table, and service_role bypasses RLS. anon/authenticated
-- get no access at all.

grant select, insert, delete on public.web_join to service_role;

comment on table public.web_join is
  'One row per (player, match) joined via the web-join flow. Used to cap web joins at one per player and drive app adoption.';
