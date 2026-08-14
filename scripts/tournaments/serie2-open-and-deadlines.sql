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
-- échéances par défaut au prorata du temps restant (la phase de poules prend
-- 3/7 de start -> end_date), ce qui tombe vers le 4 septembre et non le 2. Ce
-- bloc réécrit les dates du plan.
--
-- Le RPC `tournament_set_round_deadlines` exige un `auth.uid()`, absent du
-- dashboard: on écrit donc directement dans la table.
--
--   2a. après `tournament_generate_pools`     (ligne ('pool', 0), phase entière)
--   2b. après `tournament_generate_knockout`  (main 1..4 = 8es, QF, SF, finale)
--
-- Un 5e tour n'existe pas: 8 poules x 2 qualifiés = 16, soit 4 tours.
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
-- -- 2b. 5 jours par tour éliminatoire.
-- INSERT INTO public.tournament_round_deadlines (tournament_id, bracket_side, round_number, deadline_at)
-- SELECT t.id, 'main', d.round_number, d.deadline_at
--   FROM public.tournaments t
--  CROSS JOIN (VALUES
--        (1::smallint, '2026-09-07 23:59:00 America/Toronto'::timestamptz),  -- 8es
--        (2::smallint, '2026-09-12 23:59:00 America/Toronto'::timestamptz),  -- quarts
--        (3::smallint, '2026-09-17 23:59:00 America/Toronto'::timestamptz),  -- demies
--        (4::smallint, '2026-09-22 23:59:00 America/Toronto'::timestamptz)   -- finale
--  ) AS d(round_number, deadline_at)
--  WHERE t.name LIKE 'Série 2 Montréal · Tennis ·%'
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
