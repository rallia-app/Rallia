-- Compatibility "supply vs realized" analytics for the admin dashboard.
--
-- Snapshot RPC computes, per weekly-goal bucket (+ an 'all' row), from CURRENT state:
--   * availability density  — avg # of compatible players free at a player's top-N
--     availability slots (N = weekly objective); the "best playing windows" metric.
--   * hypothetical pool      — # compatible players (same sport, exact rating, shared
--     favorite facility; NO proximity, per the agreed config).
--   * actual realization     — distinct partners actually played with (past, filled,
--     both 'joined') and the share/realization rate of the COMPATIBLE pool.
--
-- A weekly pg_cron job snapshots the 'all'-bucket headline scalars into analytics_snapshot
-- (metric_type='compat_supply') so the trend can be charted. The metric depends on current
-- availability/favorites (no history), so the trend is forward-only — seeded here, accrues weekly.

CREATE OR REPLACE FUNCTION public.get_compat_supply_snapshot()
RETURNS TABLE (
  goal_bucket             text,
  players                 bigint,
  density_mean            numeric,
  density_median          numeric,
  density_p25             numeric,
  density_p75             numeric,
  pct_zero_density        numeric,
  compatible_mean         numeric,
  compatible_median       numeric,
  played_mean             numeric,
  pct_played_any          numeric,
  played_compatible_mean  numeric,
  pct_played_compatible   numeric,
  realization_pct         numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  with prof as (
    select ps.player_id, ps.sport_id, rs.value as rating
    from player_sport ps
    join player_rating_score prs on prs.id = ps.active_rating_score_id
    join rating_score rs on rs.id = prs.rating_score_id
    where ps.is_active
  ),
  avail as (
    select player_id, array_agg(distinct (
      (case day when 'monday' then 0 when 'tuesday' then 1 when 'wednesday' then 2
                when 'thursday' then 3 when 'friday' then 4 when 'saturday' then 5
                when 'sunday' then 6 end) * 24 + hour_of_day)) as slots
    from player_availability where is_active group by player_id
  ),
  prof2 as (select p.*, a.slots from prof p join avail a on a.player_id = p.player_id),
  fav as (select distinct player_id, sport_id, facility_id from player_favorite_facility),
  goals as (
    select distinct on (player_id) player_id, frequency_goal as goal
    from player_weekly_checkin where frequency_goal is not null
    order by player_id, week_start_date desc
  ),
  goal_of as (
    select p.player_id, coalesce(g.goal, 1) as goal
    from (select distinct player_id from prof2) p left join goals g on g.player_id = p.player_id
  ),
  compat as (
    select distinct a.player_id p, b.player_id q
    from prof2 a
    join prof2 b on a.sport_id = b.sport_id and a.player_id <> b.player_id and a.rating = b.rating
    join fav fa on fa.player_id = a.player_id and fa.sport_id = a.sport_id
    join fav fb on fb.player_id = b.player_id and fb.sport_id = a.sport_id and fb.facility_id = fa.facility_id
  ),
  played as (
    select distinct mp1.player_id p, mp2.player_id q
    from match_participant mp1
    join match_participant mp2 on mp2.match_id = mp1.match_id and mp2.player_id <> mp1.player_id and mp2.status = 'joined'
    join match m on m.id = mp1.match_id
    where mp1.status = 'joined' and m.cancelled_at is null and m.match_date < current_date
  ),
  ps as (select player_id, unnest(slots) slot from prof2),
  pair_slots as (
    select c.p, sp.slot
    from compat c
    join ps sp on sp.player_id = c.p
    join ps sq on sq.player_id = c.q and sq.slot = sp.slot
  ),
  slot_overlap as (select p, slot, count(*) cnt from pair_slots group by p, slot),
  ranked as (select p, cnt, row_number() over (partition by p order by cnt desc) rk from slot_overlap),
  topn as (
    select r.p, sum(r.cnt) filter (where r.rk <= g.goal) sum_topn
    from ranked r join goal_of g on g.player_id = r.p group by r.p
  ),
  per_player as (
    select
      coalesce(g.goal::text, 'none') as bucket,
      coalesce(t.sum_topn, 0)::numeric / go.goal as avg_topn,
      (select count(*) from compat c where c.p = e.player_id) as compatible,
      (select count(*) from played pl where pl.p = e.player_id) as played_total,
      (select count(*) from compat c where c.p = e.player_id
         and exists (select 1 from played pl where pl.p = e.player_id and pl.q = c.q)) as played_compat
    from (select distinct player_id from prof2) e
    join goal_of go on go.player_id = e.player_id
    left join goals g on g.player_id = e.player_id
    left join topn t on t.p = e.player_id
  )
  select
    coalesce(bucket, 'all') as goal_bucket,
    count(*)::bigint as players,
    round(avg(avg_topn), 2) as density_mean,
    round(percentile_cont(0.5) within group (order by avg_topn)::numeric, 2) as density_median,
    round(percentile_cont(0.25) within group (order by avg_topn)::numeric, 2) as density_p25,
    round(percentile_cont(0.75) within group (order by avg_topn)::numeric, 2) as density_p75,
    round(100.0 * avg((avg_topn = 0)::int), 1) as pct_zero_density,
    round(avg(compatible), 1) as compatible_mean,
    round(percentile_cont(0.5) within group (order by compatible)::numeric, 1) as compatible_median,
    round(avg(played_total), 2) as played_mean,
    round(100.0 * avg((played_total > 0)::int), 1) as pct_played_any,
    round(avg(played_compat), 2) as played_compatible_mean,
    round(100.0 * avg((played_compat > 0)::int), 1) as pct_played_compatible,
    round(100.0 * sum(played_compat)::numeric / nullif(sum(compatible), 0), 2) as realization_pct
  from per_player
  group by grouping sets ((bucket), ())
  order by goal_bucket;
$$;

GRANT EXECUTE ON FUNCTION public.get_compat_supply_snapshot() TO authenticated;

-- Weekly snapshot writer: store the 'all'-bucket headline scalars for the trend.
CREATE OR REPLACE FUNCTION public.snapshot_compat_supply()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM analytics_snapshot
  WHERE snapshot_date = current_date AND metric_type = 'compat_supply';

  INSERT INTO analytics_snapshot (snapshot_date, sport_id, metric_type, metric_name, metric_value)
  SELECT current_date, null, 'compat_supply', m.name, m.val
  FROM (select * from public.get_compat_supply_snapshot() where goal_bucket = 'all') d
  CROSS JOIN LATERAL (values
    ('density_mean',          d.density_mean),
    ('density_median',        d.density_median),
    ('pct_zero_density',      d.pct_zero_density),
    ('compatible_median',     d.compatible_median),
    ('played_compatible_mean',d.played_compatible_mean),
    ('pct_played_compatible', d.pct_played_compatible),
    ('realization_pct',       d.realization_pct)
  ) m(name, val)
  WHERE m.val IS NOT NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Seed today's point so the trend has a starting value.
SELECT public.snapshot_compat_supply();

-- Weekly schedule (Mondays 06:00 UTC).
SELECT cron.schedule(
  'snapshot-compat-supply-weekly',
  '0 6 * * 1',
  $$ SELECT public.snapshot_compat_supply(); $$
);
