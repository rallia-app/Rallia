-- ============================================================================
-- Répétition du 16 septembre, SUR STAGING SEULEMENT. Jamais en prod.
-- ----------------------------------------------------------------------------
-- Joue le runbook serie3-open-and-deadlines.sql dans l'ordre du jour J, en une
-- transaction : vérification de l'ÉTAPE 0, ouverture avec les gardes de
-- l'ÉTAPE 1, inscriptions payées de joueurs fixtures DANS LA BANDE de cote de
-- chaque tableau (jamais le compte de Jean), fermeture, tirage, ÉTAPE 2a avec
-- la vraie date. Puis lit ce que le drapeau a changé au tirage.
--
-- Deux gestes n'existent que pour staging et sont marqués comme tels : le
-- compte Stripe fictif de l'organisateur maison (la prod en a un vrai) et la
-- suppression de la vague de notifications d'ouverture.
--
-- Joué le 14 septembre : Avancé 10 -> 3 poules, Intermédiaire 20 -> 5 poules,
-- zéro carte d'ancien modèle postée, zéro notification à Jean.
--
--   npx supabase db query --linked -f scripts/tournaments/rehearse-serie3-draw-staging.sql
-- ============================================================================
-- Rehearsal of the 16th on STAGING. Runbook order: ÉTAPE 0 check, open (ÉTAPE 1
-- guards), register fixtures (never Jean), close, draw, ÉTAPE 2a. One transaction.
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p::text)::text, true)::void; $$;
CREATE OR REPLACE FUNCTION pg_temp.fakes_in_band(p_min numeric, p_max numeric, n int) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT array_agg(id) FROM (
    SELECT u.id FROM auth.users u
      JOIN player_sport ps ON ps.player_id = u.id
      JOIN sport s ON s.id = ps.sport_id AND s.name = 'tennis'
      JOIN player_rating_score prs ON prs.id = ps.active_rating_score_id
      JOIN rating_score rs ON rs.id = prs.rating_score_id
     WHERE u.email LIKE '%@fake-rallia.com' AND ps.is_active AND NOT public.is_admin(u.id)
       AND (p_min IS NULL OR rs.value >= p_min) AND (p_max IS NULL OR rs.value <= p_max)
     ORDER BY u.email LIMIT n) t; $$;
CREATE OR REPLACE FUNCTION pg_temp.mark_paid(p_reg uuid) RETURNS void LANGUAGE sql AS $$
    UPDATE lt_registration_payment
       SET status = 'succeeded', stripe_payment_intent_id = 'pi_' || left(p_reg::text, 8),
           stripe_charge_id = 'ch_' || left(p_reg::text, 8), updated_at = now()
     WHERE tournament_registration_id = p_reg AND status = 'pending';
    UPDATE tournament_registrations
       SET status = 'registered', version = version + 1, updated_at = now()
     WHERE id = p_reg; $$;

DO $$
DECLARE
    v_org uuid; v_t tournaments; v_ver int; v_u uuid; v_res record; v_n int;
    v_roster uuid[]; v_name text; v_size int;
BEGIN
    -- ÉTAPE 0 check
    SELECT count(*) INTO v_n FROM tournaments
     WHERE name LIKE 'Série 3 Montréal · Tennis ·%' AND scheduling_funnel_enabled
       AND min_availability_hours = 6;
    IF v_n <> 2 THEN RAISE EXCEPTION 'ÉTAPE 0: flag not on both draws (%)', v_n; END IF;

    -- ÉTAPE 1 guards, exactly as the runbook
    SELECT DISTINCT organizer_id INTO v_org FROM tournaments WHERE name LIKE 'Série 3 Montréal · Tennis ·%';
    -- STAGING ONLY: the house organizer has no Connect account there. Prod does (verified 09-08).
    INSERT INTO player_stripe_account (player_id, stripe_account_id, charges_enabled)
    VALUES (v_org, 'acct_staging_rehearsal', true)
    ON CONFLICT (player_id) DO UPDATE SET charges_enabled = true;
    UPDATE player SET is_certified_organizer = true WHERE id = v_org AND NOT is_certified_organizer;
    IF NOT EXISTS (SELECT 1 FROM player_stripe_account WHERE player_id = v_org AND charges_enabled) THEN
        RAISE EXCEPTION 'ÉTAPE 1: PAYOUTS_SETUP_REQUIRED on staging organizer %', v_org;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM player WHERE id = v_org AND is_certified_organizer) THEN
        RAISE EXCEPTION 'ÉTAPE 1: staging organizer not certified';
    END IF;
    UPDATE tournaments SET status = 'registration_open', version = version + 1, updated_at = now()
     WHERE name LIKE 'Série 3 Montréal · Tennis ·%' AND status = 'draft';
    -- rehearsal only: no push wave to staging players
    DELETE FROM tournament_fanout_job j USING tournaments t
     WHERE j.tournament_id = t.id AND t.name LIKE 'Série 3 Montréal · Tennis ·%';

    -- registrations: paid path, never Jean
    FOR v_name, v_size, v_roster IN
        SELECT 'Série 3 Montréal · Tennis · Avancé', 10, pg_temp.fakes_in_band(4.0, NULL, 10)
        UNION ALL
        SELECT 'Série 3 Montréal · Tennis · Intermédiaire', 20, pg_temp.fakes_in_band(3.0, 3.5, 20)
    LOOP
        SELECT * INTO v_t FROM tournaments WHERE name = v_name;
        IF COALESCE(array_length(v_roster, 1), 0) < v_size THEN
            RAISE EXCEPTION '% : only % in-band fixture players, wanted %', v_name, COALESCE(array_length(v_roster,1),0), v_size;
        END IF;
        FOREACH v_u IN ARRAY v_roster LOOP
            PERFORM pg_temp.as_user(v_u);
            SELECT * INTO v_res FROM public.tournament_begin_paid_registration(v_t.id, NULL);
            PERFORM pg_temp.mark_paid(v_res.registration_id);
        END LOOP;
        -- close + draw, as the organizer
        PERFORM pg_temp.as_user(v_org);
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_close_registration(v_t.id, v_ver);
        SELECT version INTO v_ver FROM tournaments WHERE id = v_t.id;
        PERFORM public.tournament_generate_pools(v_t.id, v_ver);
    END LOOP;

    -- ÉTAPE 2a, real date
    INSERT INTO tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
    SELECT t.id, 'pool', 0, '2026-09-27 23:59:00 America/Toronto'::timestamptz
      FROM tournaments t WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%' AND t.status = 'in_progress'
    ON CONFLICT (tournament_id, bracket_side, round_number)
    DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
    FOR v_t IN SELECT * FROM tournaments WHERE name LIKE 'Série 3 Montréal · Tennis ·%' AND status='in_progress' LOOP
        INSERT INTO leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
        VALUES ('tournament', v_t.id, 'set_round_deadlines', v_org, '{"via":"rehearsal"}'::jsonb);
        PERFORM public.lt_notify_tournament_deadline_changed(v_t.id, 'pool', '{0}'::smallint[]);
    END LOOP;
END $$;

-- What the flag changed at draw time
SELECT t.name, t.status::text,
       (SELECT count(DISTINCT m.pool_number) FROM tournament_matches m WHERE m.tournament_id=t.id) AS pools,
       (SELECT count(*) FROM tournament_matches m WHERE m.tournament_id=t.id) AS pairings,
       (SELECT count(*) FROM tournament_registrations r WHERE r.tournament_id=t.id AND r.status='registered') AS registered,
       (SELECT deadline_at::date FROM tournament_round_deadlines d WHERE d.tournament_id=t.id AND d.bracket_side='pool') AS pool_deadline,
       (SELECT count(*) FROM message x JOIN conversation c ON c.id=x.conversation_id
          JOIN tournament_matches m ON m.id=c.tournament_match_id
         WHERE m.tournament_id=t.id AND x.message_type='match_organizer'
           AND (x.metadata->>'funnel')::boolean) AS funnel_cards,
       (SELECT count(*) FROM message x JOIN conversation c ON c.id=x.conversation_id
          JOIN tournament_matches m ON m.id=c.tournament_match_id
         WHERE m.tournament_id=t.id AND x.message_type='match_organizer'
           AND NOT COALESCE((x.metadata->>'funnel')::boolean,false)) AS old_cards,
       (SELECT count(*) FROM conversation c WHERE c.tournament_id=t.id AND c.tournament_pool_number IS NOT NULL) AS pool_rooms,
       (SELECT count(*) FROM notification n, (SELECT id FROM auth.users WHERE email='jdl.sonkin@gmail.com') j
         WHERE n.user_id=j.id AND n.target_id=t.id) AS jean_notified
  FROM tournaments t WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%' ORDER BY t.name;
