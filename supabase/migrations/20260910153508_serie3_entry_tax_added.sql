-- ============================================================================
-- Série 3 : la TPS/TVQ s'ajoute PAR-DESSUS les 15 $ (décision du 10 septembre).
--
-- 20260910020252 a posé entry_tax_mode, et le plan était `included` (15 $
-- reste 15 $, taxe extraite). Mathis a tranché autrement pour la Série 3 : le
-- joueur paie 15 $ + 2,25 $ = 17,25 $. Ce fichier fait trois choses, toutes
-- sur les deux tableaux Série 3 et rien d'autre :
--
--   1. entry_tax_mode -> 'added'. Le RPC d'inscription facture 17,25 $ dès la
--      prochaine inscription ; les lignes DÉJÀ payées à 15 $ gardent leur
--      instantané et sont traitées taxes incluses par l'ÉTAPE 3 du runbook
--      (1,95 $ extraits), ce qui est la seule lecture honnête d'un 15 $ déjà
--      encaissé. Le mode par ligne dans le grand livre existe pour ça.
--   2. La ligne « Entrée » du règlement dit le prix complet.
--   3. La description courte aussi.
--
-- Même patron d'idempotence que 20260910141920 : on remplace une phrase
-- exacte, on avertit si ni l'ancienne ni la nouvelle n'est là, on ne touche
-- pas à un texte dérivé. Rejouable. Pas de changement de schéma.
-- ============================================================================

DO $$
DECLARE
    c_rules_old text := 'Entrée : 15 $ par joueur.';
    c_rules_new text := 'Entrée : 15 $ par joueur, plus TPS et TVQ, soit 17,25 $. Le prix complet est affiché avant de payer.';
    c_desc_old  text := 'Entrée 15 $, bourse';
    c_desc_new  text := 'Entrée 15 $ plus taxes, bourse';

    v_row     record;
    v_present integer := 0;
    v_flipped integer;
BEGIN
    FOR v_row IN
        SELECT id, name, rules, description FROM public.tournaments
         WHERE name LIKE 'Série 3 Montréal · Tennis ·%'
    LOOP
        v_present := v_present + 1;
        IF position(c_rules_old IN v_row.rules) = 0
           AND position(c_rules_new IN v_row.rules) = 0 THEN
            RAISE WARNING '%: ligne « Entrée » introuvable, ni ancienne ni nouvelle; texte dérivé, à reprendre à la main.', v_row.name;
        END IF;
        IF position(c_desc_old IN v_row.description) = 0
           AND position(c_desc_new IN v_row.description) = 0 THEN
            RAISE WARNING '%: description sans « Entrée 15 $ », à reprendre à la main.', v_row.name;
        END IF;
    END LOOP;

    IF v_present = 0 THEN
        RAISE NOTICE 'Aucun tournoi Série 3 ici, rien à faire.';
        RETURN;
    END IF;

    UPDATE public.tournaments t
       SET entry_tax_mode = 'added',
           rules          = replace(t.rules, c_rules_old, c_rules_new),
           description    = replace(t.description, c_desc_old, c_desc_new),
           version        = t.version + 1,
           updated_at     = now()
     WHERE t.name LIKE 'Série 3 Montréal · Tennis ·%'
       AND (t.entry_tax_mode <> 'added'
            OR position(c_rules_old IN t.rules) > 0
            OR position(c_desc_old IN t.description) > 0);
    GET DIAGNOSTICS v_flipped = ROW_COUNT;

    RAISE NOTICE 'Série 3 : % tableau(x) sur % passé(s) en taxes ajoutées (17,25 $).', v_flipped, v_present;
END $$;
