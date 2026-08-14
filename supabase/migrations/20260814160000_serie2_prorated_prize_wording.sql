-- ============================================================================
-- Série 2 — la bourse est au prorata des inscriptions, et le dire
-- ----------------------------------------------------------------------------
-- Le seed (20260812280000) annonce « 250 $ de bourse » sans condition, et la
-- grille du doc (150 / 70 / 15 x2) en dollars fixes. Les deux supposent un
-- tableau COMPLET de 32 joueurs. Ce n'est pas une nuance de rédaction:
--
--   32 inscriptions x 15 $ = 480 $ perçus, 250 $ de bourse -> il reste 230 $.
--   L'équilibre se fait à 17 inscriptions. En dessous, la bourse dépasse la
--   totalité des frais perçus, et pool_knockout accepte un tableau de 8.
--
-- Annoncer un montant qu'on pourrait ne pas verser est aussi le genre de
-- représentation que la LPC sanctionne (art. 219). La bourse devient donc
-- explicitement proportionnelle, avec une formule vérifiable par le joueur
-- plutôt qu'un « ajusté au besoin » discrétionnaire:
--
--   bourse = 250 $ x (inscriptions payées / 32), arrondie aux 5 $
--
-- soit ~52 % des frais perçus à n'importe quel niveau de remplissage. La
-- répartition passe en POURCENTAGES (60 / 28 / 12, la grille du doc) pour
-- rester juste quelle que soit la bourse. Le montant final est confirmé à la
-- fermeture des inscriptions, donc avant le tirage et avant la première partie.
--
-- CE QUI N'EST PAS RÉGLÉ ICI: `prize_money_cents` reste à 25000, et l'app peint
-- une pastille dorée « 250 $ » sur chaque carte sans nuance. C'est la
-- représentation la plus visible et la moins qualifiée des trois. La corriger
-- demande soit un champ « bourse garantie vs maximale », soit un « jusqu'à »
-- dans le libellé de la pastille: un changement client, hors de portée d'une
-- migration de données. Voir le suivi dans la conversation d'ouverture.
--
-- Idempotent: ne touche que les lignes qui portent encore l'ancien libellé.
-- ============================================================================

DO $$
DECLARE
    v_touched integer;
BEGIN
    -- 1. Le règlement: une ligne « bourse » conditionnelle + une répartition en %
    UPDATE public.tournaments
       SET rules = replace(
               rules,
               'Entrée et bourse : 15 $ par joueur, 250 $ de bourse. 150 $ au champion, 70 $ au finaliste, 15 $ à chaque demi-finaliste.',
               concat_ws(E'\n',
                 'Entrée : 15 $ par joueur.',
                 'Bourse : 250 $ pour un tableau complet de 32 joueurs. La bourse suit le nombre d''inscriptions payées, au prorata : 250 $ x (inscriptions / 32), arrondie aux 5 $. Le montant final est confirmé à la fermeture des inscriptions, donc avant le tirage.',
                 'Répartition de la bourse : 60 % au champion, 28 % au finaliste, 12 % partagés entre les 2 demi-finalistes. Sur un tableau complet, ça donne 150 $, 70 $ et 15 $ chacun.'
               )
           ),
           updated_at = now()
     WHERE name LIKE 'Série 2 Montréal · Tennis ·%'
       AND rules LIKE '%250 $ de bourse. 150 $ au champion%';

    GET DIAGNOSTICS v_touched = ROW_COUNT;
    RAISE NOTICE 'Règlement mis à jour sur % tournoi(s).', v_touched;

    -- 2. La description (carte de découverte): « jusqu'à » plutôt qu'un montant sec
    UPDATE public.tournaments
       SET description = replace(
               description,
               'Entrée 15 $, bourse de 250 $.',
               'Entrée 15 $, bourse jusqu''à 250 $ selon le nombre d''inscriptions.'
           ),
           updated_at = now()
     WHERE name LIKE 'Série 2 Montréal · Tennis ·%'
       AND description LIKE '%bourse de 250 $.%';

    GET DIAGNOSTICS v_touched = ROW_COUNT;
    RAISE NOTICE 'Description mise à jour sur % tournoi(s).', v_touched;
END $$;
