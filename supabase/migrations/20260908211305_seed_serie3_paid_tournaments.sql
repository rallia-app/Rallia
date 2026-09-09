-- ============================================================================
-- Seed: Tournois Rallia · Série 3 (tennis, Montréal, Intermédiaire + Avancé)
-- ----------------------------------------------------------------------------
-- Plan de Jean du 8 septembre, arbitré le même jour. Deux tableaux de 16 sur
-- l'île de Montréal, payants comme la Série 2, mais UN SEUL qualifié par
-- poule au lieu de deux. Ce n'est pas un détail de format, c'est ce qui rend
-- le calendrier jouable, et ça mérite d'être écrit ici parce que la prochaine
-- édition va être tentée de recopier la Série 2.
--
-- ------------------------------------------------------------------------
-- POURQUOI UN SEUL QUALIFIÉ PAR POULE
--
-- La fenêtre de jeu va du 16 septembre au 12 octobre, soit 27 jours, et elle
-- est bornée par du monde réel: les terrains extérieurs de Montréal ferment à
-- la mi-octobre, chaque municipalité à sa date. Après le 12 octobre il n'y a
-- rien, et depuis 20260901030000 une échéance passée ne se déplace plus, même
-- pour l'organisateur.
--
-- Ce qui fixe le rythme, ce n'est pas la taille du tableau, c'est le nombre de
-- parties que joue un finaliste:
--
--   2 qualifiés/poule -> 3 poule + 3 tours = 6 parties -> 4,5 jours par partie
--   1 qualifié/poule  -> 3 poule + 2 tours = 5 parties -> 5,4 jours par partie
--
-- Avec 2 qualifiés, les quarts tombaient du 28 septembre au 2 octobre: lundi
-- au vendredi, AUCUNE fin de semaine, coucher de soleil vers 18 h 30. Quatre
-- parties par tableau à caser en soirée dans la noirceur. Avec 1 qualifié, les
-- deux tours restants ont chacun leur fin de semaine, et la finale a le long
-- congé de l'Action de grâce.
--
-- Passer le tableau à 8 joueurs donnait EXACTEMENT le même calendrier (5
-- parties aussi), pour la moitié du monde et la moitié des entrées. La Série 2
-- montréalaise avait fini à 14 et 10 inscrits: plafonner à 8 aurait refusé du
-- monde. D'où 16 joueurs et 1 qualifié plutôt que 8 joueurs et 2.
--
-- Le prix à payer, assumé: 12 des 16 joueurs terminent après la phase de
-- poules. Le tableau final ne compte que 4 joueurs.
--
-- ------------------------------------------------------------------------
-- CE QUE ÇA DONNE MÉCANIQUEMENT
--
--   16 inscrits -> 4 poules de 4 -> 4 qualifiés -> tableau de 4 -> 2 tours.
--
-- tournament_generate_knockout arrondit le nombre de qualifiés à la puissance
-- de 2 au-dessus. Formes mesurées sur _lt_compute_pool_assignment (pool_size
-- 4), donc si le remplissage est plus mince:
--   13 à 16 inscrits -> 4 poules -> 4 qualifiés -> tableau de 4
--    9 à 12 inscrits -> 3 poules -> 3 qualifiés -> tableau de 4 (1 bye)
--    6 à  8 inscrits -> 2 poules -> 2 qualifiés -> FINALE SEULE
-- Sous 6 inscrits, _lt_compute_pool_assignment lève INSUFFICIENT_PARTICIPANTS
-- et le tirage ne se génère pas du tout. Le seuil de go/no-go est donc 6, et
-- en bas de 9 il ne reste qu'une seule partie d'élimination: c'est le moment
-- d'annuler plutôt que de lancer, comme on l'a fait pour les deux tableaux
-- régionaux de la Série 2.
--
-- ------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS
--
--   1. Elle n'OUVRE PAS les inscriptions: les tournois naissent en `draft`.
--      Ouvrir est daté (9 septembre) et bloqué par Stripe, parce que
--      `tournament_open_registration` refuse un événement payant tant que
--      l'organisateur n'a pas `charges_enabled`. Passer par l'app.
--
--   2. Elle ne pose PAS les échéances de tours: elles dépendent du tirage, qui
--      n'a pas eu lieu. Le générateur en pose par défaut au prorata du temps
--      restant À PARTIR DU TIRAGE, ce qui ne correspond jamais à ce qui est
--      annoncé ici. En Série 2 la fin des poules avait atterri 5 jours après
--      la date promise. Les corriger dans la MÊME HEURE que le tirage, par la
--      feuille des échéances dans l'app.
--
--      Cibles: poules 27 septembre, demi-finales 4 octobre, finale 12 octobre,
--      toutes à 23:59, heure de Montréal.
--
--   3. Elle ne téléverse PAS les bannières: le storage ne voyage pas par
--      migration. Bannière manquante = AVERTISSEMENT, jamais un échec.
--
-- PAS DE CHANGEMENT DE SCHÉMA: aucune régénération de types à committer.
-- Idempotent: une fois la Série 3 présente, rejouer ne fait rien.
-- ============================================================================

DO $$
DECLARE
    c_house_email      text := 'contact@rallia.ca';
    c_jdl_email        text := 'jdl.sonkin@gmail.com';
    c_mathis_email     text := 'lefrancmathis@gmail.com';

    c_entry_fee_cents  integer := 1500;    -- 15 $, comme la Série 2
    c_prize_cents      integer := 12500;   -- 125 $, plafond pour un 16 complet
    c_refund_kind      refund_policy_kind_enum := 'full';

    -- L'hôte est cosmétique: normalizeStorageUrl ne garde que le chemin après
    -- /tournament-logos/ et le recolle sur l'URL Supabase de l'environnement.
    c_storage_base     text := 'https://ncewkeoohdkpbcovbppd.supabase.co/storage/v1/object/public/tournament-logos/';

    c_city             text := 'Île de Montréal';
    c_lat              double precision := 45.5019;
    c_lon              double precision := -73.5674;

    -- Calendrier arbitré, en heure de Montréal.
    c_opens   timestamptz := '2026-09-09 09:00:00 America/Toronto';  -- mercredi
    c_closes  timestamptz := '2026-09-15 23:59:00 America/Toronto';  -- veille du départ
    c_start   timestamptz := '2026-09-16 08:00:00 America/Toronto';  -- mercredi
    -- Poules jusqu'au dimanche 27 septembre, demies dimanche 4 octobre,
    -- finale lundi 12 octobre (Action de grâce). Chaque tour a sa fin de
    -- semaine; c'est voulu, pas un hasard de calcul.
    c_end     timestamptz := '2026-10-12 23:59:00 America/Toronto';

    v_org          uuid;
    v_house        uuid;
    v_jdl          uuid;
    v_mathis       uuid;
    v_banner_owner uuid;
    v_tennis       uuid;
    v_created      integer := 0;
    v_missing      integer := 0;
    v_banner       text;
    v_draw         record;
BEGIN
    SELECT id INTO v_tennis FROM public.sport WHERE name = 'tennis';

    -- Le compte maison n'a pas le même courriel selon l'environnement
    -- (prod contact@rallia.ca, staging/local system@rallia.app), mais
    -- `is_house_organizer` n'est posé que sur un seul profil par
    -- environnement (20260826120000 + 20260826123000). C'est donc la clé
    -- juste; le courriel ne sert que de filet si le drapeau manque.
    SELECT p.id INTO v_house FROM public.player p
      JOIN public.profile pr ON pr.id = p.id WHERE pr.is_house_organizer
      ORDER BY pr.created_at LIMIT 1;

    IF v_house IS NULL THEN
        SELECT p.id INTO v_house FROM public.player p
          JOIN public.profile pr ON pr.id = p.id WHERE lower(pr.email) = lower(c_house_email);
    END IF;

    SELECT p.id INTO v_jdl FROM public.player p
      JOIN public.profile pr ON pr.id = p.id WHERE lower(pr.email) = lower(c_jdl_email);
    SELECT p.id INTO v_mathis FROM public.player p
      JOIN public.profile pr ON pr.id = p.id WHERE lower(pr.email) = lower(c_mathis_email);

    -- Rallia est marchand de plein droit sur ses propres événements payants;
    -- l'argent ne doit pas transiter par le compte perso d'un fondateur.
    v_org := COALESCE(v_house, v_jdl);
    v_banner_owner := COALESCE(v_jdl, v_org);

    IF v_org IS NULL OR v_tennis IS NULL THEN
        RAISE NOTICE 'Seed Série 3 ignoré: sport tennis ou organisateur absent de cet environnement.';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.tournaments WHERE name LIKE 'Série 3 Montréal · Tennis ·%') THEN
        RAISE NOTICE 'Série 3 déjà présente; seed ignoré.';
        RETURN;
    END IF;

    -- Sans certification, tg_enqueue_tournament_registration_fanout n'enfile
    -- rien: on ouvrirait les inscriptions en notifiant ZÉRO joueur, sans
    -- erreur et sans trace dans les logs.
    UPDATE public.player
       SET is_certified_organizer = true,
           certified_organizer_at = COALESCE(certified_organizer_at, now())
     WHERE id = v_org AND is_certified_organizer = false;

    FOREACH v_banner IN ARRAY ARRAY[
        'serie3-montreal-tennis-intermediaire-v1.webp',
        'serie3-montreal-tennis-avance-v1.webp'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'tournament-logos'
               AND name = v_banner_owner || '/' || v_banner
        ) THEN
            v_missing := v_missing + 1;
            RAISE WARNING
                'Bannière % absente du bucket tournament-logos: la carte s''affichera nue.',
                v_banner;
        END IF;
    END LOOP;

    -- ------------------------------------------------------------------
    -- Bandes de niveau. Depuis 20260725120000 la bande est un gate DUR sur
    -- les 4 chemins d'inscription, et un joueur NON COTÉ est refusé dès
    -- qu'une borne est posée. Un 3.5 ne peut donc pas monter en Avancé.
    -- Le Débutant est volontairement absent: 1 seul inscrit payant en
    -- Série 2, tableau annulé.
    -- ------------------------------------------------------------------
    FOR v_draw IN
        SELECT * FROM (VALUES
            ('Série 3 Montréal · Tennis · Intermédiaire',
             'Intermédiaire', 3.0::numeric, 3.5::numeric,
             'Round Robin payant sur l''île de Montréal. 4 poules de 4, puis demi-finales et finale. Catégorie Intermédiaire (niveau 3.0 à 3.5). Entrée 15 $, bourse jusqu''à 125 $ selon le nombre d''inscriptions.',
             'serie3-montreal-tennis-intermediaire-v1.webp')
          , ('Série 3 Montréal · Tennis · Avancé',
             'Avancé', 4.0::numeric, NULL::numeric,
             'Round Robin payant sur l''île de Montréal. 4 poules de 4, puis demi-finales et finale. Catégorie Avancé (niveau 4.0 et plus). Entrée 15 $, bourse jusqu''à 125 $ selon le nombre d''inscriptions.',
             'serie3-montreal-tennis-avance-v1.webp')
        ) AS d(name, level, min_rating, max_rating, description, banner)
    LOOP
        INSERT INTO public.tournaments (
            name, description, rules, logo_url, sport_id, organizer_id,
            organizer_display_name,
            visibility, registration_mode, status,
            level, categories, min_rating, max_rating,
            city, latitude, longitude,
            max_participants, bracket_type, pool_size, qualifiers_per_pool,
            match_format, games_per_set, final_set_tiebreak,
            entry_format, seeding_enabled, max_seeds, seeding_mode,
            entry_fee_cents, currency, fee_payer, prize_money_cents,
            prize_is_prorated, prize_top_share_bps,
            fee_pct_bps_override, fee_flat_cents_override,
            refund_policy_kind, refund_cutoff_at,
            registration_opens_at, registration_closes_at, start_date, end_date
        )
        VALUES (
            v_draw.name,
            v_draw.description,
            concat_ws(E'\n',
                'Format : Round Robin en poules, 4 poules de 4 joueurs, puis demi-finales et finale.',
                'Poules : 3 parties par joueur. Le premier de chaque poule se qualifie.',
                'Sets : 1 set en 8 jeux gagnants, écart de 2 jeux, tie-break à 8-8. Finale en 2 sets gagnants avec super tie-break à 10 points si un set partout.',
                'Balles : chaque joueur apporte une boîte neuve, un tirage à pile ou face détermine laquelle est ouverte.',
                'Délais : la phase de poules se termine le dimanche 27 septembre. Ensuite une semaine par tour : demi-finales le dimanche 4 octobre, finale le lundi 12 octobre. Le calendrier complet est affiché dans l''app.',
                'Fermeture des terrains : les terrains extérieurs ferment à la mi-octobre à Montréal. Le calendrier ne laisse aucune marge après le 12 octobre, et une échéance passée ne se déplace plus.',
                'Lieu : île de Montréal. Les joueurs de la Rive-Nord et de la Rive-Sud peuvent s''inscrire, mais les parties se jouent sur l''île. Terrain à convenir entre les 2 joueurs, à leur charge.',
                'Score : le gagnant entre le score, et il est final dès qu''il est entré. L''adversaire a 48 heures pour le contester si quelque chose cloche.',
                'Météo : si les conditions deviennent mauvaises, arrêtez la partie et reprenez plus tard. Le délai du tour reste applicable.',
                'Forfait : une partie non jouée dans le délai se règle à l''échéance. Un forfait compte comme une défaite dans la poule, mais ne touche jamais ta cote ni tes points Rallia.',
                'Entrée : 15 $ par joueur.',
                'Bourse : 125 $ pour un tableau complet de 16 joueurs. La bourse suit le nombre d''inscriptions payées, au prorata : 125 $ x (inscriptions / 16), arrondie aux 5 $. Le montant final est confirmé à la fermeture des inscriptions, donc avant le tirage.',
                'Répartition de la bourse : 60 % au champion, 28 % au finaliste, 12 % partagés entre les 2 demi-finalistes. Sur un tableau complet, ça donne 75 $, 35 $ et 7,50 $ chacun.',
                'Comme un seul joueur sort de chaque poule, le tableau final ne compte que 4 joueurs : les 4 qualifiés touchent donc tous une part de la bourse.',
                'Remboursement : l''entrée est remboursable jusqu''à la fermeture des inscriptions le 15 septembre. Les frais de service ne sont pas remboursables.',
                'Communication : utilisez le chat du tournoi. Contactez l''équipe Rallia en cas de problème majeur.'
            ),
            c_storage_base || v_banner_owner || '/' || v_draw.banner,
            v_tennis, v_org,
            CASE WHEN v_org = v_house THEN 'Rallia' END,
            'public', 'open', 'draft',
            v_draw.level, ARRAY[v_draw.level], v_draw.min_rating, v_draw.max_rating,
            c_city, c_lat, c_lon,
            -- 4 poules de 4, UN qualifié par poule: voir l'en-tête.
            16, 'pool_knockout', 4, 1,
            'one_set', 8, 'super_tb_10pt',
            -- 4 têtes de série = une par poule, ce qu'attend le serpentin.
            'singles', true, 4, 'circuit',
            c_entry_fee_cents, 'CAD', 'player_pays', c_prize_cents,
            true, 6000,
            -- Rallia des deux côtés: un application_fee non nul reviendrait à
            -- se facturer soi-même et à remettre la TPS/TVQ sur sa propre
            -- fourniture. Zéro n'est pas NULL, et NULL retomberait sur 5 %.
            0, 0,
            c_refund_kind, c_closes,
            c_opens, c_closes, c_start, c_end
        );
        v_created := v_created + 1;
    END LOOP;

    -- Les humains gardent publish/edit/score sans être marchand de plein droit.
    INSERT INTO public.tournament_co_organizers (tournament_id, user_id, added_by)
    SELECT t.id, x.uid, v_org
      FROM public.tournaments t
      CROSS JOIN (SELECT unnest(ARRAY[v_jdl, v_mathis]) AS uid) x
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
       AND x.uid IS NOT NULL AND x.uid <> v_org
    ON CONFLICT (tournament_id, user_id) DO NOTHING;

    RAISE NOTICE 'Seed Série 3: % tournois créés en draft (% bannière(s) manquante(s)).',
        v_created, v_missing;
END $$;
