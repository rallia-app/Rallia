-- ============================================================================
-- Remettre les deux tableaux Série 3 de STAGING en draft, après une répétition.
-- JAMAIS EN PROD : ce fichier efface des inscriptions payées.
-- ----------------------------------------------------------------------------
-- Défait tout ce que rehearse-serie3-draw-staging.sql a créé : pairages,
-- salons et cartes, inscriptions et paiements, échéances, réponses à la porte,
-- notifications, audit, jobs de fan-out. Garde le drapeau du parcours (posé par
-- migration) et le compte Stripe fictif de l'organisateur maison.
-- Une transaction ; le SELECT final doit montrer draft / 0 partout.
--
--   npx supabase db query --linked -f scripts/tournaments/reset-serie3-staging-to-draft.sql
-- ============================================================================
DO $$
DECLARE v_ids uuid[]; v_tm uuid[]; v_conv uuid[]; v_reg uuid[];
BEGIN
    IF current_setting('rallia.env', true) = 'prod' THEN RAISE EXCEPTION 'never in prod'; END IF;
    SELECT array_agg(id) INTO v_ids FROM tournaments WHERE name LIKE 'Série 3 Montréal · Tennis ·%';
    SELECT array_agg(id) INTO v_tm FROM tournament_matches WHERE tournament_id = ANY (v_ids);
    SELECT array_agg(id) INTO v_reg FROM tournament_registrations WHERE tournament_id = ANY (v_ids);
    SELECT array_agg(c.id) INTO v_conv FROM conversation c
     WHERE c.tournament_id = ANY (v_ids) OR c.tournament_match_id = ANY (COALESCE(v_tm, '{}'));

    DELETE FROM notification WHERE target_id = ANY (v_ids) OR target_id = ANY (COALESCE(v_tm, '{}'));
    DELETE FROM message WHERE conversation_id = ANY (COALESCE(v_conv, '{}'));
    DELETE FROM conversation_participant WHERE conversation_id = ANY (COALESCE(v_conv, '{}'));
    DELETE FROM conversation WHERE id = ANY (COALESCE(v_conv, '{}'));
    DELETE FROM lt_pairing_booking WHERE tournament_match_id = ANY (COALESCE(v_tm, '{}'));
    DELETE FROM tournament_phase_availability WHERE tournament_id = ANY (v_ids);
    DELETE FROM tournament_round_deadlines WHERE tournament_id = ANY (v_ids);
    DELETE FROM tournament_matches WHERE tournament_id = ANY (v_ids);
    DELETE FROM lt_registration_payment WHERE tournament_registration_id = ANY (COALESCE(v_reg, '{}'));
    DELETE FROM tournament_registrations WHERE tournament_id = ANY (v_ids);
    DELETE FROM tournament_fanout_job WHERE tournament_id = ANY (v_ids);
    DELETE FROM leagues_tournaments_audit
     WHERE (scope = 'tournament' AND entity_id = ANY (v_ids))
        OR (scope = 'tournament_match' AND entity_id = ANY (COALESCE(v_tm, '{}')))
        OR (scope = 'registration' AND entity_id = ANY (COALESCE(v_reg, '{}')));

    UPDATE tournaments SET status = 'draft', version = version + 1, updated_at = now()
     WHERE id = ANY (v_ids);
END $$;

SELECT t.name, t.status::text, t.scheduling_funnel_enabled AS funnel,
       (SELECT count(*) FROM tournament_matches m WHERE m.tournament_id = t.id) AS pairings,
       (SELECT count(*) FROM tournament_registrations r WHERE r.tournament_id = t.id) AS registrations,
       (SELECT count(*) FROM conversation c WHERE c.tournament_id = t.id) AS rooms,
       (SELECT count(*) FROM tournament_round_deadlines d WHERE d.tournament_id = t.id) AS deadlines
  FROM tournaments t WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%' ORDER BY t.name;
