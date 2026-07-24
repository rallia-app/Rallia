-- Série 1 Facebook-promo click report — the breakdown the admin dashboard can't show.
--
-- The Acquisition (UTM) tab aggregates PostHog `deep_link_opened` by
-- source/medium/campaign only (never utm_content), is consent-gated, and misses
-- most Android clicks (they server-redirect to the Play Store before client JS
-- runs). The Invitations tab counts clicks per tournament but ignores UTM.
-- This reads `referral_link_click` directly: server-logged, all platforms, and
-- it carries the per-group `utm_content` tag — so it answers "which group sent
-- how many clicks, to which level".
--
-- Scope: the tagged links use utm_campaign='serie1' (see the Facebook post copy).
-- Set the group tag on each link via &utm_content=<slug>; an untagged link shows
-- up here as '(no group)'.
--
-- "unique_devices" mirrors the dashboard's dedupe: distinct web_distinct_id, or
-- ip+user_agent when the PostHog id is absent (cookies declined / bots).
--
-- Run against prod (ncewkeoohdkpbcovbppd). Read-only.
--   supabase db query --linked -f scripts/tournaments/serie1-facebook-clicks.sql   (careful: --linked is STAGING)
--   psql "$PROD_DB_URL" -f scripts/tournaments/serie1-facebook-clicks.sql

\set campaign 'serie1'

-- 1) Clicks by group (utm_content) x level (tournament).
with clicks as (
  select
    coalesce(nullif(rlc.utm_content, ''), '(no group)') as grp,
    coalesce(t.name, rlc.target_id)                     as level,
    coalesce(rlc.web_distinct_id,
             rlc.ip_address || '|' || coalesce(rlc.user_agent, '')) as device_key
  from public.referral_link_click rlc
  left join public.tournaments t on t.id::text = rlc.target_id
  where rlc.utm_campaign = :'campaign'
    and rlc.invitation_type = 'tournament'
)
select
  grp                          as group_tag,
  level,
  count(*)                     as clicks,
  count(distinct device_key)   as unique_devices
from clicks
group by grouping sets ((grp, level), (grp), ())
order by grp nulls last, clicks desc;

-- 2) Same campaign, split by platform — because the dashboard under-reports
--    Android and this is where you'll see how much.
select
  case
    when rlc.user_agent ~* 'iphone|ipad|ipod' then 'ios'
    when rlc.user_agent ~* 'android'          then 'android'
    else 'desktop/other'
  end                          as platform,
  coalesce(t.name, rlc.target_id) as level,
  count(*)                     as clicks
from public.referral_link_click rlc
left join public.tournaments t on t.id::text = rlc.target_id
where rlc.utm_campaign = :'campaign'
  and rlc.invitation_type = 'tournament'
group by 1, 2
order by 2, 1;
