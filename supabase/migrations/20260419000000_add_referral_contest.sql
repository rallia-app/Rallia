-- Referral contest table: defines a time-limited leaderboard campaign
create table public.referral_contest (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prize_description text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  max_winners integer not null default 3,
  is_active boolean not null default true,
  created_at timestamptz default now() not null
);

alter table public.referral_contest enable row level security;

-- Authenticated users can read active contests
create policy "Authenticated users can view active contests"
  on public.referral_contest
  for select
  to authenticated
  using (is_active = true);

-- ============================================================================
-- RPC: get_referral_leaderboard
-- Returns top referrers for a contest window ordered by conversion count.
-- ============================================================================
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
    referrer.id                                                   as referrer_id,
    coalesce(referrer.display_name, 'Player')                    as display_name,
    referrer.profile_picture_url                                  as avatar_url,
    count(referred.id)                                            as referral_count,
    row_number() over (order by count(referred.id) desc)          as rank
  from public.profile referrer
  join public.profile referred on referred.referred_by = referrer.id
  join public.referral_contest rc on rc.id = p_contest_id
  where
    referred.created_at between rc.start_at and rc.end_at
  group by referrer.id, referrer.display_name, referrer.profile_picture_url
  order by referral_count desc
  limit p_limit;
$$;

grant execute on function public.get_referral_leaderboard(uuid, integer) to authenticated;

-- ============================================================================
-- RPC: get_my_contest_rank
-- Returns the calling player's rank, conversion count, and total participants.
-- ============================================================================
create or replace function public.get_my_contest_rank(
  p_contest_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
stable
as $$
declare
  v_rank          bigint;
  v_count         bigint;
  v_total         bigint;
begin
  with ranked as (
    select
      referrer.id                                          as referrer_id,
      count(referred.id)                                   as referral_count,
      row_number() over (order by count(referred.id) desc) as rank
    from public.profile referrer
    join public.profile referred on referred.referred_by = referrer.id
    join public.referral_contest rc on rc.id = p_contest_id
    where referred.created_at between rc.start_at and rc.end_at
    group by referrer.id
  )
  select
    coalesce((select rank          from ranked where referrer_id = p_player_id), 0),
    coalesce((select referral_count from ranked where referrer_id = p_player_id), 0),
    count(*)
  into v_rank, v_count, v_total
  from ranked;

  return jsonb_build_object(
    'rank',               v_rank,
    'referral_count',     v_count,
    'total_participants', v_total
  );
end;
$$;

grant execute on function public.get_my_contest_rank(uuid, uuid) to authenticated;
