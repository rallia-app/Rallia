-- ============================================
-- Private tournaments: registrants see the roster, outsiders do not
-- ============================================
-- Covers the treg_select amendment. Picks a tournament with at least two
-- non-admin registrants, makes it private, and reads the roster as one of
-- them (all rows) and as a non-admin non-registrant (none).
--
-- Run:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/lt_private_tournament_roster_test.sql
-- One transaction, ROLLBACK at the end.
-- ============================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', p::text, 'role', 'authenticated')::text, true)::void;
$$;

DO $$
DECLARE
    v_t        uuid;
    v_total    int;
    v_reg      uuid;
    v_outsider uuid;
    v_seen     int;
BEGIN
    SELECT r.tournament_id, count(*) INTO v_t, v_total
      FROM tournament_registrations r
      JOIN tournaments t ON t.id = r.tournament_id
     WHERE NOT public.is_admin(r.user_id) AND t.organizer_id <> r.user_id
     GROUP BY r.tournament_id HAVING count(*) >= 2
     ORDER BY count(*) DESC LIMIT 1;
    IF v_t IS NULL THEN RAISE EXCEPTION 'fixture: no tournament with two non-admin registrants'; END IF;

    SELECT r.user_id INTO v_reg FROM tournament_registrations r
     WHERE r.tournament_id = v_t AND NOT public.is_admin(r.user_id)
       AND r.user_id <> (SELECT organizer_id FROM tournaments WHERE id = v_t)
     ORDER BY r.user_id LIMIT 1;
    SELECT u.id INTO v_outsider FROM auth.users u
     WHERE NOT public.is_admin(u.id)
       AND u.id <> (SELECT organizer_id FROM tournaments WHERE id = v_t)
       AND NOT EXISTS (SELECT 1 FROM tournament_registrations r
                        WHERE r.tournament_id = v_t
                          AND (r.user_id = u.id OR r.partner_user_id = u.id))
       AND NOT EXISTS (SELECT 1 FROM tournament_co_organizers c WHERE c.tournament_id = v_t AND c.user_id = u.id)
     ORDER BY u.id LIMIT 1;

    UPDATE tournaments SET visibility = 'private' WHERE id = v_t;

    -- 1. A registrant sees the whole roster.
    PERFORM pg_temp.as_user(v_reg);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_seen FROM tournament_registrations WHERE tournament_id = v_t;
    RESET ROLE;
    IF v_seen <> v_total THEN
        RAISE EXCEPTION 'a registrant of a private tournament saw % of % registrations', v_seen, v_total;
    END IF;

    -- 2. An outsider sees none.
    PERFORM pg_temp.as_user(v_outsider);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_seen FROM tournament_registrations WHERE tournament_id = v_t;
    RESET ROLE;
    IF v_seen <> 0 THEN
        RAISE EXCEPTION 'an outsider saw % registrations of a private tournament', v_seen;
    END IF;

    RAISE NOTICE 'lt_private_tournament_roster_test: ALL PASS';
END;
$$;

ROLLBACK;
