-- ============================================================================
-- Série 3 : la promesse de bourse, telle qu'on peut vraiment la tenir
-- ----------------------------------------------------------------------------
-- Relecture du 10 septembre, avant l'ouverture des inscriptions et avant les
-- publications Facebook. Quatre corrections de texte, toutes sur les DEUX
-- tableaux, aucune sur le schéma.
--
-- 1. LA RÉPARTITION NE SURVIVAIT PAS À L'ARRONDI. Le règlement arrondit la
--    bourse aux 5 $ puis prend des pourcentages EXACTS: 60 / 28 / 12. À
--    presque tous les niveaux de remplissage, ça promet des cents que
--    personne ne verse:
--
--        16 inscrits -> 125 $ -> 75 $ / 35 $ / 7,50 $ chacun
--        15 inscrits -> 115 $ -> 69 $ / 32,20 $ / 6,90 $ chacun
--        14 inscrits -> 110 $ -> 66 $ / 30,80 $ / 6,60 $ chacun
--        12 inscrits ->  95 $ -> 57 $ / 26,60 $ / 5,70 $ chacun
--
--    Règle retenue: chaque part est arrondie AU DOLLAR SUPÉRIEUR, jamais à la
--    baisse. Toujours des dollars entiers, jamais une part réduite, et l'écart
--    absorbé par Rallia ne dépasse jamais 1 $ par tableau. La part du champion
--    reste 60 % exacts sur un 16 complet (75 $), donc la pastille « jusqu'à
--    75 $ » de l'app (prize_top_share_bps = 6000, prizeLabel.ts) reste vraie.
--    L'exemple passe de « 7,50 $ chacun » à « 8 $ à chaque demi-finaliste ».
--
-- 2. « LES 2 DEMI-FINALISTES » NE DIT PLUS QUI EST PAYÉ. Depuis le retour à 2
--    qualifiés par poule (20260908222310), le tableau final compte 8 joueurs et
--    QUATRE atteignent les demies. La phrase désignait les deux perdants, et la
--    ligne qui levait l'ambiguïté (« les 4 qualifiés touchent tous une part »)
--    a été retirée à juste titre avec le format. On nomme donc les « 2 joueurs
--    éliminés en demi-finale ».
--
-- 3. « LES FRAIS DE SERVICE NE SONT PAS REMBOURSABLES » INVENTE UNE RETENUE.
--    Les deux tableaux portent fee_pct_bps_override = 0 et
--    fee_flat_cents_override = 0: il n'y a AUCUNS frais de service, et 100 %
--    des 15 $ sont remboursables. La phrase vient de la Série 2 montréalaise
--    (qui avait les 5 %); la Série 2 régionale, sur laquelle la Série 3 a été
--    calquée, l'avait correctement retirée. On la retire.
--
-- 4. RIEN NE DISAIT CE QUI ARRIVE SI LE TABLEAU NE SE REMPLIT PAS. Le seuil
--    dur est 6 inscrits (_lt_compute_pool_assignment lève
--    INSUFFICIENT_PARTICIPANTS en dessous), et l'annulation rembourse en
--    entier (lt_cancel_refund_candidates, 20260629130000). Mais la ligne de
--    remboursement se lisait comme une date butoir absolue au 15 septembre.
--    Trois tableaux de la Série 2 ont été annulés: c'est LA question qu'un
--    inconnu se pose avant de payer 15 $. On l'écrit.
--
-- PAS DE GARDE SUR LES INSCRIPTIONS, à dessein: chacune de ces corrections
-- clarifie ou améliore la position du joueur, jamais l'inverse. Les appliquer
-- après coup sur un environnement en retard est donc souhaitable, pas risqué.
-- Idempotent: ne touche que les lignes qui portent encore l'ancien texte, et
-- AVERTIT si un tableau Série 3 existe sans que le motif attendu s'y trouve,
-- pour qu'un texte qui aurait dérivé ne passe pas en silence.
--
-- PAS DE CHANGEMENT DE SCHÉMA: aucune régénération de types à committer.
-- ============================================================================

DO $$
DECLARE
    c_split_old text :=
        'Répartition de la bourse : 60 % au champion, 28 % au finaliste, 12 % partagés entre les 2 demi-finalistes. Sur un tableau complet, ça donne 75 $, 35 $ et 7,50 $ chacun.';
    c_split_new text :=
        'Répartition de la bourse : 60 % au champion, 28 % au finaliste, 12 % partagés entre les 2 joueurs éliminés en demi-finale. Chaque part est arrondie au dollar supérieur, jamais à la baisse. Sur un tableau complet, ça donne 75 $ au champion, 35 $ au finaliste et 8 $ à chaque demi-finaliste.';

    c_refund_old text :=
        'Remboursement : l''entrée est remboursable jusqu''à la fermeture des inscriptions le 15 septembre. Les frais de service ne sont pas remboursables.';
    c_refund_new text := concat_ws(E'\n',
        'Remboursement : l''entrée est remboursable jusqu''à la fermeture des inscriptions le 15 septembre.',
        'Tableau non complété : il faut au moins 6 inscriptions payées pour lancer le tableau. Sous ce seuil, ou si le remplissage est trop mince pour un vrai tableau, Rallia annule et rembourse l''entrée en entier, même après la fermeture des inscriptions.'
    );

    v_row      record;
    v_present  integer := 0;
    v_touched  integer := 0;
BEGIN
    FOR v_row IN
        SELECT id, name, rules FROM public.tournaments
         WHERE name LIKE 'Série 3 Montréal · Tennis ·%'
    LOOP
        v_present := v_present + 1;

        IF position(c_split_old IN v_row.rules) = 0
           AND position(c_split_new IN v_row.rules) = 0 THEN
            RAISE WARNING '%: ligne « Répartition » introuvable, ni ancienne ni nouvelle; texte dérivé, à reprendre à la main.', v_row.name;
        END IF;
        IF position(c_refund_old IN v_row.rules) = 0
           AND position(c_refund_new IN v_row.rules) = 0 THEN
            RAISE WARNING '%: ligne « Remboursement » introuvable, ni ancienne ni nouvelle; texte dérivé, à reprendre à la main.', v_row.name;
        END IF;
    END LOOP;

    UPDATE public.tournaments t
       SET rules      = replace(replace(t.rules, c_split_old, c_split_new), c_refund_old, c_refund_new),
           version    = t.version + 1,
           updated_at = now()
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
       AND (position(c_split_old IN t.rules) > 0 OR position(c_refund_old IN t.rules) > 0);

    GET DIAGNOSTICS v_touched = ROW_COUNT;

    IF v_present = 0 THEN
        RAISE NOTICE 'Série 3 absente de cet environnement; rien à faire.';
    ELSIF v_touched = 0 THEN
        RAISE NOTICE 'Série 3: règlement déjà à jour sur % tableau(x).', v_present;
    ELSE
        RAISE NOTICE 'Série 3: règlement corrigé sur % tableau(x) (bourse arrondie au dollar supérieur, 2 éliminés en demi-finale nommés, frais de service retirés, clause de tableau non complété ajoutée).', v_touched;
    END IF;
END $$;
