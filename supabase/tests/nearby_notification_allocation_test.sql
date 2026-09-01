-- ============================================
-- Nearby-match notification: adaptive ceiling, ranked cap, point fallback
-- ============================================
-- Covers 20260831190000_nearby_adaptive_ranked_allocation:
--
--   1. discovery_ceiling() tiers, including NULL inputs.
--   2. A public match with NO facility and NO custom coordinates still fans out,
--      anchored on the host's home location. Before the fallback, v_match_point
--      was NULL and the trigger returned early: 15 public games in August 2026
--      reached nobody for this reason.
--   3. Fanout is capped at 15 recipients per match, even with more eligible
--      candidates. Matches with 31+ recipients burned 80% of June volume for
--      0.23% joins.
--   4. A host with no location still fans out to nobody, so the fallback did
--      not open a hole for locationless hosts.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/nearby_notification_allocation_test.sql
--
-- Runs in one transaction and ROLLBACKs.
-- ============================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Tier policy is pure, so assert it directly
-- --------------------------------------------------------------------------
DO $$
BEGIN
    -- Tiers sit at or under the measured fatigue inflection (~10/month, where
    -- type-specific opt-out triples from 4.5% to 12%). See 20260901010000.
    ASSERT public.discovery_ceiling(30, 2) = 3,
      'a converter should earn headroom, but stay near the fatigue inflection (3)';
    ASSERT public.discovery_ceiling(25, 0) = 1,
      '20+ pushes and no joins should be throttled (1)';
    ASSERT public.discovery_ceiling(5, 0) = 2,
      'under the cold threshold should stay on the default (2)';
    ASSERT public.discovery_ceiling(0, 0) = 2,
      'a brand new player must not be treated as cold';
    ASSERT public.discovery_ceiling(NULL, NULL) = 2,
      'NULL counts must fall back to the default, not throttle';
    ASSERT public.discovery_ceiling(30, 2) <= 3 AND public.discovery_ceiling(0, 0) <= 3,
      'no tier may exceed 3/week: ~13/month is already past where opt-out triples';
    RAISE NOTICE 'ok 1 - discovery_ceiling tiers';
END $$;

-- --------------------------------------------------------------------------
-- 2 + 3. Locationless match fans out from the host, capped at 15
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport    uuid;
    v_host     uuid;
    v_anchor   extensions.geography;
    v_lat      numeric;
    v_lng      numeric;
    v_rs       uuid;
    v_match    uuid := gen_random_uuid();
    v_eligible int;
    v_sent     int;
    r          record;
BEGIN
    SELECT id INTO v_sport FROM sport ORDER BY id LIMIT 1;
    ASSERT v_sport IS NOT NULL, 'need a seeded sport';

    -- The rating must belong to this sport's rating system, or
    -- validate_player_sport_active_rating() rejects the player_sport row.
    SELECT rs.id INTO v_rs
      FROM rating_score rs
      JOIN rating_system rsys ON rsys.id = rs.rating_system_id
     WHERE rsys.sport_id = v_sport
     ORDER BY rs.id LIMIT 1;
    ASSERT v_rs IS NOT NULL, 'need a rating_score for this sport';

    -- Host: give them a home location, which is the only anchor this match has.
    SELECT id INTO v_host FROM player WHERE location IS NOT NULL ORDER BY id LIMIT 1;
    ASSERT v_host IS NOT NULL, 'need a seeded player with a location';
    -- player.location is generated from latitude/longitude, so seed those.
    SELECT latitude, longitude, location
      INTO v_lat, v_lng, v_anchor
      FROM player WHERE id = v_host;

    -- The trigger excludes players who share a player_group with the host.
    DELETE FROM network_member nm
     USING network n, network_type nt
     WHERE nm.network_id = n.id
       AND n.network_type_id = nt.id
       AND nt.name = 'player_group'
       AND nm.player_id = v_host;

    -- 20 eligible candidates: co-located, same sport active, same exact rating.
    FOR r IN
        SELECT id FROM player WHERE id <> v_host ORDER BY id LIMIT 20
    LOOP
        UPDATE player
           SET latitude = v_lat, longitude = v_lng, max_travel_distance = 10
         WHERE id = r.id;

        INSERT INTO player_rating_score (id, player_id, rating_score_id)
        VALUES (gen_random_uuid(), r.id, v_rs)
        ON CONFLICT DO NOTHING;

        INSERT INTO player_sport (player_id, sport_id, is_active, active_rating_score_id)
        VALUES (
            r.id, v_sport, TRUE,
            (SELECT id FROM player_rating_score
              WHERE player_id = r.id AND rating_score_id = v_rs LIMIT 1)
        )
        ON CONFLICT (player_id, sport_id) DO UPDATE
           SET is_active = TRUE,
               active_rating_score_id = EXCLUDED.active_rating_score_id;
    END LOOP;

    SELECT count(*) INTO v_eligible
      FROM player p
      JOIN player_sport ps ON ps.player_id = p.id
                          AND ps.sport_id = v_sport
                          AND ps.is_active
     WHERE p.id <> v_host
       AND extensions.ST_DWithin(p.location, v_anchor, LEAST(p.max_travel_distance, 5) * 1000);
    ASSERT v_eligible > 15,
      format('fixture must exceed the cap to test it, got %s', v_eligible);

    -- No facility, no custom coordinates. Only the host's home location anchors it.
    INSERT INTO match (
        id, sport_id, match_date, start_time, end_time, created_by,
        visibility, facility_id, custom_latitude, custom_longitude,
        min_rating_score_id
    ) VALUES (
        v_match, v_sport, current_date + 2, '18:00', '19:00', v_host,
        'public', NULL, NULL, NULL,
        v_rs
    );

    SELECT count(*) INTO v_sent
      FROM notification
     WHERE target_id = v_match AND type = 'nearby_match_available';

    ASSERT v_sent > 0,
      'a locationless public match must still fan out from the host location';
    ASSERT v_sent = 15,
      format('fanout must be capped at 15 per match, got %s', v_sent);

    RAISE NOTICE 'ok 2 - host-location fallback fans out';
    RAISE NOTICE 'ok 3 - fanout capped at 15 (% eligible)', v_eligible;
END $$;

-- --------------------------------------------------------------------------
-- 4. A host with no location must still reach nobody
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_sport uuid;
    v_host  uuid;
    v_match uuid := gen_random_uuid();
    v_sent  int;
BEGIN
    SELECT id INTO v_sport FROM sport ORDER BY id LIMIT 1;

    SELECT id INTO v_host FROM player ORDER BY id DESC LIMIT 1;
    UPDATE player SET latitude = NULL, longitude = NULL WHERE id = v_host;

    INSERT INTO match (
        id, sport_id, match_date, start_time, end_time, created_by,
        visibility, facility_id, custom_latitude, custom_longitude
    ) VALUES (
        v_match, v_sport, current_date + 2, '18:00', '19:00', v_host,
        'public', NULL, NULL, NULL
    );

    SELECT count(*) INTO v_sent
      FROM notification
     WHERE target_id = v_match AND type = 'nearby_match_available';

    ASSERT v_sent = 0,
      format('a host with no location has no anchor and must reach nobody, got %s', v_sent);

    RAISE NOTICE 'ok 4 - locationless host still reaches nobody';
END $$;

ROLLBACK;
