-- ============================================================================
-- Série 3 : activer le parcours de planification et l'arbitrage automatique
-- ============================================================================
-- Tout ce qui a été construit depuis le 29 août (la porte des dispos, le salon
-- de poule verrouillé, la réservation en une tape, l'échelle de décision
-- R0..R6 et ses notifications) est OPT-IN par événement, via
-- `scheduling_funnel_enabled`. Onze fonctions le lisent, dont
-- `lt_resolve_due_tournament_matches` : à false, l'échelle ne fait qu'auditer
-- (préfixe dryrun_) et ne tranche rien. La Série 3 a été semée sans le drapeau
-- et aurait donc rejoué la Série 2 : 35 pairages sur 56 réglés à la main.
--
-- DOIT ATTERRIR EN PROD AVANT LE TIRAGE DES POULES (16 septembre). C'est
-- `tournament_generate_pools` qui passe l'événement en cours et déclenche
-- `lt_tournaments_post_organizer_cards_tg` ; à ce moment-là le drapeau décide
-- quelle carte est postée dans les salons. D'où le garde-fou : si des poules
-- existent déjà, on s'arrête plutôt que de poser le drapeau sur des cartes
-- déjà publiées (le rattrapage existe, `lt_regenerate_system_organizer_card`,
-- mais c'est un geste à faire en connaissance de cause, pas en migration).
--
-- `min_availability_hours` : le seed l'a laissé NULL. C'est le seuil qui vaut
-- 2 points de volume à la porte ; toutes les fixtures le posent à 6, on fait
-- pareil.
--
-- Étape 0 du runbook scripts/tournaments/serie3-open-and-deadlines.sql.
-- Principes validés par Jean le 2 septembre ; mécaniques en reprise le 14.
-- ============================================================================

DO $$
DECLARE
    v_with_pools integer;
    v_touched    integer;
BEGIN
    SELECT count(DISTINCT t.id) INTO v_with_pools
      FROM public.tournaments t
      JOIN public.tournament_matches m ON m.tournament_id = t.id
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%';
    IF v_with_pools > 0 THEN
        RAISE EXCEPTION 'Série 3: % tableau(x) ont déjà des poules; le drapeau doit être posé AVANT le tirage (voir l''en-tête)', v_with_pools;
    END IF;

    UPDATE public.tournaments
       SET scheduling_funnel_enabled = true,
           min_availability_hours    = COALESCE(min_availability_hours, 6),
           updated_at                = now()
     WHERE name LIKE 'Série 3 Montréal · Tennis ·%'
       AND status IN ('draft', 'registration_open', 'registration_closed');
    GET DIAGNOSTICS v_touched = ROW_COUNT;

    IF v_touched <> 2 THEN
        RAISE EXCEPTION 'Série 3: % tableau(x) mis à jour, 2 attendus', v_touched;
    END IF;

    INSERT INTO public.leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    SELECT 'tournament', t.id, 'scheduling_funnel_enabled', t.organizer_id,
           jsonb_build_object('min_availability_hours', t.min_availability_hours,
                              'source', 'migration serie3_enable_scheduling_funnel')
      FROM public.tournaments t
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%';
END $$;
