-- ============================================================================
-- Série 3: revenir à DEUX qualifiés par poule
-- ----------------------------------------------------------------------------
-- Décision de Mathis, 2026-09-08, qui renverse le choix pris quelques heures
-- plus tôt dans 20260908211305. On revient à la forme de la Série 2:
--
--   16 inscrits -> 4 poules de 4 -> 8 qualifiés -> tableau de 8 -> 3 tours
--
-- au lieu de 4 qualifiés, tableau de 4, 2 tours.
--
-- CE QUE ÇA COÛTE, ET C'EST ASSUMÉ. La fenêtre de jeu ne bouge pas: du 16
-- septembre au 12 octobre, 27 jours, bornée par la fermeture des terrains
-- extérieurs. Un finaliste passe de 5 à 6 parties, donc de 5,4 à 4,5 jours par
-- partie. Surtout, le troisième tour revient, et avec lui la fenêtre qui avait
-- motivé le changement:
--
--   quarts   28 septembre au 2 octobre : AUCUNE fin de semaine
--   demies    3 au 7 octobre           : une fin de semaine
--   finale    8 au 12 octobre          : longue fin de semaine (Action de grâce)
--
-- Les quarts sont donc du lundi au vendredi, en octobre, coucher de soleil
-- vers 18 h 30. Quatre parties par tableau à caser en soirée. C'est le risque
-- connu, accepté en connaissance de cause; on le note ici pour que personne ne
-- le rediagnostique comme une surprise en octobre.
--
-- ATTÉNUATION POSSIBLE, à décider au tirage et non ici: poser les échéances à
-- 4, 8 et 12 octobre plutôt qu'à 2, 7 et 12 déplace la seule fenêtre sans fin
-- de semaine des quarts (4 parties) vers les demies (2 parties). Les échéances
-- se posent après le tirage, donc le choix reste ouvert le 16 septembre.
--
-- POURQUOI UNE MIGRATION DE CORRECTION plutôt qu'une édition du seed: le seed
-- est DÉJÀ APPLIQUÉ sur local et sur staging. L'éditer ne le rejouerait nulle
-- part (sa version est déjà dans schema_migrations) et staging garderait 1
-- qualifié pendant que la prod en recevrait 2.
--
-- Le garde-fou: on ne touche RIEN dès qu'un tirage existe. Changer
-- qualifiers_per_pool après la génération des poules réécrirait la promesse
-- sous les joueurs déjà inscrits. Les deux tableaux sont en `draft`, donc ce
-- cas ne se pose pas aujourd'hui, mais la migration doit rester sûre si elle
-- est rejouée plus tard sur un environnement en retard.
--
-- Idempotent: ne touche que les lignes qui portent encore 1 qualifié.
-- PAS DE CHANGEMENT DE SCHÉMA.
-- ============================================================================

DO $$
DECLARE
    v_touched integer := 0;
    v_blocked integer := 0;
BEGIN
    -- Un tirage déjà généré fige le format: on refuse, bruyamment.
    SELECT count(*) INTO v_blocked
      FROM public.tournaments t
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
       AND t.qualifiers_per_pool = 1
       AND EXISTS (SELECT 1 FROM public.tournament_matches m WHERE m.tournament_id = t.id);

    IF v_blocked > 0 THEN
        RAISE EXCEPTION
            'Série 3: % tableau(x) ont déjà un tirage; changer qualifiers_per_pool réécrirait le format sous les inscrits. Reprendre à la main.',
            v_blocked;
    END IF;

    UPDATE public.tournaments t
       SET qualifiers_per_pool = 2,

           -- La carte de découverte annonce le format.
           description = replace(
               t.description,
               '4 poules de 4, puis demi-finales et finale.',
               '4 poules de 4, puis élimination directe à partir des quarts de finale.'
           ),

           rules = regexp_replace(
               replace(
                 replace(
                   replace(
                     t.rules,
                     'Format : Round Robin en poules, 4 poules de 4 joueurs, puis demi-finales et finale.',
                     'Format : Round Robin en poules, 4 poules de 4 joueurs, puis élimination directe à partir des quarts de finale.'
                   ),
                   'Poules : 3 parties par joueur. Le premier de chaque poule se qualifie.',
                   'Poules : 3 parties par joueur. Les 2 premiers de chaque poule se qualifient.'
                 ),
                 'Délais : la phase de poules se termine le dimanche 27 septembre. Ensuite une semaine par tour : demi-finales le dimanche 4 octobre, finale le lundi 12 octobre.',
                 'Délais : la phase de poules se termine le dimanche 27 septembre. Ensuite 5 jours par tour : quarts de finale le vendredi 2 octobre, demi-finales le mercredi 7 octobre, finale le lundi 12 octobre.'
               ),
               -- Cette ligne devient FAUSSE avec 8 qualifiés: seuls 4 d'entre
               -- eux touchent la bourse. On la retire, saut de ligne compris.
               E'\nComme un seul joueur sort de chaque poule[^\n]*\n?',
               E'\n'
           ),

           version    = t.version + 1,
           updated_at = now()
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
       AND t.qualifiers_per_pool = 1;

    GET DIAGNOSTICS v_touched = ROW_COUNT;

    IF v_touched = 0 THEN
        RAISE NOTICE 'Série 3: rien à faire (déjà 2 qualifiés par poule, ou seed absent de cet environnement).';
    ELSE
        RAISE NOTICE 'Série 3: % tableau(x) repassés à 2 qualifiés par poule.', v_touched;
    END IF;
END $$;
