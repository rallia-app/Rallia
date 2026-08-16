-- ============================================================================
-- Seed — Série 2 Rive-Nord / Rive-Sud · Tennis · Intermédiaire (payants)
-- ----------------------------------------------------------------------------
-- Les versions payantes des deux seuls tableaux régionaux qui ont vécu en
-- Série 1 : hors île, seul l'Intermédiaire a trouvé son monde (8 joueurs
-- Rive-Nord, 6 Rive-Sud); Débutant et Avancé y sont morts à 0-3 inscrits.
-- Décision du 15 août : Intermédiaire seulement, tableau de 16 (4 poules de
-- 4, qualifiés en quarts), même calendrier que Montréal.
--
-- La bourse garde le ratio Montréal (~52 % des frais perçus) à l'échelle du
-- tableau : plafond 125 $ pour 16 joueurs, au prorata des inscriptions
-- payées (125 $ x inscriptions / 16, arrondi aux 5 $), part du champion 60 %.
-- prize_is_prorated + prize_top_share_bps portent la lecture côté client.
--
-- Frais de service à 0 %, comme les tableaux Montréal (décision du 14 août,
-- constatée sur prod) : le joueur paie 15 $ pile.
--
-- Géo : coordonnées du centre de chaque rive, pour que le fan-out d'ouverture
-- cible les joueurs de la rive (rayon LEAST(max_travel, 50) km). Les
-- intermédiaires proches du fleuve recevront une 2e notification après celle
-- de Montréal : assumé, un tableau local est une information nouvelle.
--
-- Fin : 17 septembre. 16 joueurs = 3 tours éliminatoires (quarts, demies,
-- finale) à 5 jours, après la fin de poules du 2 septembre — pas 4 tours
-- comme Montréal. Les échéances exactes se posent après chaque tirage
-- (scripts/tournaments/serie2-open-and-deadlines.sql, variante rives).
--
-- ORGANISATEUR : le compte maison contact@rallia.ca (les événements Rallia
-- règlent dans le compte Connect de l'entreprise, jamais dans celui d'un
-- fondateur — voir la note house-organizer du 14 août). Repli sur
-- jdl.sonkin@gmail.com quand le compte maison n'existe pas (staging), NO-OP si
-- ni l'un ni l'autre. L'organisateur résolu est certifié d'office : sans
-- is_certified_organizer, l'ouverture notifierait ZÉRO joueur, silencieusement.
-- Jean et Mathis sont ajoutés co-organisateurs quand leurs comptes existent.
-- Les bannières restent dans le dossier storage de Jean (c'est là que
-- upload-serie2-banners.mjs les pose), peu importe l'organisateur.
--
-- Même contrat que le seed Montréal (20260812280000) : résolution par clés
-- stables, idempotent par nom, bannières vérifiées en WARNING jamais en échec,
-- créés en DRAFT — l'ouverture passe par l'app, qui vérifie le Stripe de
-- l'organisateur.
-- ============================================================================

DO $$
DECLARE
    c_house_email      text := 'contact@rallia.ca';
    c_jdl_email        text := 'jdl.sonkin@gmail.com';
    c_mathis_email     text := 'lefrancmathis@gmail.com';
    c_entry_fee_cents  integer := 1500;
    c_prize_cents      integer := 12500;   -- plafond pour un 16 complet
    c_refund_kind      refund_policy_kind_enum := 'full';
    c_storage_base     text := 'https://ncewkeoohdkpbcovbppd.supabase.co/storage/v1/object/public/tournament-logos/';

    c_opens   timestamptz := '2026-08-15 09:00:00 America/Toronto';
    c_closes  timestamptz := '2026-08-21 23:59:00 America/Toronto';
    c_start   timestamptz := '2026-08-22 08:00:00 America/Toronto';
    -- Poules jusqu'au 2 septembre, puis quarts 7, demies 12, finale 17 sept.
    c_end     timestamptz := '2026-09-17 23:59:00 America/Toronto';

    v_org      uuid;
    v_house    uuid;
    v_jdl      uuid;
    v_mathis   uuid;
    v_banner_owner uuid;
    v_tennis   uuid;
    v_created  integer := 0;
    v_missing  integer := 0;
    v_banner   text;
    v_zone     record;
BEGIN
    SELECT id INTO v_tennis FROM public.sport WHERE name = 'tennis';

    SELECT p.id INTO v_house FROM public.player p
      JOIN public.profile pr ON pr.id = p.id WHERE lower(pr.email) = lower(c_house_email);
    SELECT p.id INTO v_jdl FROM public.player p
      JOIN public.profile pr ON pr.id = p.id WHERE lower(pr.email) = lower(c_jdl_email);
    SELECT p.id INTO v_mathis FROM public.player p
      JOIN public.profile pr ON pr.id = p.id WHERE lower(pr.email) = lower(c_mathis_email);

    v_org := COALESCE(v_house, v_jdl);
    v_banner_owner := COALESCE(v_jdl, v_org);

    IF v_org IS NULL OR v_tennis IS NULL THEN
        RAISE NOTICE 'Seed Série 2 régional ignoré: sport tennis ou organisateur absent.';
        RETURN;
    END IF;

    -- Sans certification, le fan-out d'ouverture ne notifie personne, sans erreur.
    UPDATE public.player
       SET is_certified_organizer = true,
           certified_organizer_at = COALESCE(certified_organizer_at, now())
     WHERE id = v_org AND is_certified_organizer = false;

    IF EXISTS (SELECT 1 FROM public.tournaments WHERE name LIKE 'Série 2 Rive-%') THEN
        RAISE NOTICE 'Série 2 régionale déjà présente; seed ignoré.';
        RETURN;
    END IF;

    FOREACH v_banner IN ARRAY ARRAY[
        'serie2-rive-nord-tennis-intermediaire-v1.webp',
        'serie2-rive-sud-tennis-intermediaire-v1.webp'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM storage.objects
             WHERE bucket_id = 'tournament-logos'
               AND name = v_banner_owner || '/' || v_banner
        ) THEN
            v_missing := v_missing + 1;
            RAISE WARNING 'Bannière % absente du bucket tournament-logos.', v_banner;
        END IF;
    END LOOP;

    FOR v_zone IN
        SELECT * FROM (VALUES
            ('Série 2 Rive-Nord · Tennis · Intermédiaire',
             'Laval & Rive-Nord',
             'Round Robin payant sur la Rive-Nord. 4 poules de 4, puis élimination directe à partir des quarts de finale. Catégorie Intermédiaire (niveau 3.0 à 3.5). Entrée 15 $, bourse jusqu''à 125 $ selon le nombre d''inscriptions.',
             'serie2-rive-nord-tennis-intermediaire-v1.webp',
             45.6066::double precision, -73.7124::double precision,
             'Lieu : Laval et la Rive-Nord. Terrain à convenir entre les 2 joueurs, à leur charge.')
          , ('Série 2 Rive-Sud · Tennis · Intermédiaire',
             'Rive-Sud',
             'Round Robin payant sur la Rive-Sud. 4 poules de 4, puis élimination directe à partir des quarts de finale. Catégorie Intermédiaire (niveau 3.0 à 3.5). Entrée 15 $, bourse jusqu''à 125 $ selon le nombre d''inscriptions.',
             'serie2-rive-sud-tennis-intermediaire-v1.webp',
             45.5312::double precision, -73.5181::double precision,
             'Lieu : Rive-Sud. Terrain à convenir entre les 2 joueurs, à leur charge.')
        ) AS z(name, city, description, banner, lat, lon, lieu_line)
    LOOP
        INSERT INTO public.tournaments (
            name, description, rules, logo_url, sport_id, organizer_id,
            organizer_display_name,
            visibility, registration_mode, status,
            level, categories, min_rating, max_rating,
            city, latitude, longitude,
            max_participants, bracket_type, pool_size, qualifiers_per_pool,
            match_format, games_per_set, final_set_tiebreak,
            entry_format, seeding_enabled, max_seeds,
            entry_fee_cents, currency, fee_payer, prize_money_cents,
            prize_is_prorated, prize_top_share_bps,
            fee_pct_bps_override, fee_flat_cents_override,
            refund_policy_kind, refund_cutoff_at,
            registration_opens_at, registration_closes_at, start_date, end_date
        )
        VALUES (
            v_zone.name,
            v_zone.description,
            concat_ws(E'\n',
                'Format : Round Robin en poules, 4 poules de 4 joueurs, puis élimination directe à partir des quarts de finale.',
                'Poules : 3 parties par joueur. Les 2 premiers de chaque poule se qualifient.',
                'Sets : 1 set en 8 jeux gagnants, écart de 2 jeux, tie-break à 8-8. Finale en 2 sets gagnants avec super tie-break à 10 points si un set partout.',
                'Balles : chaque joueur apporte une boîte neuve, un tirage à pile ou face détermine laquelle est ouverte.',
                'Délais : la phase de poules se termine le mercredi 2 septembre. Ensuite, 5 jours par tour éliminatoire, non négociables. Le calendrier complet est affiché dans l''app.',
                v_zone.lieu_line,
                'Score : le vainqueur entre le score, le perdant l''approuve.',
                'Météo : si les conditions deviennent mauvaises, arrêtez la partie et reprenez plus tard, le délai du tour reste applicable.',
                'Forfait automatique : partie non jouée dans le délai, joueur injoignable ou indisponible, litige insoluble sur le vainqueur (les 2 forfait), retrait pour blessure ou raison personnelle.',
                'Entrée : 15 $ par joueur.',
                'Bourse : 125 $ pour un tableau complet de 16 joueurs. La bourse suit le nombre d''inscriptions payées, au prorata : 125 $ x (inscriptions / 16), arrondie aux 5 $. Le montant final est confirmé à la fermeture des inscriptions, donc avant le tirage.',
                'Répartition de la bourse : 60 % au champion, 28 % au finaliste, 12 % partagés entre les 2 demi-finalistes. Sur un tableau complet, ça donne 75 $, 35 $ et 7,50 $ chacun.',
                'Remboursement : l''entrée est remboursable jusqu''à la fermeture des inscriptions le 21 août.',
                'Communication : utilisez le chat du tournoi. Contactez l''équipe Rallia en cas de problème majeur.'
            ),
            c_storage_base || v_banner_owner || '/' || v_zone.banner,
            v_tennis, v_org,
            CASE WHEN v_org = v_house THEN 'Rallia' END,
            'public', 'open', 'draft',
            'Intermédiaire', ARRAY['Intermédiaire'], 3.0, 3.5,
            v_zone.city, v_zone.lat, v_zone.lon,
            16, 'pool_knockout', 4, 2,
            'one_set', 8, 'super_tb_10pt',
            'singles', true, 4,
            c_entry_fee_cents, 'CAD', 'player_pays', c_prize_cents,
            true, 6000,
            0, 0,
            c_refund_kind, c_closes,
            c_opens, c_closes, c_start, c_end
        );
        v_created := v_created + 1;
    END LOOP;

    -- Les humains gardent la main via tournament_co_organizers.
    INSERT INTO public.tournament_co_organizers (tournament_id, user_id, added_by)
    SELECT t.id, x.uid, v_org
      FROM public.tournaments t
      CROSS JOIN (SELECT unnest(ARRAY[v_jdl, v_mathis]) AS uid) x
     WHERE t.name LIKE 'Série 2 Rive-%'
       AND x.uid IS NOT NULL AND x.uid <> v_org
    ON CONFLICT (tournament_id, user_id) DO NOTHING;

    RAISE NOTICE 'Seed Série 2 régional: % tournois créés en draft (% bannière(s) manquante(s)).',
        v_created, v_missing;
END $$;
