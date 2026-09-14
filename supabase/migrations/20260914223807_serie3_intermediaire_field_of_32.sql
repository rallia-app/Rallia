-- ============================================================================
-- Série 3 Intermédiaire : plafond de 16 à 32 joueurs (décision du 14 septembre)
-- ----------------------------------------------------------------------------
-- Le tableau Intermédiaire est COMPLET à 16 la veille de la fermeture des
-- inscriptions. On double le plafond. L'Avancé ne bouge pas.
--
-- POURQUOI UNE MIGRATION ET PAS L'APP : `tournament_update` n'autorise
-- `max_participants` qu'en `draft` (20260811100000). Le tableau est en
-- `registration_open`, donc aucun chemin applicatif ne peut le faire.
-- « Complet » n'est PAS un statut : `tournament_register` refuse avec
-- TOURNAMENT_FULL tant que les inscriptions actives atteignent le plafond, et
-- le statut reste `registration_open`. Relever le plafond suffit : dès la
-- prochaine tentative, ça passe. Rien à rouvrir.
--
-- CE QUE 32 CHANGE MÉCANIQUEMENT (2 qualifiés par poule, inchangé) :
--
--   32 inscrits -> 8 poules de 4 -> 16 qualifiés -> tableau de 16 -> 4 tours.
--
-- `tournament_generate_knockout` arrondit les qualifiés à la puissance de 2
-- au-dessus. Formes mesurées sur _lt_compute_pool_assignment (pool_size 4) :
--   29 à 32 -> 8 poules -> 16 qualifiés -> tableau de 16, sans bye
--   17 à 28 -> 5 à 7 poules -> 10 à 14 qualifiés -> tableau de 16, avec byes
--   13 à 16 -> 4 poules -> 8 qualifiés -> tableau de 8 (la forme d'origine)
-- Donc DÈS LE 17e INSCRIT, le tableau final passe de 3 à 4 tours. Le
-- calendrier ne s'allonge pas (les terrains ferment mi-octobre, la finale
-- reste le 12) : les 4 tours tiennent dans les 15 jours qui suivent les
-- poules, soit ~4 jours par tour au lieu de 5. Cibles écrites au règlement :
-- huitièmes jeudi 1er octobre, quarts lundi 5, demies jeudi 8, finale lundi
-- 12. Les quarts et la finale ont chacun une fin de semaine ; les huitièmes
-- et les demies n'en ont pas. Les échéances réelles se posent au tirage
-- (scripts/tournaments/serie3-open-and-deadlines.sql, ÉTAPE 2), pas ici.
--
-- TÊTES DE SÉRIE : le serpentin place une tête par poule ; 8 poules = 8 têtes
-- (la CHECK n'accepte que 0, 2, 4, 8).
--
-- BOURSE : elle suit les inscriptions payées au même taux qu'avant. 125 $ pour
-- 16 = 250 $ pour 32 = 7,8125 $ par entrée, exactement la Série 2 (32 joueurs,
-- 250 $). À 16 payés la bourse reste 125 $ : personne parmi les inscrits
-- actuels ne perd quoi que ce soit. `prize_money_cents` n'est qu'un PLAFOND
-- affiché (« jusqu'à », 20260814170000) ; le versement est manuel. Sur un 32
-- complet, 60 / 28 / 12 donne 150 $, 70 $ et 15 $ par demi-finaliste, entiers.
--
-- GARDE-FOUS : refuse bruyamment si un tirage existe déjà (changer le format
-- sous des poules générées réécrirait la promesse). Ne touche que la ligne
-- encore à 16. Avertit si une phrase attendue du règlement manque, pour qu'un
-- texte dérivé ne passe pas en silence. Rejouable. PAS DE CHANGEMENT DE
-- SCHÉMA : aucune régénération de types à committer.
-- ============================================================================

DO $$
DECLARE
    c_name text := 'Série 3 Montréal · Tennis · Intermédiaire';

    c_desc_old_format text := '4 poules de 4, puis élimination directe à partir des quarts de finale.';
    c_desc_new_format text := '8 poules de 4, puis élimination directe à partir des huitièmes de finale.';
    c_desc_old_prize  text := 'bourse jusqu''à 125 $';
    c_desc_new_prize  text := 'bourse jusqu''à 250 $';

    c_rules_old_format text := 'Format : Round Robin en poules, 4 poules de 4 joueurs, puis élimination directe à partir des quarts de finale.';
    c_rules_new_format text := 'Format : Round Robin en poules, 8 poules de 4 joueurs, puis élimination directe à partir des huitièmes de finale.';

    c_rules_old_delays text := 'Délais : la phase de poules se termine le dimanche 27 septembre. Ensuite 5 jours par tour : quarts de finale le vendredi 2 octobre, demi-finales le mercredi 7 octobre, finale le lundi 12 octobre.';
    c_rules_new_delays text := 'Délais : la phase de poules se termine le dimanche 27 septembre. Ensuite 4 tours en 15 jours : huitièmes de finale le jeudi 1er octobre, quarts de finale le lundi 5 octobre, demi-finales le jeudi 8 octobre, finale le lundi 12 octobre.';

    c_rules_old_prize text := 'Bourse : 125 $ pour un tableau complet de 16 joueurs. La bourse suit le nombre d''inscriptions payées, au prorata : 125 $ x (inscriptions / 16), arrondie aux 5 $.';
    c_rules_new_prize text := 'Bourse : 250 $ pour un tableau complet de 32 joueurs. La bourse suit le nombre d''inscriptions payées, au prorata : 250 $ x (inscriptions / 32), arrondie aux 5 $ (16 inscrits donnent donc toujours 125 $).';

    c_rules_old_split text := 'Sur un tableau complet, ça donne 75 $ au champion, 35 $ au finaliste et 8 $ à chaque demi-finaliste.';
    c_rules_new_split text := 'Sur un tableau complet de 32, ça donne 150 $ au champion, 70 $ au finaliste et 15 $ à chaque demi-finaliste ; à 16 inscrits, 75 $, 35 $ et 8 $.';

    v_t       public.tournaments;
    v_touched integer := 0;
BEGIN
    SELECT * INTO v_t FROM public.tournaments WHERE name = c_name;

    IF v_t.id IS NULL THEN
        RAISE NOTICE 'Série 3 Intermédiaire absente de cet environnement; rien à faire.';
        RETURN;
    END IF;

    IF v_t.max_participants <> 16 THEN
        RAISE NOTICE 'Série 3 Intermédiaire déjà à % joueurs; rien à faire.', v_t.max_participants;
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.tournament_matches m WHERE m.tournament_id = v_t.id) THEN
        RAISE EXCEPTION
            'Série 3 Intermédiaire a déjà un tirage; relever le plafond réécrirait le format sous les inscrits. Reprendre à la main.';
    END IF;

    IF position(c_desc_old_format IN v_t.description) = 0 THEN
        RAISE WARNING '%: description sans la phrase de format attendue; texte dérivé, à reprendre à la main.', c_name;
    END IF;
    IF position(c_desc_old_prize IN v_t.description) = 0 THEN
        RAISE WARNING '%: description sans « bourse jusqu''à 125 $ »; texte dérivé, à reprendre à la main.', c_name;
    END IF;
    IF position(c_rules_old_format IN v_t.rules) = 0 THEN
        RAISE WARNING '%: ligne « Format » introuvable; texte dérivé, à reprendre à la main.', c_name;
    END IF;
    IF position(c_rules_old_delays IN v_t.rules) = 0 THEN
        RAISE WARNING '%: ligne « Délais » introuvable; texte dérivé, à reprendre à la main.', c_name;
    END IF;
    IF position(c_rules_old_prize IN v_t.rules) = 0 THEN
        RAISE WARNING '%: ligne « Bourse » introuvable; texte dérivé, à reprendre à la main.', c_name;
    END IF;
    IF position(c_rules_old_split IN v_t.rules) = 0 THEN
        RAISE WARNING '%: exemple de répartition introuvable; texte dérivé, à reprendre à la main.', c_name;
    END IF;

    UPDATE public.tournaments t
       SET max_participants  = 32,
           max_seeds         = 8,
           prize_money_cents = 25000,
           description = replace(replace(t.description,
                             c_desc_old_format, c_desc_new_format),
                             c_desc_old_prize,  c_desc_new_prize),
           rules = replace(replace(replace(replace(t.rules,
                       c_rules_old_format, c_rules_new_format),
                       c_rules_old_delays, c_rules_new_delays),
                       c_rules_old_prize,  c_rules_new_prize),
                       c_rules_old_split,  c_rules_new_split),
           version    = t.version + 1,
           updated_at = now()
     WHERE t.id = v_t.id;
    GET DIAGNOSTICS v_touched = ROW_COUNT;

    INSERT INTO public.leagues_tournaments_audit (scope, entity_id, action, actor_id, payload_before, payload_after)
    VALUES ('tournament', v_t.id, 'update', v_t.organizer_id,
            jsonb_build_object('max_participants', 16, 'max_seeds', v_t.max_seeds, 'prize_money_cents', v_t.prize_money_cents),
            jsonb_build_object('max_participants', 32, 'max_seeds', 8, 'prize_money_cents', 25000, 'via', 'migration'));

    RAISE NOTICE 'Série 3 Intermédiaire : plafond relevé à 32 sur % tableau (8 têtes de série, bourse plafond 250 $).', v_touched;
END $$;
