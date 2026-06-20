-- ===========================================================================
-- Player compatibility graph — source-of-truth SQL (prototype)
-- ===========================================================================
-- Returns each player's degree (# of compatible partners). Visualized by the
-- Python prototype; ports to a dashboard RPC.
--
-- CONFIG (updated 2026-06-09 — no proximity factor):
--   1. Same sport         -> shared active player_sport.sport_id
--   2. Rating             -> rating_a = rating_b   (EXACT match — no band)
--   3. Shared facility    -> both players favorite the SAME facility for that sport
--                            (player_favorite_facility). NO distance/proximity gate —
--                            distance is intentionally ignored.
--   4. Availability       -> count of shared (day, hour) slots >= N, where
--                            N = GREATEST(goal_a, goal_b) — the larger of the two
--                            players' weekly playing objectives
--                            (player_weekly_checkin.frequency_goal, latest per player;
--                            players with no stated goal default to 1).
--
-- "Matchable" denominator = active sport WITH a rating AND >=1 availability slot.
-- (No location needed — proximity dropped.) Players with no favorite facility, or
-- without enough overlapping availability for the pair's objective, surface at degree 0.
-- ===========================================================================

with prof as (
  select ps.player_id, ps.sport_id, rs.value as rating, coalesce(pl.city, 'Unknown') as city
  from player_sport ps
  join player_rating_score prs on prs.id = ps.active_rating_score_id
  join rating_score rs        on rs.id  = prs.rating_score_id
  join player pl              on pl.id  = ps.player_id
  where ps.is_active = true
),
avail as (
  select player_id,
    array_agg(distinct (
      (case day when 'monday' then 0 when 'tuesday' then 1 when 'wednesday' then 2
                when 'thursday' then 3 when 'friday' then 4 when 'saturday' then 5
                when 'sunday' then 6 end) * 24 + hour_of_day)) as slots
  from player_availability
  where is_active = true
  group by player_id
),
prof2 as (select p.*, a.slots from prof p join avail a on a.player_id = p.player_id),
fav as (select distinct player_id, sport_id, facility_id from player_favorite_facility),
-- Latest stated weekly objective per player; default 1 when never set.
goals as (
  select distinct on (player_id) player_id, frequency_goal as goal
  from player_weekly_checkin
  where frequency_goal is not null
  order by player_id, week_start_date desc
),
goal_of as (
  select p.player_id, coalesce(g.goal, 1) as goal
  from (select distinct player_id from prof2) p
  left join goals g on g.player_id = p.player_id
),
elig as (select distinct player_id, city from prof2),
pairs as (
  select distinct a.player_id as p1, b.player_id as p2
  from prof2 a
  join prof2 b on a.sport_id = b.sport_id and a.player_id < b.player_id
              and a.rating = b.rating                                        -- EXACT rating
  join fav fa on fa.player_id = a.player_id and fa.sport_id = a.sport_id
  join fav fb on fb.player_id = b.player_id and fb.sport_id = a.sport_id
             and fb.facility_id = fa.facility_id                             -- shared favorite facility (no distance)
  join goal_of ga on ga.player_id = a.player_id
  join goal_of gb on gb.player_id = b.player_id
  where cardinality(array(select unnest(a.slots) intersect select unnest(b.slots)))
        >= greatest(ga.goal, gb.goal)                                        -- >= N overlapping slots
),
deg_raw as (select p1 as pid from pairs union all select p2 from pairs),
deg as (
  select e.player_id as pid, e.city, coalesce(count(d.pid), 0) as degree
  from elig e
  left join deg_raw d on d.pid = e.player_id
  group by e.player_id, e.city
)
select d.pid, d.degree, d.city,
       (select string_agg(distinct s.display_name, '+')
        from prof2 pp join sport s on s.id = pp.sport_id
        where pp.player_id = d.pid) as sports
from deg d
order by d.degree;
