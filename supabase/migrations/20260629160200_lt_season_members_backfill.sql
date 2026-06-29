-- ============================================================================
-- Leagues — backfill season_members from historical session presence
-- ============================================================================
-- season_members (20260629160000) ships empty, but live seasons already have
-- players who engaged via session_presence. Seed the roster so existing seasons
-- aren't blank: anyone who confirmed or was waitlisted for any session in a
-- season is enrolled in that season.
--
-- 'pending'/'declined' presence is excluded (not engaged). Idempotent via
-- ON CONFLICT DO NOTHING, so re-running is safe.
-- ============================================================================

BEGIN;

INSERT INTO season_members (season_id, user_id, status, enrolled_at)
SELECT DISTINCT ss.season_id, sp.user_id, 'enrolled'::season_member_status, now()
  FROM session_presence sp
  JOIN sessions ss ON ss.id = sp.session_id
 WHERE sp.status IN ('confirmed', 'waitlisted')
ON CONFLICT (season_id, user_id) DO NOTHING;

COMMIT;
