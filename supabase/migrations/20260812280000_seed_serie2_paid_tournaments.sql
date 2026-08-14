-- ============================================================================
-- Seed — Tournois Rallia · Série 2 (tennis, Débutant / Intermédiaire / Avancé)
-- ----------------------------------------------------------------------------
-- Source: Google Drive "Plan_Tournoi_Payant_Rallia.docx" (Édition Série 2).
-- Première édition PAYANTE, et premier usage de `pool_knockout` hors fixtures:
-- Round Robin en 8 poules de 4, 2 qualifiés par poule, puis élimination
-- directe des 8es à la finale. Tableau de 32, entrée 15 $, bourse 250 $.
--
-- Le doc prévoit aussi le pickleball; décision du 2026-08-12: tennis d'abord.
-- En l'ajoutant, NE PAS RECOPIER LE PLANCHER DU DÉBUTANT TENNIS: les deux
-- sports n'ont pas la même échelle. Le tennis est en NTRP (1.5 -> 6.0), le
-- pickleball en DUPR (1.0 -> 6.0). Le Débutant pickleball part donc bien de
-- 1.0 comme l'écrit le doc; c'est le tennis qui ne peut pas descendre sous
-- 1.5. Voir le commentaire sur les bandes plus bas: un plancher hors échelle
-- ne lève pas d'erreur, il fausse silencieusement les points Rallia.
--
-- Comme le seed Série 1 (20260717120000), cette migration tourne sur TOUS les
-- environnements et résout ses références par clés STABLES, jamais par UUID:
--   * sport      -> name = 'tennis'
--   * organisateur -> profile.email = 'jdl.sonkin@gmail.com'
-- Si l'organisateur n'existe pas (local neuf, CI), le bloc NO-OP et l'env
-- reste vert. Il ne se matérialise que là où le compte existe (staging + prod).
-- Idempotent: une fois la Série 2 tennis présente, re-jouer ne fait rien.
--
-- ORDRE. Ce fichier trie APRÈS 20260810170000..20260812150000, donc
-- `pool_knockout`, `pool_size`, `qualifiers_per_pool` et les générateurs sont
-- garantis présents quand il s'exécute. C'est tout l'intérêt d'en faire une
-- migration plutôt qu'un script de dashboard: local -> staging -> prod
-- s'appliquent dans le même ordre, sans pré-requis à vérifier à la main.
--
-- PAS DE CHANGEMENT DE SCHÉMA: aucune régénération de types à committer.
--
-- ------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET POURQUOI
--
--   1. Elle n'OUVRE PAS les inscriptions. Les tournois naissent en `draft`.
--      Ouvrir est une décision datée (13 août) ET bloquée par Stripe:
--      `tournament_open_registration` refuse un événement payant tant que
--      l'organisateur n'a pas `charges_enabled` (20260726120000). Ouvrir
--      depuis l'app, ou à défaut par scripts/tournaments/serie2-open-and-deadlines.sql
--      qui rejoue le même gate.
--
--   2. Elle ne pose PAS les échéances de tours. Elles dépendent du tirage, qui
--      n'a pas eu lieu. Même script compagnon, étape 2.
--
--   3. Elle ne téléverse PAS les bannières: le storage ne voyage pas par
--      migration. Il faut avoir lancé, sur CHAQUE environnement:
--        node scripts/tournaments/upload-serie2-banners.mjs <staging|prod> <dir>
--      Bannières manquantes = AVERTISSEMENT, pas échec. Faire échouer un
--      déploiement prod sur un .webp oublié serait pire que la carte nue, et
--      logo_url se corrige après coup par un UPDATE d'une ligne.
--
-- L'HÔTE DANS logo_url EST COSMÉTIQUE. Les deux seuls lecteurs (TournamentBanner
-- et apps/web/app/api/og/invite) passent par getTournamentLogoUrl ->
-- normalizeStorageUrl, qui extrait le chemin après /tournament-logos/ et le
-- recolle sur l'URL Supabase de l'environnement courant. Seul le CHEMIN compte,
-- et il porte l'id de l'organisateur, qui lui est résolu à l'exécution.
-- ============================================================================

DO $$
DECLARE
    c_organizer_email  text := 'jdl.sonkin@gmail.com';
    c_city             text := 'Île de Montréal';
    -- Centre-ville. Le fan-out d'ouverture cible LEAST(max_travel, 50) km
    -- autour de ce point: couvre Laval et la Rive-Sud, conforme au doc.
    c_lat              double precision := 45.5019;
    c_lon              double precision := -73.5674;

    c_entry_fee_cents  integer := 1500;    -- 15 $
    c_prize_cents      integer := 25000;   -- 250 $

    -- Le doc ne tranche pas le remboursement. Choix retenu: entrée remboursable
    -- jusqu'à la fermeture des inscriptions. Les frais de service Rallia
    -- (5 %, plafond 20 $) ne sont JAMAIS remboursés.
    c_refund_kind      refund_policy_kind_enum := 'full';

    -- 8 têtes de série = une par poule, ce qu'attend la répartition serpentin.
    c_max_seeds        smallint := 8;

    -- Voir l'en-tête: l'hôte est réécrit par normalizeStorageUrl côté client.
    c_storage_base     text := 'https://ncewkeoohdkpbcovbppd.supabase.co/storage/v1/object/public/tournament-logos/';

    -- Calendrier du doc, en heure de Montréal.
    c_opens   timestamptz := '2026-08-13 09:00:00 America/Toronto';  -- jeudi 13 août
    c_closes  timestamptz := '2026-08-21 23:59:00 America/Toronto';  -- veille du départ
    c_start   timestamptz := '2026-08-22 08:00:00 America/Toronto';  -- samedi 22 août
    -- Poules jusqu'au 2 septembre, puis 4 tours à 5 jours: 7, 12, 17, 22 sept.
    c_end     timestamptz := '2026-09-22 23:59:00 America/Toronto';

    v_org      uuid;
    v_tennis   uuid;
    v_created  integer := 0;
    v_missing  integer := 0;
    v_banner   text;

    v_rules text := concat_ws(E'\n',
        'Format : Round Robin en poules, 8 poules de 4 joueurs, puis élimination directe à partir des 8es de finale.',
        'Poules : 3 parties par joueur. Les 2 premiers de chaque poule se qualifient.',
        'Sets : 1 set en 8 jeux gagnants, écart de 2 jeux, tie-break à 8-8. Finale en 2 sets gagnants avec super tie-break à 10 points si un set partout.',
        'Balles : chaque joueur apporte une boîte neuve, un tirage à pile ou face détermine laquelle est ouverte.',
        'Délais : la phase de poules se termine le mercredi 2 septembre. Ensuite, 5 jours par tour éliminatoire, non négociables. Le calendrier complet est affiché dans l''app.',
        'Lieu : île de Montréal. Les joueurs de la Rive-Nord et de la Rive-Sud peuvent s''inscrire, mais les parties se jouent sur l''île. Terrain à convenir entre les 2 joueurs, à leur charge.',
        'Score : le vainqueur entre le score, le perdant l''approuve.',
        'Météo : si les conditions deviennent mauvaises, arrêtez la partie et reprenez plus tard, le délai du tour reste applicable.',
        'Forfait automatique : partie non jouée dans le délai, joueur injoignable ou indisponible, litige insoluble sur le vainqueur (les 2 forfait), retrait pour blessure ou raison personnelle.',
        'Entrée et bourse : 15 $ par joueur, 250 $ de bourse. 150 $ au champion, 70 $ au finaliste, 15 $ à chaque demi-finaliste.',
        'Remboursement : l''entrée est remboursable jusqu''à la fermeture des inscriptions le 21 août. Les frais de service ne sont pas remboursables.',
        'Communication : utilisez le chat du tournoi. Contactez l''équipe Rallia en cas de problème majeur.'
    );
BEGIN
    SELECT id INTO v_tennis FROM public.sport WHERE name = 'tennis';

    SELECT p.id INTO v_org
      FROM public.player p
      JOIN public.profile pr ON pr.id = p.id
     WHERE lower(pr.email) = lower(c_organizer_email);

    IF v_org IS NULL OR v_tennis IS NULL THEN
        RAISE NOTICE 'Seed Série 2 ignoré: sport tennis ou organisateur % absent de cet environnement.', c_organizer_email;
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.tournaments WHERE name LIKE 'Série 2 Montréal · Tennis ·%') THEN
        RAISE NOTICE 'Série 2 tennis déjà présente; seed ignoré.';
        RETURN;
    END IF;

    -- Les points Circuit Rallia n'accrochent que pour un organisateur certifié.
    UPDATE public.player
       SET is_certified_organizer = true,
           certified_organizer_at = COALESCE(certified_organizer_at, now())
     WHERE id = v_org
       AND is_certified_organizer = false;

    -- Bannières: on avertit, on ne bloque pas (voir l'en-tête).
    FOREACH v_banner IN ARRAY ARRAY[
        'serie2-montreal-tennis-debutant-v1.webp',
        'serie2-montreal-tennis-intermediaire-v1.webp',
        'serie2-montreal-tennis-avance-v1.webp'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'tournament-logos'
               AND name = v_org || '/' || v_banner
        ) THEN
            v_missing := v_missing + 1;
            RAISE WARNING
                'Bannière % absente du bucket tournament-logos: la carte s''affichera nue. Lancer upload-serie2-banners.mjs sur cet environnement.',
                v_banner;
        END IF;
    END LOOP;

    -- ------------------------------------------------------------------
    -- Bandes de niveau : Débutant 1.5 a 2.5, Intermédiaire 3.0 a 3.5,
    -- Avancé 4.0 et plus (pas de plafond).
    --
    -- LE DOC DIT 1.0 POUR LE DÉBUTANT. ON NE PEUT PAS: l'échelle tennis
    -- commence a 1.5 (rating_score, rangs 1.5 -> 6.0), 1.0 n'existe pas.
    -- Et un plancher SOUS l'échelle n'est pas inoffensif:
    -- lt_min_rating_level_multiplier compte les échelons <= au plancher,
    -- tombe a 0 échelon, prend sa sortie anticipée `v_rank < 1` et renvoie le
    -- neutre 1.0 -- exactement le multiplicateur de 3.0. Le Débutant et
    -- l'Intermédiaire annonçaient donc le même plafond de 1000 points Rallia.
    -- Avec 1.5 l'échelle redevient monotone: 0.2 (200 pts), 1.0 (1000),
    -- 5.0 (5000). 1.0 n'exclut personne au passage, aucun joueur de tennis ne
    -- peut être coté sous 1.5.
    --
    -- ATTENTION: depuis 20260725120000 la bande est un gate DUR sur les 4
    -- chemins d'inscription, et un joueur NON COTÉ est refusé dès qu'une borne
    -- est posée. Un 2.5 ne peut donc pas monter en Intermédiaire.
    -- ------------------------------------------------------------------
    INSERT INTO public.tournaments (
        name, description, rules, logo_url, sport_id, organizer_id,
        visibility, registration_mode, status,
        level, categories, min_rating, max_rating,
        city, latitude, longitude,
        max_participants, bracket_type, pool_size, qualifiers_per_pool,
        match_format, games_per_set, final_set_tiebreak,
        entry_format, seeding_enabled, max_seeds,
        entry_fee_cents, currency, fee_payer, prize_money_cents,
        refund_policy_kind, refund_cutoff_at,
        registration_opens_at, registration_closes_at, start_date, end_date
    )
    VALUES
    (
        'Série 2 Montréal · Tennis · Débutant',
        'Round Robin payant sur l''île de Montréal. 8 poules de 4, puis élimination directe à partir des 8es de finale. Catégorie Débutant (niveau 1.5 à 2.5). Entrée 15 $, bourse de 250 $.',
        v_rules,
        c_storage_base || v_org || '/serie2-montreal-tennis-debutant-v1.webp',
        v_tennis, v_org,
        'public', 'open', 'draft',
        'Débutant', ARRAY['Débutant'], 1.5, 2.5,
        c_city, c_lat, c_lon,
        32, 'pool_knockout', 4, 2,
        'one_set', 8, 'super_tb_10pt',
        'singles', true, c_max_seeds,
        c_entry_fee_cents, 'CAD', 'player_pays', c_prize_cents,
        c_refund_kind, c_closes,
        c_opens, c_closes, c_start, c_end
    ),
    (
        'Série 2 Montréal · Tennis · Intermédiaire',
        'Round Robin payant sur l''île de Montréal. 8 poules de 4, puis élimination directe à partir des 8es de finale. Catégorie Intermédiaire (niveau 3.0 à 3.5). Entrée 15 $, bourse de 250 $.',
        v_rules,
        c_storage_base || v_org || '/serie2-montreal-tennis-intermediaire-v1.webp',
        v_tennis, v_org,
        'public', 'open', 'draft',
        'Intermédiaire', ARRAY['Intermédiaire'], 3.0, 3.5,
        c_city, c_lat, c_lon,
        32, 'pool_knockout', 4, 2,
        'one_set', 8, 'super_tb_10pt',
        'singles', true, c_max_seeds,
        c_entry_fee_cents, 'CAD', 'player_pays', c_prize_cents,
        c_refund_kind, c_closes,
        c_opens, c_closes, c_start, c_end
    ),
    (
        'Série 2 Montréal · Tennis · Avancé',
        'Round Robin payant sur l''île de Montréal. 8 poules de 4, puis élimination directe à partir des 8es de finale. Catégorie Avancé (niveau 4.0 et plus). Entrée 15 $, bourse de 250 $.',
        v_rules,
        c_storage_base || v_org || '/serie2-montreal-tennis-avance-v1.webp',
        v_tennis, v_org,
        'public', 'open', 'draft',
        'Avancé', ARRAY['Avancé'], 4.0, NULL,
        c_city, c_lat, c_lon,
        32, 'pool_knockout', 4, 2,
        'one_set', 8, 'super_tb_10pt',
        'singles', true, c_max_seeds,
        c_entry_fee_cents, 'CAD', 'player_pays', c_prize_cents,
        c_refund_kind, c_closes,
        c_opens, c_closes, c_start, c_end
    );

    GET DIAGNOSTICS v_created = ROW_COUNT;

    RAISE NOTICE 'Seed Série 2: % tournois créés en draft (organisateur %, % bannière(s) manquante(s)).',
        v_created, c_organizer_email, v_missing;
END $$;
