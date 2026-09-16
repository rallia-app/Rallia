-- App Store / Play Store ratings outreach: the Track B audience.
-- See app-store-ratings.md §6. Behaviour-only segmentation, never sentiment
-- (Apple 5.6.1, Google Play In-App Review policy). Read-only; run on prod.
--
-- Mirrors get_broadcast_recipients' consent and deliverability rules so the
-- list is the same one the admin broadcast tool would produce, then adds the
-- behavioural bar and the anti-interruption rules.
--
-- Deliberately NOT applied: the in-app prompt's "cancelled game in the last
-- 14 days" rule. On 2026-09-16 it removed 56 of 99 qualified players, because
-- it matches any cancelled game whose date is in the window, including future
-- ones and games cancelled by someone else. Good for a native dialog that
-- interrupts, too blunt for one email.
SELECT
  p.id                                        AS user_id,
  p.email,
  p.first_name,
  COALESCE(p.preferred_locale::text, 'en-US') AS preferred_locale,
  played.n                                    AS games_played,
  p.last_active_at
FROM public.profile p
JOIN LATERAL (
  SELECT count(*) AS n
  FROM public.match_participant mp
  WHERE mp.player_id = p.id AND mp.match_outcome = 'played'
) played ON TRUE
WHERE p.onboarding_completed = TRUE
  AND p.email IS NOT NULL
  AND p.email_status = 'ok'
  AND (p.account_status IS NULL OR p.account_status = 'active')
  -- Behavioural bar: 5+ games that actually happened, active in the last 60 days.
  AND played.n >= 5
  AND p.last_active_at >= now() - interval '60 days'
  -- Consent: same opt-out the broadcast tool honours.
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_preference np
    WHERE np.user_id = p.id
      AND np.notification_type = 'admin_broadcast'
      AND np.channel = 'email'
      AND np.enabled = FALSE
  )
  -- Anti-interruption (time-bound delays, never permanent exclusions):
  -- an open bug report,
  AND NOT EXISTS (
    SELECT 1 FROM public.feedback f
    WHERE f.player_id = p.id
      AND f.category = 'bug'
      AND f.status IN ('new', 'reviewed', 'in_progress')
  )
  -- a no-show or mutual cancel on their side in the last 14 days,
  AND NOT EXISTS (
    SELECT 1
    FROM public.match_participant mp
    JOIN public.match m ON m.id = mp.match_id
    WHERE mp.player_id = p.id
      AND m.match_date >= current_date - 14
      AND (mp.match_outcome IN ('mutual_cancel', 'opponent_no_show') OR mp.showed_up IS FALSE)
  )
  -- a ban.
  AND NOT EXISTS (SELECT 1 FROM public.player_ban b WHERE b.player_id = p.id)
ORDER BY preferred_locale, played.n DESC;
