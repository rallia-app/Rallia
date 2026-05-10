-- ============================================================================
-- Seed UTM attribution data for the admin Acquisition tab.
-- Local dev only — DO NOT run against production.
--
-- Tags 12 of the existing `a1000000-*` fake profiles with UTM tuples drawn
-- from the canonical vocabulary in packages/shared-utils/src/utm/vocabulary.ts,
-- and backdates `created_at` so each preset window (24h / 7d / 30d / 90d)
-- shows different counts.
--
-- Existing matches owned by these profiles already exist (~9 each), so
-- `matches_created` lights up automatically. `match_result` rows likewise
-- drive `matches_played`.
--
-- Re-running is safe: this is an idempotent UPDATE keyed by profile id.
-- The first-touch invariant of `set_profile_utm` does NOT apply here —
-- this script writes columns directly so it can also be used to *change*
-- the seed UTM mix during testing.
-- ============================================================================

BEGIN;

-- 24h cohort (3 profiles, 3 different campaigns)
UPDATE profile
   SET utm_source   = 'instagram',
       utm_medium   = 'social',
       utm_campaign = 'friends_family_2026',
       utm_content  = 'story_swipeup',
       created_at   = now() - INTERVAL '4 hours'
 WHERE id = 'a1000000-0000-0000-0000-000000000001';

UPDATE profile
   SET utm_source   = 'whatsapp',
       utm_medium   = 'referral',
       utm_campaign = 'friends_family_2026',
       utm_content  = NULL,
       created_at   = now() - INTERVAL '12 hours'
 WHERE id = 'a1000000-0000-0000-0000-000000000002';

UPDATE profile
   SET utm_source   = 'instagram',
       utm_medium   = 'social',
       utm_campaign = 'pickleball_launch_2026_q2',
       utm_content  = 'bio_link',
       created_at   = now() - INTERVAL '20 hours'
 WHERE id = 'a1000000-0000-0000-0000-000000000003';

-- 7d cohort (4 profiles)
UPDATE profile
   SET utm_source   = 'newsletter',
       utm_medium   = 'email',
       utm_campaign = 'february_2026_digest',
       utm_content  = 'header_cta',
       created_at   = now() - INTERVAL '2 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000004';

UPDATE profile
   SET utm_source   = 'tiktok',
       utm_medium   = 'social',
       utm_campaign = 'friends_family_2026',
       utm_content  = 'reel_v1',
       created_at   = now() - INTERVAL '3 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000005';

UPDATE profile
   SET utm_source   = 'meta_ads',
       utm_medium   = 'paid_social',
       utm_campaign = 'always_on_2026',
       utm_content  = 'video_v3',
       created_at   = now() - INTERVAL '5 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000006';

UPDATE profile
   SET utm_source   = 'app_share',
       utm_medium   = 'in_app',
       utm_campaign = 'friends_family_2026',
       utm_content  = NULL,
       created_at   = now() - INTERVAL '6 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000007';

-- 30d cohort (3 profiles)
UPDATE profile
   SET utm_source   = 'partner',
       utm_medium   = 'qr',
       utm_campaign = 'tennis_canada_2026',
       utm_content  = 'flyer_v1',
       created_at   = now() - INTERVAL '12 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000008';

UPDATE profile
   SET utm_source   = 'google_ads',
       utm_medium   = 'cpc',
       utm_campaign = 'always_on_2026',
       utm_content  = NULL,
       created_at   = now() - INTERVAL '18 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000009';

UPDATE profile
   SET utm_source   = 'reddit',
       utm_medium   = 'organic',
       utm_campaign = 'pickleball_launch_2026_q2',
       utm_content  = NULL,
       created_at   = now() - INTERVAL '25 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000010';

-- 90d cohort (2 profiles, lower-volume legacy campaigns)
UPDATE profile
   SET utm_source   = 'event',
       utm_medium   = 'qr',
       utm_campaign = 'pop_up_2026',
       utm_content  = 'booth_qr',
       created_at   = now() - INTERVAL '45 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000011';

UPDATE profile
   SET utm_source   = 'blog',
       utm_medium   = 'organic',
       utm_campaign = 'always_on_2026',
       utm_content  = NULL,
       created_at   = now() - INTERVAL '70 days'
 WHERE id = 'a1000000-0000-0000-0000-000000000012';

-- Backdate a few matches per UTM-tagged profile so `matches_created` and
-- `matches_played` light up across the windows. Picks the 2 oldest matches
-- per cohort profile (deterministic) and shifts both the match row and any
-- linked match_result row to a date that aligns with the profile's signup.
WITH ranked AS (
  SELECT
    m.id AS match_id,
    p.id AS profile_id,
    p.created_at AS signup_at,
    ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY m.created_at) AS rn
  FROM profile p
  JOIN match m ON m.created_by = p.id
  WHERE p.id::text LIKE 'a1000000%'
    AND p.utm_source IS NOT NULL
),
picked AS (
  SELECT match_id, profile_id, signup_at, rn
  FROM ranked
  WHERE rn <= 2  -- 2 matches per cohort profile = 24 matches total
)
UPDATE match m
   SET created_at = p.signup_at + INTERVAL '1 hour' * p.rn
  FROM picked p
 WHERE m.id = p.match_id;

-- Same windowing for match_result so matches_played reflects the cohort.
WITH ranked AS (
  SELECT
    m.id AS match_id,
    p.id AS profile_id,
    p.created_at AS signup_at,
    ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY m.created_at) AS rn
  FROM profile p
  JOIN match m ON m.created_by = p.id
  WHERE p.id::text LIKE 'a1000000%'
    AND p.utm_source IS NOT NULL
),
picked AS (
  SELECT match_id, signup_at, rn
  FROM ranked
  WHERE rn <= 2
)
UPDATE match_result mr
   SET created_at = p.signup_at + INTERVAL '2 hours' * p.rn
  FROM picked p
 WHERE mr.match_id = p.match_id;

-- ----------------------------------------------------------------------------
-- Backdate existing invitation/referral data into the past 7 days so the
-- Invitations & Referrals section on /admin/analytics/acquisition isn't
-- empty at the default time window. Spread evenly across hours of the past
-- week so the headline timeseries chart has shape, not a single spike.
-- Idempotent: row_number() % windowSize is deterministic per (table, ordering).
-- ----------------------------------------------------------------------------

WITH renumbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at) AS rn,
         COUNT(*) OVER () AS total
  FROM public.referral_link_click
)
UPDATE public.referral_link_click rlc
   SET created_at = now() - (
         (r.rn::numeric / GREATEST(r.total, 1)) * INTERVAL '7 days'
       )
  FROM renumbered r
 WHERE rlc.id = r.id;

WITH renumbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at) AS rn,
         COUNT(*) OVER () AS total
  FROM public.referral_fingerprint
)
UPDATE public.referral_fingerprint rf
   SET created_at = now() - (
         (r.rn::numeric / GREATEST(r.total, 1)) * INTERVAL '7 days'
       )
  FROM renumbered r
 WHERE rf.id = r.id;

COMMIT;

-- Sanity check
SELECT
  COALESCE(utm_campaign, '(none)') AS campaign,
  COALESCE(utm_source, '(none)')   AS source,
  COUNT(*)                         AS signups,
  date_trunc('day', MIN(created_at))::date AS earliest
FROM profile
WHERE utm_source IS NOT NULL
GROUP BY campaign, source
ORDER BY signups DESC, campaign;
