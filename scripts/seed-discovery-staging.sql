-- ============================================================================
-- Seed staging so the discovery notification changes can actually be exercised
--
-- Target: rallia-staging (ahbaeewecdeguxtxtvhr)
--
-- Staging currently has 1 future match, 0 matches in the 2-6 hour window and 0
-- live pending invites, so send_last_minute_spot_pushes and
-- send_pending_invite_reminders both return 0 forever and prove nothing. This
-- seeds the three fixtures that make them fire.
--
-- Covers, in order of the shipped commits:
--   9b834f59  send_last_minute_spot_pushes own budget (was starved to 0 sends)
--   0e627f97  ranked allocation capped at 15, host-location fallback
--   f7134033  send_pending_invite_reminders
--
-- SAFETY: this fixture FIRES REAL PUSHES. Every recipient must be in the
-- @fake-rallia.com pool. The anchor below was chosen because it has 20 fake
-- tennis 3.5 players within notification range and ZERO real players. The DO
-- block re-asserts that before inserting anything, so if staging data shifts
-- the script aborts rather than paging a human.
--
-- Idempotent: prior runs are CANCELLED (not deleted) and their notifications
-- removed. Cancelling is enough, every sweep excludes cancelled_at IS NOT NULL,
-- and it avoids the conversation FK RESTRICT that deleting a match hits.
--
-- Run:  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/seed-discovery-staging.sql
--   or  paste the body into Supabase MCP execute_sql against ahbaeewecdeguxtxtvhr.
--
-- After running, wait for the next quarter-hour tick (last-minute at 7,22,37,52
-- and the invite reminder at 12,27,42,57) or call the functions directly:
--   SELECT public.send_last_minute_spot_pushes();
--   SELECT public.send_pending_invite_reminders();
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Clear prior runs
-- ----------------------------------------------------------------------------
DELETE FROM notification
 WHERE target_id IN (SELECT id FROM match WHERE notes LIKE '[SEED] discovery%');

UPDATE match SET cancelled_at = now()
 WHERE notes LIKE '[SEED] discovery%' AND cancelled_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Seed the fixtures
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    c_anchor    constant uuid := 'a1000000-0000-0000-0000-000000000080';
    c_rating    constant uuid := 'cc285cba-dde6-4b46-b922-fdef32b2d194';  -- tennis 3.5
    v_sport     uuid;
    v_anchor    extensions.geography;
    v_lat       numeric;
    v_lng       numeric;
    v_host      uuid;
    v_invitee   uuid;
    v_pool      int;
    v_real      int;
    v_start     timestamp;
    v_match_lm  uuid := gen_random_uuid();
    v_match_inv uuid := gen_random_uuid();
    v_fanout    int;
BEGIN
    SELECT rsys.sport_id INTO v_sport
      FROM rating_score rs JOIN rating_system rsys ON rsys.id = rs.rating_system_id
     WHERE rs.id = c_rating;
    ASSERT v_sport IS NOT NULL, 'rating score is not wired to a sport';

    -- momentum_notification_gate is a BEFORE INSERT trigger on notification that
    -- RETURNs NULL for match_last_minute_spots when the flag is off, dropping the
    -- row with no error. This is the real reason the lane had never sent: the flag
    -- ships disabled on both staging and prod, independent of the budget fix in
    -- 9b834f59. Without it on, this fixture produces nothing and looks like a bug.
    ASSERT (SELECT COALESCE((value->>'enabled')::boolean, true)
              FROM admin_settings WHERE key = 'momentum_match_last_minute_spots'),
      'momentum_match_last_minute_spots is disabled; the last-minute lane will silently drop every push. Enable it before seeding: UPDATE admin_settings SET value = jsonb_set(value, ''{enabled}'', ''true'') WHERE key = ''momentum_match_last_minute_spots'';';

    SELECT location, latitude, longitude INTO v_anchor, v_lat, v_lng
      FROM player WHERE id = c_anchor;
    ASSERT v_anchor IS NOT NULL,
      'anchor player has no location; re-pick the anchor';

    -- Eligible pool at this anchor and rating, split fake vs real.
    SELECT
      count(*) FILTER (WHERE pr.email ILIKE '%@fake-rallia.com'),
      count(*) FILTER (WHERE pr.email NOT ILIKE '%@fake-rallia.com')
      INTO v_pool, v_real
      FROM player p
      JOIN profile pr ON pr.id = p.id
      JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = v_sport AND ps.is_active
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE prs.rating_score_id = c_rating
       AND p.location IS NOT NULL
       AND extensions.ST_DWithin(p.location, v_anchor,
             LEAST(COALESCE(p.max_travel_distance, 5), 5) * 1000);

    -- Hard stop: never page a real staging user with a fixture.
    ASSERT v_real = 0,
      format('%s REAL players are in range of this anchor; re-pick the anchor before seeding', v_real);
    ASSERT v_pool >= 17,
      format('need 17+ fake candidates to exercise the cap of 15 plus a host and an invitee, got %s', v_pool);

    -- Fixture B carries no coordinates, so its match point is the HOST's home
    -- location, not the anchor. Validating only the anchor is not enough: on the
    -- first run of this script that gap notified a real account 3.5 km from the
    -- host. Pick a host whose OWN location also has zero real players in reach.
    SELECT p.id INTO v_host
      FROM player p JOIN profile pr ON pr.id = p.id
      JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = v_sport AND ps.is_active
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE prs.rating_score_id = c_rating
       AND pr.email ILIKE '%@fake-rallia.com'
       AND extensions.ST_DWithin(p.location, v_anchor,
             LEAST(COALESCE(p.max_travel_distance, 5), 5) * 1000)
       AND NOT EXISTS (
         SELECT 1 FROM player r JOIN profile rp ON rp.id = r.id
          WHERE rp.email NOT ILIKE '%@fake-rallia.com'
            AND r.location IS NOT NULL
            AND extensions.ST_DWithin(r.location, p.location,
                  LEAST(COALESCE(r.max_travel_distance, 5), 5) * 1000)
       )
     ORDER BY p.id LIMIT 1;
    ASSERT v_host IS NOT NULL,
      'no fake host has a clean radius; every candidate has a real player within reach';

    SELECT p.id INTO v_invitee
      FROM player p JOIN profile pr ON pr.id = p.id
      JOIN player_sport ps ON ps.player_id = p.id AND ps.sport_id = v_sport AND ps.is_active
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
     WHERE prs.rating_score_id = c_rating
       AND pr.email ILIKE '%@fake-rallia.com'
       AND p.id <> v_host
       AND extensions.ST_DWithin(p.location, v_anchor,
             LEAST(COALESCE(p.max_travel_distance, 5), 5) * 1000)
     ORDER BY p.id DESC LIMIT 1;

    -- 3h30 out: inside the 2-6 hour window both sweeps use.
    v_start := (now() AT TIME ZONE 'America/Toronto') + interval '3 hours 30 minutes';

    -- ------------------------------------------------------------------
    -- Fixture A: last-minute lane + the ranked cap of 15
    -- Custom coordinates, so send_last_minute_spot_pushes can resolve a
    -- match point (it has no host-location fallback, see the note below).
    -- ------------------------------------------------------------------
    INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by,
                       visibility, format, timezone, facility_id,
                       custom_latitude, custom_longitude, location_type,
                       location_name, min_rating_score_id, notes)
    VALUES (v_match_lm, v_sport, v_start::date, v_start::time,
            (v_start + interval '1 hour')::time, v_host,
            'public', 'singles', 'America/Toronto', NULL,
            v_lat, v_lng, 'custom',
            'Terrain test Rallia', c_rating,
            '[SEED] discovery: last-minute lane + ranked cap');

    -- The host participant row is created by a trigger on match insert.

    SELECT count(*) INTO v_fanout
      FROM notification
     WHERE target_id = v_match_lm AND type = 'nearby_match_available';

    ASSERT v_fanout <= 15,
      format('ranked allocation must cap fanout at 15, got %s', v_fanout);
    RAISE NOTICE 'Fixture A: match %, nearby fanout % (cap 15)', v_match_lm, v_fanout;

    -- ------------------------------------------------------------------
    -- Fixture B: host-location fallback + pending invite reminder
    -- No facility and no coordinates, so the nearby trigger must fall back
    -- to the host's home location (0e627f97) to reach anyone at all.
    -- ------------------------------------------------------------------
    INSERT INTO match (id, sport_id, match_date, start_time, end_time, created_by,
                       visibility, format, timezone, facility_id,
                       custom_latitude, custom_longitude,
                       location_name, min_rating_score_id, notes)
    VALUES (v_match_inv, v_sport, v_start::date, v_start::time,
            (v_start + interval '1 hour')::time, v_host,
            'public', 'singles', 'America/Toronto', NULL,
            NULL, NULL,
            'Lieu a confirmer', c_rating,
            '[SEED] discovery: host-location fallback + invite reminder');

    SELECT count(*) INTO v_fanout
      FROM notification
     WHERE target_id = v_match_inv AND type = 'nearby_match_available';

    ASSERT v_fanout > 0,
      'a match with no facility and no coordinates must still fan out from the host location';
    RAISE NOTICE 'Fixture B: match %, fallback fanout %', v_match_inv, v_fanout;

    -- The pending invite the reminder sweep should pick up.
    INSERT INTO match_participant (match_id, player_id, status, is_host)
    VALUES (v_match_inv, v_invitee, 'pending', false);

    -- The sweep skips invites younger than an hour, so backdate it.
    UPDATE match_participant
       SET created_at = now() - interval '3 hours'
     WHERE match_id = v_match_inv AND player_id = v_invitee;

    RAISE NOTICE 'Fixture B: pending invite for player % backdated 3h', v_invitee;
    RAISE NOTICE 'Host % / invitee % / eligible fake pool % / real in range %',
                 v_host, v_invitee, v_pool, v_real;
END $$;

COMMIT;

-- ----------------------------------------------------------------------------
-- 3. Verify
-- ----------------------------------------------------------------------------
-- What the two sweeps should now find. Both should be non-zero.
SELECT
  (SELECT count(*) FROM match mt
    WHERE mt.notes LIKE '[SEED] discovery%' AND mt.cancelled_at IS NULL
      AND mt.custom_latitude IS NOT NULL
      AND ((mt.match_date + mt.start_time) AT TIME ZONE COALESCE(mt.timezone, 'America/Toronto'))
          BETWEEN now() + interval '2 hours' AND now() + interval '6 hours'
  ) AS last_minute_eligible_matches,
  (SELECT count(*) FROM match_participant mp
     JOIN match mt ON mt.id = mp.match_id
    WHERE mt.notes LIKE '[SEED] discovery%' AND mt.cancelled_at IS NULL
      AND mp.status = 'pending' AND mp.is_host = false
      AND mp.created_at < now() - interval '1 hour'
  ) AS reminder_eligible_invites,
  (SELECT count(*) FROM notification n
     JOIN match mt ON mt.id = n.target_id
    WHERE mt.notes LIKE '[SEED] discovery%' AND n.type = 'nearby_match_available'
  ) AS nearby_pushes_fired;

-- Confirm every recipient is a fake account. Must return zero rows.
SELECT n.user_id, pr.email
  FROM notification n
  JOIN match mt ON mt.id = n.target_id
  JOIN profile pr ON pr.id = n.user_id
 WHERE mt.notes LIKE '[SEED] discovery%'
   AND pr.email NOT ILIKE '%@fake-rallia.com';

-- ============================================================================
-- What this fixture proved on staging 2026-08-31
-- ----------------------------------------------------------------------------
--   nearby fanout        15 per match, exactly at the cap, both fixtures
--   last-minute lane     16 sends, 0 on re-run (per-pair dedup holds)
--   invite reminder      1 send, correctly skipping the out-of-window control
--   real users notified  0
--
-- The last-minute lane returned 0 until momentum_match_last_minute_spots was
-- flipped on. That flag, not the shared budget, is why it had never sent.
--
-- Known gap this fixture exposes
-- ----------------------------------------------------------------------------
-- Fixture B deliberately has no facility and no coordinates. The nearby trigger
-- reaches it through the host-location fallback added in 0e627f97, but
-- send_last_minute_spot_pushes resolves its match point from facility or custom
-- coordinates only and CONTINUEs past a NULL, so it will skip fixture B. The
-- fallback should be lifted into that sweep for consistency. Fixture A carries
-- coordinates specifically so the last-minute lane has something to act on in
-- the meantime.
-- ============================================================================
