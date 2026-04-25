-- Switch the referral leaderboard to surface "First Last" instead of the
-- legacy display_name handle, matching the rest of the app which now derives
-- player identity from first_name + last_name.

create or replace function public.get_referral_leaderboard(
  p_contest_id uuid,
  p_limit integer default 10
)
returns table (
  referrer_id uuid,
  display_name text,
  avatar_url text,
  referral_count bigint,
  rank bigint
)
language sql
security definer
stable
as $$
  select
    referrer.id                                                                   as referrer_id,
    coalesce(
      nullif(trim(coalesce(referrer.first_name, '') || ' ' || coalesce(referrer.last_name, '')), ''),
      referrer.display_name,
      'Player'
    )                                                                             as display_name,
    referrer.profile_picture_url                                                  as avatar_url,
    count(referred.id)                                                            as referral_count,
    row_number() over (order by count(referred.id) desc)                          as rank
  from public.profile referrer
  join public.profile referred on referred.referred_by = referrer.id
  join public.referral_contest rc on rc.id = p_contest_id
  where
    referred.created_at between rc.start_at and rc.end_at
  group by referrer.id, referrer.first_name, referrer.last_name, referrer.display_name, referrer.profile_picture_url
  order by referral_count desc
  limit p_limit;
$$;

grant execute on function public.get_referral_leaderboard(uuid, integer) to authenticated;
