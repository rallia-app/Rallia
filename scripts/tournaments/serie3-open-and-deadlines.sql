-- ============================================================================
-- Série 3 : ouvrir les inscriptions, puis poser les échéances du plan
-- ----------------------------------------------------------------------------
-- La CRÉATION des deux tableaux vit dans les migrations
--   20260908211305_seed_serie3_paid_tournaments.sql   (création, en draft)
--   20260908222310_serie3_two_qualifiers_per_pool.sql (retour à 2 qualifiés)
--
-- Ce fichier ne porte que les deux gestes qu'une migration ne peut pas porter,
-- parce qu'ils dépendent d'une DATE et d'un TIRAGE, pas du schéma :
--
--   ÉTAPE 1  ouvrir les inscriptions       -> le mercredi 9 septembre, 9 h
--   ÉTAPE 2  poser les échéances de tours  -> juste après chaque tirage
--   ÉTAPE 3  taxes sur l'entrée (TPS/TVQ)  -> dès que la prod a 20260910143506
--
-- À jouer une étape à la fois. LE MEILLEUR CHEMIN EST L'APP quand il en offre un ;
-- ces blocs existent pour le dashboard, où `auth.uid()` est absent.
--
-- ------------------------------------------------------------------------
-- LE CALENDRIER, ARRÊTÉ LE 8 SEPTEMBRE
--
--   inscriptions   9 au 15 septembre
--   départ         mercredi 16 septembre
--   poules         jusqu'au dimanche 27 septembre
--   quarts         vendredi 2 octobre
--   demies         mercredi 7 octobre
--   finale         lundi 12 octobre  (= end_date, Action de grâce)
--
-- 5 jours par tour, le plan d'origine de Jean. L'option 4 / 8 / 12 octobre a
-- été examinée puis ÉCARTÉE (Mathis, 8 septembre) : elle aurait déplacé la
-- seule fenêtre sans fin de semaine des quarts vers les demies. On garde donc
-- 2 / 7 / 12, en sachant que les quarts (28 septembre au 2 octobre) tombent du
-- lundi au vendredi, sans fin de semaine, avec un coucher de soleil vers
-- 18 h 30. C'est le risque connu et accepté du calendrier.
--
-- ------------------------------------------------------------------------
-- POURQUOI L'ÉTAPE 2 N'EST PAS OPTIONNELLE
--
-- `tournament_generate_pools` et `tournament_generate_knockout` posent des
-- échéances par défaut au prorata du temps restant À PARTIR DU TIRAGE, jamais
-- selon ce que le règlement annonce. En Série 2, la fin des poules avait
-- atterri 5 jours après la date promise aux joueurs. Poser les vraies dates
-- DANS LA MÊME HEURE que le tirage, pas le lendemain.
--
-- ⚠️ Et depuis 20260901030000, une échéance PASSÉE ne se déplace plus, par
-- personne. `tournament_set_round_deadlines` refuse aussi d'AVANCER une
-- échéance à moins de 48 h (DEADLINE_TOO_SOON). Corriger tôt ou pas du tout.
-- ============================================================================


-- ============================================================================
-- ÉTAPE 1 : ouvrir les inscriptions. À JOUER LE MERCREDI 9 SEPTEMBRE, PAS AVANT.
--
-- Dans l'app : l'organisateur ouvre via `tournament_open_registration`, qui
-- refuse un événement PAYANT tant que l'organisateur n'a pas un
-- `player_stripe_account` avec `charges_enabled` (20260726120000).
-- Vérifié le 8 septembre sur la prod : contact@rallia.ca a charges_enabled et
-- is_certified_organizer. Les deux gardes passent.
--
-- ⚠️ Un UPDATE brut ne passe par AUCUN gate. Le garde-fou ci-dessous rejoue
-- donc la vérification Stripe à la main : sans elle on publie un tournoi
-- payant que personne ne peut payer.
--
-- ⚠️ Et passer par un UPDATE, jamais par un INSERT au bon statut : le fan-out
-- (`tournament_registration_open_fanout`) et les notifications de cycle de vie
-- sont des triggers AFTER UPDATE. Le fan-out ne part QUE si l'organisateur est
-- `is_certified_organizer` ; sinon on notifie zéro joueur, sans erreur.
-- Cible attendue au 8 septembre : ~304 Intermédiaire, ~196 Avancé.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_org    uuid;
    v_opened integer;
BEGIN
    SELECT DISTINCT organizer_id INTO v_org
      FROM public.tournaments
     WHERE name LIKE 'Série 3 Montréal · Tennis ·%';

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'Aucun tournoi Série 3 : la migration 20260908211305 a-t-elle tourné sur cet environnement ?';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.player_stripe_account
         WHERE player_id = v_org AND charges_enabled
    ) THEN
        RAISE EXCEPTION
            'PAYOUTS_SETUP_REQUIRED: l''organisateur n''a pas de compte Stripe Connect avec charges_enabled.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.player WHERE id = v_org AND is_certified_organizer
    ) THEN
        RAISE EXCEPTION
            'Organisateur non certifié : ouvrir maintenant notifierait ZÉRO joueur, sans erreur. Poser is_certified_organizer d''abord.';
    END IF;

    UPDATE public.tournaments
       SET status     = 'registration_open',
           version    = version + 1,
           updated_at = now()
     WHERE name LIKE 'Série 3 Montréal · Tennis ·%'
       AND status = 'draft';

    GET DIAGNOSTICS v_opened = ROW_COUNT;

    -- Le RPC en écrit une ; l'UPDATE brut ne le ferait pas.
    INSERT INTO public.leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    SELECT 'tournament', t.id, 'open_registration', v_org,
           jsonb_build_object('status', t.status, 'via', 'dashboard_sql')
      FROM public.tournaments t
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
       AND t.status = 'registration_open';

    RAISE NOTICE '% tournoi(s) ouvert(s).', v_opened;
END $$;

-- Doit renvoyer 2 lignes 'pending'.
SELECT j.id, t.name, j.status, j.notified_count
  FROM public.tournament_fanout_job j
  JOIN public.tournaments t ON t.id = j.tournament_id
 WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
 ORDER BY j.id;

COMMIT;


-- ============================================================================
-- ÉTAPE 2 : les échéances. APRÈS CHAQUE TIRAGE, dans la même heure.
--
--   2a. après `tournament_generate_pools`     -> ligne ('pool', 0)
--   2b. après `tournament_generate_knockout`  -> main 1..3 = quarts, demies, finale
--
-- 2 qualifiés par poule sur un tableau de 16 = 8 qualifiés = tableau de 8 =
-- TROIS tours. Vérifié sur une fixture locale : 4 quarts + 2 demies + 1 finale.
-- Si le remplissage est plus mince, le nombre de tours CHANGE et ce bloc doit
-- suivre (9 à 12 inscrits -> 3 poules -> 6 qualifiés -> tableau de 8 avec 2
-- byes, toujours 3 tours ; 6 à 8 inscrits -> 2 poules -> 4 qualifiés ->
-- tableau de 4, DEUX tours seulement : ne pas insérer de round 3).
-- Sous 6 inscrits le tirage ne se génère pas du tout (INSUFFICIENT_PARTICIPANTS).
--
-- Décommenter au moment voulu.
-- ============================================================================

-- BEGIN;
--
-- -- 2a. Fin de la phase de poules : dimanche 27 septembre.
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'pool', 0, '2026-09-27 23:59:00 America/Toronto'::timestamptz
--   FROM public.tournaments t
--  WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
--    AND t.status = 'in_progress'
-- ON CONFLICT (tournament_id, bracket_side, round_number)
-- DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
--
-- -- 2b. 5 jours par tour, comme annoncé dans le règlement.
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'main', d.round_number, d.deadline_at
--   FROM public.tournaments t
--  CROSS JOIN (VALUES
--        (1::smallint, '2026-10-02 23:59:00 America/Toronto'::timestamptz),  -- quarts
--        (2::smallint, '2026-10-07 23:59:00 America/Toronto'::timestamptz),  -- demies
--        (3::smallint, '2026-10-12 23:59:00 America/Toronto'::timestamptz)   -- finale
--  ) AS d(round_number, deadline_at)
--  WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
--    AND t.status = 'in_progress'
--    -- Ne pose un tour que s'il EXISTE vraiment dans ce tableau.
--    AND EXISTS (SELECT 1 FROM public.tournament_matches m
--                 WHERE m.tournament_id = t.id AND m.bracket_side = 'main'
--                   AND m.round_number = d.round_number)
-- ON CONFLICT (tournament_id, bracket_side, round_number)
-- DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
--
-- -- Un UPDATE brut ne notifie personne et n'audite rien : on rejoue les deux
-- -- gestes du RPC pour les tournois réellement touchés.
-- DO $$
-- DECLARE
--     v_id  uuid;
--     v_org uuid;
-- BEGIN
--     FOR v_id, v_org IN
--         SELECT t.id, t.organizer_id FROM public.tournaments t
--          WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%' AND t.status = 'in_progress'
--     LOOP
--         INSERT INTO public.leagues_tournaments_audit
--             (scope, entity_id, action, actor_id, payload_after)
--         VALUES ('tournament', v_id, 'set_round_deadlines', v_org,
--                 jsonb_build_object('via', 'dashboard_sql'));
--         PERFORM public.lt_notify_tournament_deadline_changed(v_id, 'pool', '{0}'::smallint[]);
--         PERFORM public.lt_notify_tournament_deadline_changed(v_id, 'main', '{1,2,3}'::smallint[]);
--     END LOOP;
-- END $$;
--
-- COMMIT;


-- ============================================================================
-- ÉTAPE 3 : TPS/TVQ sur l'entrée. TOUS les événements Rallia, pas que la Série 3.
--
-- Contexte : 20260910020252 (mode) et 20260910143506 (crédit). Les frais de
-- service sont à zéro sur un événement Rallia (Rallia ne se facture pas
-- elle-même), et la taxe était accrochée aux frais : chaque inscription
-- payée à un événement maison est donc enregistrée avec ZÉRO taxe, alors que
-- l'entrée est une fourniture par un inscrit à la TPS/TVQ. Décidé le
-- 10 septembre :
--
--   * l'entrée est taxable, affichée taxes incluses : 15 $ = 13,05 $ + 1,95 $ ;
--   * un crédit de parrainage est une réduction de prix : la taxe porte sur
--     ce que le joueur a VRAIMENT payé (10 $ de crédit -> 5 $ payés -> 0,65 $) ;
--   * les Séries 1 et 2, encaissées sans calcul, sont taxes incluses elles
--     aussi : les reçus Stripe le disaient déjà. Elles entrent dans la
--     déclaration de la période où chaque entrée a été payée.
--
-- Le mode `included` corrige la comptabilité SANS toucher au prix. Aucun
-- geste Stripe, aucun remboursement, aucune notification.
--
-- ⚠️ LE PIÈGE : le grand livre (`lt_registration_payment`) fige
-- `entry_tax_cents` au moment où l'inscription COMMENCE. Basculer un
-- événement ne corrige que les inscriptions FUTURES. Tout ce qui a été payé
-- pendant qu'il était en `none` porte un 0 permanent. D'où le 3b : on rejoue
-- le calcul sur toutes les lignes existantes des événements maison, crédit
-- déduit, avec la même fonction que l'RPC. Jamais un chiffre à la main.
--
-- Rejouable sans risque : les deux UPDATE filtrent sur `none`, une seconde
-- passe ne touche rien. Prérequis : les deux migrations sont appliquées ici
-- (le garde-fou le vérifie). Tout s'annule si quelque chose cloche.
--
-- Décommenter au moment voulu.
-- ============================================================================

-- BEGIN;
--
-- DO $$
-- DECLARE
--     v_flipped_t  integer;
--     v_flipped_s  integer;
--     v_backfilled integer;
--     v_tax_total  integer;
-- BEGIN
--     IF to_regprocedure('public.compute_entry_tax_cents(integer, entry_tax_mode_enum)') IS NULL THEN
--         RAISE EXCEPTION 'La migration 20260910020252 n''est pas appliquée ici : rien à faire.';
--     END IF;
--     IF NOT EXISTS (SELECT 1 FROM public.profile WHERE is_house_organizer) THEN
--         RAISE EXCEPTION 'Aucun organisateur maison sur cet environnement : rien à basculer.';
--     END IF;
--
--     -- 3a. Basculer tout événement maison, quel que soit son statut. Vaut
--     -- pour toute inscription à venir ; sur un tournoi fini, c'est cohérent
--     -- avec le grand livre rejoué en 3b.
--     UPDATE public.tournaments t
--        SET entry_tax_mode = 'included', updated_at = now()
--       FROM public.profile pr
--      WHERE pr.id = t.organizer_id AND pr.is_house_organizer
--        AND t.entry_tax_mode = 'none';
--     GET DIAGNOSTICS v_flipped_t = ROW_COUNT;
--
--     UPDATE public.seasons s
--        SET entry_tax_mode = 'included', updated_at = now()
--       FROM public.leagues l JOIN public.profile pr ON pr.id = l.organizer_id
--      WHERE l.id = s.league_id AND pr.is_house_organizer
--        AND s.entry_tax_mode = 'none';
--     GET DIAGNOSTICS v_flipped_s = ROW_COUNT;
--
--     -- 3b. Rejouer le calcul sur ce qui est DÉJÀ dans le grand livre, tous
--     -- statuts confondus : une ligne remboursée doit aussi montrer la taxe
--     -- perçue puis rendue, le comptable lit refund_amount_cents à côté.
--     -- Le crédit vient en déduction : c'est le montant payé qui porte la taxe.
--     UPDATE public.lt_registration_payment p
--        SET entry_tax_cents = public.compute_entry_tax_cents(
--                                  GREATEST(p.entry_cents - p.credit_applied_cents, 0), 'included'),
--            entry_tax_mode  = 'included',
--            updated_at      = now()
--       FROM public.profile pr
--      WHERE pr.id = p.organizer_id AND pr.is_house_organizer
--        AND p.entry_tax_mode = 'none';
--     GET DIAGNOSTICS v_backfilled = ROW_COUNT;
--
--     INSERT INTO public.leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
--     SELECT 'tournament', t.id, 'set_entry_tax_mode', t.organizer_id,
--            jsonb_build_object('entry_tax_mode', 'included', 'via', 'dashboard_sql')
--       FROM public.tournaments t JOIN public.profile pr ON pr.id = t.organizer_id
--      WHERE pr.is_house_organizer AND t.entry_tax_mode = 'included';
--
--     SELECT COALESCE(SUM(p.entry_tax_cents), 0) INTO v_tax_total
--       FROM public.lt_registration_payment p JOIN public.profile pr ON pr.id = p.organizer_id
--      WHERE pr.is_house_organizer AND p.status = 'succeeded';
--
--     RAISE NOTICE '% tournoi(s) et % saison(s) basculé(s), % ligne(s) rejouée(s), TPS/TVQ sur les paiements réussis : % $',
--                  v_flipped_t, v_flipped_s, v_backfilled, ROUND(v_tax_total / 100.0, 2);
-- END $$;
--
-- -- Contrôle, par événement : le total à déclarer par série, crédits déduits.
-- SELECT COALESCE(t.name, 'saison ' || p.season_id::text) AS evenement,
--        count(*)                                           AS paiements,
--        SUM(p.entry_cents)                                 AS entrees_cents,
--        SUM(p.credit_applied_cents)                        AS credits_cents,
--        SUM(p.entry_tax_cents)                             AS tps_tvq_cents,
--        SUM(p.refund_amount_cents)                         AS rembourse_cents,
--        min(p.created_at)::date                            AS premier_paiement,
--        max(p.created_at)::date                            AS dernier_paiement
--   FROM public.lt_registration_payment p
--   JOIN public.profile pr ON pr.id = p.organizer_id AND pr.is_house_organizer
--   LEFT JOIN public.tournament_registrations r ON r.id = p.tournament_registration_id
--   LEFT JOIN public.tournaments t ON t.id = r.tournament_id
--  WHERE p.status IN ('succeeded', 'refunded')
--  GROUP BY 1
--  ORDER BY premier_paiement;
--
-- COMMIT;

-- ============================================================================
-- VÉRIFICATION. Utile à tout moment.
-- ============================================================================
-- SELECT t.name,
--        t.status,
--        t.pool_size || ' x ' || (t.max_participants / t.pool_size) || ' poules' AS poules,
--        t.qualifiers_per_pool                                                   AS qualifies_par_poule,
--        t.min_rating || ' - ' || COALESCE(t.max_rating::text, '+')              AS bande,
--        (SELECT count(*) FROM public.tournament_registrations r
--           WHERE r.tournament_id = t.id AND r.status = 'registered')            AS inscrits,
--        to_char(t.registration_closes_at AT TIME ZONE 'America/Toronto', 'DD/MM HH24:MI') AS ferme,
--        (SELECT string_agg(
--                  d.bracket_side || '/' || d.round_number || '=' ||
--                  to_char(d.deadline_at AT TIME ZONE 'America/Toronto', 'DD/MM'),
--                  ', ' ORDER BY d.bracket_side DESC, d.round_number)
--           FROM public.tournament_round_deadlines d
--          WHERE d.tournament_id = t.id)                                         AS echeances
--   FROM public.tournaments t
--  WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
--  ORDER BY t.min_rating;
