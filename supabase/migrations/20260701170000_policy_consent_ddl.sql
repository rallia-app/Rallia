-- =============================================================================
-- Versioned policy consent — schema
--
-- Two tables:
--   1. policy_versions — current required version per policy_type (privacy,
--      terms). Tiny, admin-managed, public-readable. Bump current_version in
--      the Supabase dashboard when a new Privacy Policy / Terms of Use ships;
--      every signed-in user whose latest player_consent row for that
--      policy_type is below current_version is blocked behind the mobile
--      re-consent gate on next cold launch. Mirrors app_min_version.
--   2. player_consent — append-only acceptance history. One row per
--      (player, policy_type, version); write-only via accept_policy_consent()
--      (RPCs ship in 20260701170100). Anchored on profile(id), not player(id),
--      since profile exists for every account from signup while player rows
--      are created lazily during onboarding.
--
-- Existing accounts are grandfathered at version 1 for both policy types in
-- 20260701170200 — nobody sees the re-consent gate until an admin actually
-- bumps a version.
-- =============================================================================

create table public.policy_versions (
  policy_type     text primary key check (policy_type in ('privacy', 'terms')),
  current_version integer not null default 1 check (current_version > 0),
  updated_at      timestamptz not null default now()
);

comment on table public.policy_versions is
  'Current required version per policy type (privacy, terms). Bump current_version when Rallia publishes an updated Privacy Policy or Terms of Use — every signed-in user whose latest player_consent row for that policy_type is below current_version is blocked behind the mobile re-consent gate on next cold launch.';

grant select on public.policy_versions to anon, authenticated;
grant all on public.policy_versions to service_role;

alter table public.policy_versions enable row level security;

create policy "policy_versions readable to all"
  on public.policy_versions
  for select using (true);

-- No write policy for anon/authenticated — admin bumps happen via the
-- Supabase dashboard or service_role, exactly like app_min_version.

drop trigger if exists update_policy_versions_updated_at on public.policy_versions;
create trigger update_policy_versions_updated_at before update on public.policy_versions
  for each row execute function update_updated_at_column();

insert into public.policy_versions (policy_type, current_version)
values ('privacy', 1), ('terms', 1);


create table public.player_consent (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.profile(id) on delete cascade,
  policy_type text not null check (policy_type in ('privacy', 'terms')),
  version     integer not null check (version > 0),
  accepted_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (player_id, policy_type, version)
);

create index player_consent_player_idx on public.player_consent (player_id, policy_type, accepted_at desc);

comment on table public.player_consent is
  'Append-only history of policy acceptances. One row per (player, policy_type, version) — the unique constraint makes accept_policy_consent idempotent (ON CONFLICT DO NOTHING). Write-only via accept_policy_consent RPC; reads scoped to the caller''s own rows.';

alter table public.player_consent enable row level security;

create policy player_consent_select on public.player_consent
  for select using (player_id = auth.uid() or public.is_admin());

create policy player_consent_no_direct_write on public.player_consent
  for all using (false) with check (false);

grant select on public.player_consent to authenticated, service_role;

drop trigger if exists update_player_consent_updated_at on public.player_consent;
create trigger update_player_consent_updated_at before update on public.player_consent
  for each row execute function update_updated_at_column();
