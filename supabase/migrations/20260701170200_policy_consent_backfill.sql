-- =============================================================================
-- Versioned policy consent — grandfather backfill
--
-- Existing accounts never went through the accept_policy_consent RPC, so
-- without this backfill every one of them would show up as "pending" on
-- get_pending_policy_consents() the moment this ships. Grandfather every
-- existing profile row in at version 1 for both policy types (the seed
-- version from 20260701170000) so nobody is interrupted — the re-consent
-- gate only fires going forward, on a real policy_versions bump.
--
-- accepted_at is backdated to profile.created_at rather than now() — an
-- honest paper trail (they agreed to whatever was live when they signed up),
-- and avoids a meaningless burst of identical timestamps.
-- =============================================================================

insert into public.player_consent (player_id, policy_type, version, accepted_at)
select id, 'privacy', 1, coalesce(created_at, now())
  from public.profile
on conflict (player_id, policy_type, version) do nothing;

insert into public.player_consent (player_id, policy_type, version, accepted_at)
select id, 'terms', 1, coalesce(created_at, now())
  from public.profile
on conflict (player_id, policy_type, version) do nothing;
