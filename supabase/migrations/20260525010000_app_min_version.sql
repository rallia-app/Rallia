-- =============================================================================
-- app_min_version — per-platform minimum supported app version.
--
-- The mobile app reads this on launch and shows a blocking "Update Required"
-- screen when the installed binary is below `min_supported_version`. This is
-- the escape hatch for retiring old runtime versions: bump the row after
-- shipping a binary with a native dep change, and within a few days the
-- entire install base is on the new runtime — no need to maintain a release
-- branch + EAS channel for the old binary.
--
-- `recommended_version` is reserved for a future soft-nudge banner ("a new
-- version is available") — the schema carries it now so adding the banner
-- later doesn't need another migration.
-- =============================================================================

create table public.app_min_version (
  platform              text primary key check (platform in ('ios', 'android')),
  min_supported_version text not null,
  recommended_version   text,
  store_url             text not null,
  updated_at            timestamptz not null default now()
);

comment on table public.app_min_version is
  'Per-platform minimum supported app version. Read pre-auth at app launch to gate the user behind an "Update Required" screen when their installed binary is below min_supported_version. recommended_version is reserved for a future soft-nudge banner.';

-- Read-only from the Data API — clients fetch this anonymously on cold start.
grant select on public.app_min_version to anon, authenticated;
grant all    on public.app_min_version to service_role;

alter table public.app_min_version enable row level security;

create policy "app_min_version readable to all"
  on public.app_min_version
  for select using (true);

-- Seed with the previous shipping version (1.1.0) so existing users on 1.1.x
-- and the brand-new 1.2.0 build are both supported. To retire an old binary:
-- update min_supported_version directly in the Supabase dashboard (or via a
-- follow-up migration). Bumping it to the latest shipped version forces all
-- users below that version to update.
insert into public.app_min_version (platform, min_supported_version, store_url)
values
  ('ios',     '1.1.0', 'https://apps.apple.com/app/id6760482014'),
  ('android', '1.1.0', 'https://play.google.com/store/apps/details?id=com.mathisl971.ralliaapp');
