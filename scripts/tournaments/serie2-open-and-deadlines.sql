-- ============================================================================
-- Série 2 — ouvrir les inscriptions, puis caler les échéances du plan
--
-- La CRÉATION des tournois vit dans la migration
-- 20260812280000_seed_serie2_paid_tournaments.sql. Ce fichier ne porte que les
-- deux gestes qu'une migration ne peut pas porter, parce qu'ils dépendent
-- d'une date et d'un tirage, pas du schéma:
--
--   ÉTAPE 1  ouvrir les inscriptions          -> le 13 août
--   ÉTAPE 2  poser les échéances de tours     -> après chaque tirage
--
-- À coller dans le SQL Editor du dashboard, une étape à la fois.
-- ============================================================================


-- ============================================================================
-- ÉTAPE 1 : ouvrir les inscriptions. À LANCER LE JEUDI 13 AOÛT, PAS AVANT.
--
-- LE MEILLEUR CHEMIN EST L'APP, PAS CE BLOC. Dans l'app, l'organisateur ouvre
-- via `tournament_open_registration`, qui refuse un événement PAYANT tant que
-- l'organisateur n'a pas de `player_stripe_account` avec `charges_enabled`
-- (erreur PAYOUTS_SETUP_REQUIRED, migration 20260726120000).
--
-- ATTENTION: un UPDATE brut ne passe par AUCUN gate. Le garde-fou ci-dessous
-- rejoue donc la même vérification Stripe à la main. Ne pas le retirer: sans
-- lui on publie un tournoi payant que personne ne peut payer, et chaque
-- inscription échoue chez Stripe avec une erreur opaque.
--
-- Et passer par un UPDATE, jamais par un INSERT au bon statut: le fan-out
-- (`tournament_registration_open_fanout`) et les notifications de cycle de vie
-- (`tournaments_notify_lifecycle`) sont des triggers AFTER UPDATE.
--
-- Le fan-out met une ligne en file dans `tournament_fanout_job`; un worker
-- pg_cron la draine par lots de 250. 3 tournois = 3 jobs, drainés en série.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_org    uuid;
    v_opened integer;
BEGIN
    SELECT DISTINCT organizer_id INTO v_org
      FROM public.tournaments
     WHERE name LIKE 'Série 2 Montréal · Tennis ·%';

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'Aucun tournoi Série 2 tennis: la migration 20260812280000 a-t-elle tourné sur cet environnement ?';
    END IF;

    -- Même test que tournament_open_registration: charges_enabled, PAS
    -- onboarding_completed (voir l'en-tête de 20260726120000).
    IF NOT EXISTS (
        SELECT 1 FROM public.player_stripe_account
         WHERE player_id = v_org AND charges_enabled
    ) THEN
        RAISE EXCEPTION
            'PAYOUTS_SETUP_REQUIRED: l''organisateur n''a pas de compte Stripe Connect avec charges_enabled. Terminer l''onboarding Express avant d''ouvrir.';
    END IF;

    UPDATE public.tournaments
       SET status     = 'registration_open',
           version    = version + 1,
           updated_at = now()
     WHERE name LIKE 'Série 2 Montréal · Tennis ·%'
       AND status = 'draft';

    GET DIAGNOSTICS v_opened = ROW_COUNT;

    -- Le RPC en écrit une; l'UPDATE brut ne le ferait pas.
    INSERT INTO public.leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_after)
    SELECT 'tournament', t.id, 'open_registration', v_org,
           jsonb_build_object('status', t.status, 'via', 'dashboard_sql')
      FROM public.tournaments t
     WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
       AND t.status = 'registration_open';

    RAISE NOTICE '% tournoi(s) ouvert(s).', v_opened;
END $$;

-- Doit renvoyer 3 lignes 'pending'.
SELECT j.id, t.name, j.status, j.notified_count
  FROM public.tournament_fanout_job j
  JOIN public.tournaments t ON t.id = j.tournament_id
 WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
 ORDER BY j.id;

COMMIT;


-- ============================================================================
-- ÉTAPE 2 : caler les échéances exactes du doc. APRÈS CHAQUE TIRAGE.
--
-- `tournament_generate_pools` et `tournament_generate_knockout` posent des
-- échéances par défaut au prorata du temps restant À PARTIR DU TIRAGE, pas du
-- départ. Plus le tirage est tardif, plus elles glissent: en prod les poules
-- ont atterri le lundi 7 septembre à 06:45 et 06:49, pas le 2. Ce bloc
-- réécrit les dates du plan. Voir l'ÉTAPE 2-CORRECTIF plus bas.
--
-- Le RPC `tournament_set_round_deadlines` exige un `auth.uid()`, absent du
-- dashboard: on écrit donc directement dans la table.
--
--   2a. après `tournament_generate_pools`     (ligne ('pool', 0), phase entière)
--   2b. après `tournament_generate_knockout`  (main 1..3 = QF, SF, finale)
--
-- LE PLAN TABLAIT SUR UN 32. Le vrai remplissage donne 3 poules (Avancé) et
-- 4 poules (Intermédiaire) de 4, `qualifiers_per_pool` = 2, donc 6 et 8
-- qualifiés: un tableau de 8 des deux côtés, soit TROIS tours, pas quatre.
-- Un 4e tour n'existe pas et ne doit pas être inséré.
-- ============================================================================
-- BEGIN;
--
-- -- 2a. Fin de la phase de poules : mercredi 2 septembre.
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'pool', 0, '2026-09-02 23:59:00 America/Toronto'::timestamptz
--   FROM public.tournaments t
--  WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
-- ON CONFLICT (tournament_id, bracket_side, round_number)
-- DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
--
-- -- 2b. 5 jours par tour éliminatoire, comme promis dans la description.
-- --     Trois tours: la finale tombe le 17, cinq jours avant end_date
-- --     (22 septembre 23:59). Cette marge est voulue, pas un oubli.
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'main', d.round_number, d.deadline_at
--   FROM public.tournaments t
--  CROSS JOIN (VALUES
--        (1::smallint, '2026-09-07 23:59:00 America/Toronto'::timestamptz),  -- quarts
--        (2::smallint, '2026-09-12 23:59:00 America/Toronto'::timestamptz),  -- demies
--        (3::smallint, '2026-09-17 23:59:00 America/Toronto'::timestamptz)   -- finale
--  ) AS d(round_number, deadline_at)
--  WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
--    AND t.status = 'in_progress'   -- le Débutant est annulé
-- ON CONFLICT (tournament_id, bracket_side, round_number)
-- DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
--
-- SELECT t.name, d.bracket_side, d.round_number,
--        d.deadline_at AT TIME ZONE 'America/Toronto' AS echeance
--   FROM public.tournament_round_deadlines d
--   JOIN public.tournaments t ON t.id = d.tournament_id
--  WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
--  ORDER BY t.name, d.bracket_side DESC, d.round_number;
--
-- COMMIT;


-- ============================================================================
-- ÉTAPE 2-RIVES : mêmes échéances pour les tableaux régionaux (seed
-- 20260815100000). Un 16 = 4 poules x 2 qualifiés = 8, soit TROIS tours
-- éliminatoires (quarts, demies, finale), pas quatre. Fin le 17 septembre.
-- ============================================================================
-- BEGIN;
--
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'pool', 0, '2026-09-02 23:59:00 America/Toronto'::timestamptz
--   FROM public.tournaments t
--  WHERE t.name LIKE 'Série 2 Rive-%'
-- ON CONFLICT (tournament_id, bracket_side, round_number)
-- DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
--
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'main', d.round_number, d.deadline_at
--   FROM public.tournaments t
--  CROSS JOIN (VALUES
--        (1::smallint, '2026-09-07 23:59:00 America/Toronto'::timestamptz),  -- quarts
--        (2::smallint, '2026-09-12 23:59:00 America/Toronto'::timestamptz),  -- demies
--        (3::smallint, '2026-09-17 23:59:00 America/Toronto'::timestamptz)   -- finale
--  ) AS d(round_number, deadline_at)
--  WHERE t.name LIKE 'Série 2 Rive-%'
-- ON CONFLICT (tournament_id, bracket_side, round_number)
-- DO UPDATE SET deadline_at = EXCLUDED.deadline_at, updated_at = now();
--
-- COMMIT;


-- ============================================================================
-- ÉTAPE 2-CORRECTIF : ramener la fin des poules au MERCREDI 2 SEPTEMBRE.
--
-- JOUÉ EN PROD LE 31 AOÛT 2026. Les deux tournois vivants portaient la valeur
-- par défaut du tirage, un lundi 7 septembre à 06:45 et 06:49, alors que leur
-- description et l'annonce promettent le mercredi 2. 21 joueurs notifiés.
-- Gardé ici parce que le cas se represente à chaque tirage tardif.
--
-- LE MEILLEUR CHEMIN EST L'APP, PAS CE BLOC. L'organisateur ouvre le tournoi,
-- puis la feuille des échéances (TournamentDeadlinesSheet), qui appelle
-- `tournament_set_round_deadlines`: audit, notification, et les gardes de
-- 20260825160000. Ce bloc n'existe que pour le dashboard, sans `auth.uid()`.
--
-- ATTENTION À LA FENÊTRE. Ce RPC refuse d'AVANCER une échéance à moins de
-- 48 h (DEADLINE_TOO_SOON). Viser le 2 septembre 23:59 par l'app n'était donc
-- possible que jusqu'au 31 août 23:59. Passé ce moment il ne reste que ce
-- bloc, qui contourne la garde: à n'utiliser qu'en assumant de retirer aux
-- joueurs une fenêtre déjà affichée.
--
-- Le filtre est `status = 'in_progress'` et une ligne de poules qui EXISTE
-- DÉJÀ: un INSERT poserait une échéance sur un tournoi annulé.
--
-- Un UPDATE brut ne notifie personne et n'audite rien. On rejoue donc les deux
-- gestes du RPC, pour les seuls tournois réellement déplacés. Idempotent:
-- relancer ne renotifie pas.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_cible timestamptz := '2026-09-02 23:59:00 America/Toronto';
    v_id    uuid;
    v_org   uuid;
    v_n     integer := 0;
BEGIN
    FOR v_id IN
        SELECT t.id
          FROM public.tournaments t
          JOIN public.tournament_round_deadlines d
            ON d.tournament_id = t.id
           AND d.bracket_side  = 'pool'
           AND d.round_number  = 0
         WHERE t.entry_fee_cents > 0
           AND t.status = 'in_progress'
           AND d.deadline_at IS DISTINCT FROM v_cible
         ORDER BY t.name
    LOOP
        -- Une échéance atteinte est gelée: la poule est décidée, on ne
        -- réécrit pas l'horloge (principe 7 de la spec, 20260825160000).
        IF EXISTS (
            SELECT 1 FROM public.tournament_round_deadlines
             WHERE tournament_id = v_id AND bracket_side = 'pool'
               AND round_number = 0 AND deadline_at <= now()
        ) THEN
            RAISE EXCEPTION 'Poules déjà échues sur %: passer par un override, pas par la date.', v_id;
        END IF;

        UPDATE public.tournament_round_deadlines
           SET deadline_at = v_cible, updated_at = now()
         WHERE tournament_id = v_id AND bracket_side = 'pool' AND round_number = 0;

        SELECT organizer_id INTO v_org FROM public.tournaments WHERE id = v_id;

        INSERT INTO public.leagues_tournaments_audit
            (scope, entity_id, action, actor_id, payload_after)
        VALUES ('tournament', v_id, 'set_round_deadlines', v_org,
                jsonb_build_array(jsonb_build_object(
                    'bracket_side', 'pool',
                    'round_number', 0,
                    'deadline_at',  v_cible,
                    'via',          'mcp_sql')));

        -- Sans ça, personne n'apprend que la date a bougé.
        PERFORM public.lt_notify_tournament_deadline_changed(v_id, 'pool', '{0}'::smallint[]);

        v_n := v_n + 1;
    END LOOP;

    RAISE NOTICE '% tournoi(s) ramené(s) au 2 septembre.', v_n;
END $$;

-- Une ligne au 2026-09-02 23:59 par tournoi vivant, et le compte des poussées.
SELECT t.name,
       to_char(d.deadline_at AT TIME ZONE 'America/Toronto', 'YYYY-MM-DD Dy HH24:MI') AS fin_des_poules,
       (SELECT count(*) FROM public.notification n
         WHERE n.type = 'tournament_deadline_changed' AND n.target_id = t.id
           AND n.created_at > now() - interval '10 minutes')                          AS notifs_envoyees
  FROM public.tournaments t
  JOIN public.tournament_round_deadlines d
    ON d.tournament_id = t.id AND d.bracket_side = 'pool' AND d.round_number = 0
 WHERE t.entry_fee_cents > 0 AND t.status = 'in_progress'
 ORDER BY t.name;

COMMIT;


-- ============================================================================
-- VÉRIFICATION. Utile à tout moment.
-- ============================================================================
-- SELECT t.name,
--        t.status,
--        t.bracket_type,
--        t.pool_size || ' x ' || (t.max_participants / t.pool_size) AS poules,
--        t.min_rating || ' - ' || COALESCE(t.max_rating::text, '+')  AS bande,
--        (t.entry_fee_cents / 100.0)   AS entree_dollars,
--        (t.prize_money_cents / 100.0) AS bourse_dollars,
--        q.total_cents / 100.0         AS joueur_paie_dollars,
--        t.registration_opens_at AT TIME ZONE 'America/Toronto' AS ouverture,
--        t.start_date            AT TIME ZONE 'America/Toronto' AS debut,
--        t.end_date              AT TIME ZONE 'America/Toronto' AS fin,
--        t.logo_url
--   FROM public.tournaments t
--   LEFT JOIN LATERAL public.tournament_fee_quote(t.id) q ON true
--  WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
--  ORDER BY t.min_rating;
