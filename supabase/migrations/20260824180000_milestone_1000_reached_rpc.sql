-- The 1000-user milestone takeover fires when the community actually crosses
-- 1000 signups, counted on PROFILE rows (every signup, onboarding drop-offs
-- included) rather than player rows — decided 2026-08-24. The client polls
-- this at launch while the campaign is pending, so it must stay cheap and
-- expose nothing but the crossed/not-crossed bit.

create or replace function public.milestone_1000_reached()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select count(*) >= 1000 from public.profile $$;

comment on function public.milestone_1000_reached() is
  'True once total profile rows reach 1000. Trigger for the one-time milestone takeover (features/milestone); campaign end date lives client-side.';

revoke all on function public.milestone_1000_reached() from public, anon;
grant execute on function public.milestone_1000_reached() to authenticated, service_role;
