# Capacité d'inscription dynamique pour les tournois

Brouillon, 14 septembre 2026. Déclenché par la Série 3 Intermédiaire, pleine à
16 la veille de la fermeture et relevée à 32 par migration (`20260914223807`),
parce que `tournament_update` n'accepte `max_participants` qu'en brouillon.

## 1. L'idée

Ouvrir un événement sans plafond choisi à la main. Seule exigence : le tableau
final doit être adéquat pour le format. Le sort des joueurs en surplus est la
question ouverte.

## 2. Ce qui est déjà dynamique

- `_lt_compute_pool_assignment` accepte tout compte à partir de 6 et
  rééquilibre en poules de 3 à 5 (17 joueurs en poules de 4 donnent
  4, 4, 3, 3, 3). Sous 6 : `INSUFFICIENT_PARTICIPANTS`.
- `tournament_generate_knockout` arrondit les qualifiés à la puissance de 2
  au-dessus et comble par des byes.
- « Complet » n'est pas un statut : `tournament_register` refuse avec
  `TOURNAMENT_FULL`, le tournoi reste `registration_open`. Relever le nombre
  suffit.
- `registration_status` a déjà `waitlisted`, jamais utilisé par les tournois.

La validité du tableau est donc déjà vérifiée, mais au tirage. Le plafond ne
sert pas à ça.

## 3. Ce que le plafond fait aujourd'hui

| Lecteur                                   | Usage                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `tournament_register`                     | Barrière `TOURNAMENT_FULL`.                                                 |
| `tournament_create` / `tournament_update` | Liste blanche : 8, 12, 16, 20, 24, 32 en poules ; puissances de 2 en arbre. |
| `lt_draw_multiplier(max_participants)`    | « Jusqu'à N pts » avant le tirage ; le vrai tableau après.                  |
| Bourse, `prize_is_prorated`               | Prorata exprimé contre un tableau complet ; pastille « jusqu'à ».           |
| `process_tournament_closing_soon_fanout`  | « X places restantes » 48 h avant la fermeture ; rien si complet.           |
| Carte et feuille de détail                | « 16 places », badge complet.                                               |

Chacun a besoin d'un remplaçant.

## 4. La vraie contrainte : le calendrier

Le rythme dépend du nombre de tours d'élimination, `ceil(log2(qualifiés))`,
pas de la taille du tableau.

| Tableau (poules de 4, 2 qualifiés) | Tours | Parties d'un finaliste |
| ---------------------------------- | ----- | ---------------------- |
| 8                                  | 2     | 5                      |
| 16                                 | 3     | 6                      |
| 17 à 32                            | 4     | 7                      |
| 33 à 64                            | 5     | 8                      |

Série 3 : 27 jours, terrains fermés mi-octobre. À 16, 3 tours de 5 jours ;
au-delà, 4 tours de 4 jours ; 64 ne rentre pas. Un événement « sans plafond »
en a un, calculé depuis la fenêtre.

## 5. « Adéquat » veut dire deux choses

- **Poules égales** : le tableau est un multiple de la taille de poule. Le
  générateur ne l'exige pas (il rééquilibre) ; l'exiger donne le même nombre
  de parties à tous.
- **Aucun bye** : avec 2 qualifiés par poule, le nombre de poules doit être
  une puissance de 2. 12 joueurs en 3 poules donnent 6 qualifiés, tableau de
  8, 2 byes.

| Taille de poule | Tableaux valides |
| --------------- | ---------------- |
| 3               | 6, 12, 24, 48    |
| 4               | 8, 16, 32, 64    |
| 5               | 10, 20, 40       |

C'est la liste blanche actuelle moins 12, 20 et 24.

## 6. L'argent décide du sort des surplus

Une entrée payée ne se refuse pas après le débit : remboursement Stripe,
renversement de taxe dans `lt_registration_payment`, crédit de parrainage à
restaurer. La place doit exister avant l'intention de paiement. Exclus : trier
après paiement, scinder un tableau payé après coup (chaque tableau a sa
bourse).

## 7. Proposition

`max_participants` reste le nombre affiché ; il cesse d'être un réglage manuel
sur les événements `capacity_mode = 'dynamic'` (nouvelle colonne, défaut
`'fixed'`).

**7.1 Plafond dérivé.**

```
tours     = floor((end_date - cible_fin_poules) / jours_min_par_tour)
qualifiés = 2 ^ tours
poules    = floor(qualifiés / qualifiers_per_pool)
plafond   = plus grande valeur de la table §5 ≤ poules × pool_size
```

`jours_min_par_tour` : réglage d'organisateur, défaut 4. Recalculé à chaque
changement de date ou de format, figé au tirage.

**7.2 Extension par pas.** Le nombre affiché grandit par pas de `pool_size` à
mesure que le tableau se remplit, jamais le maximum d'un coup : « 4 places
restantes » reste vrai et la relance « ferme bientôt » garde son levier. Les
Séries 2 et 3 se sont remplies contre un plafond visible ; à mesurer avant de
retirer quoi que ce soit.

**7.3 Dernier pas partiel.** Trois sorties si la fermeture tombe à 27 :
rééquilibrer (le comportement actuel, poules inégales), rembourser le surplus
(exclu par §6), ou vendre la poule comme une unité : places tenues sans débit,
débits groupés quand le pas est plein, pas libéré sans frais à la fermeture
sinon. La troisième respecte le format sans toucher à l'argent, mais voir §10.

**7.4 Liste d'attente.** Au plafond, `tournament_register` écrit `waitlisted`
sans paiement, rang par `registered_at`. Place libérée (retrait, remboursement,
réservation expirée) : le premier est promu en `payment_pending`, 24 h pour
payer, notifié. L'organisateur peut ouvrir une poule de plus si le calendrier
le permet. À la fermeture, les restants sont avisés et gardés comme audience.

**7.5 Débordement.** Une poule ou plus en attente à la fermeture : un tableau
frère cloné (format, dates, taux de bourse, règlement), pas un tableau plus
gros. Précédent : la scission régionale de la Série 1.

**7.6 Bourse et points.** Bourse en taux par entrée payée
(`prize_per_entry_cents`) avec plafond ; la Série 3 est déjà à 7,8125 $ par
entrée. Pastille : « jusqu'à » taux × plafond courant. `lt_draw_multiplier` ne
change pas.

## 8. À ne pas bâtir

- Aucun plafond : le calendrier et les byes sont de vraies limites ; refuser à
  la porte avec une liste d'attente vaut mieux qu'un tirage à 5 tours dans la
  noirceur.
- Le tri après paiement (§6).
- Une croissance silencieuse sans pas : tue la rareté.

## 9. Décisions ouvertes

1. Défaut de `jours_min_par_tour` : 4 (Série 3) ou 5 (plan de Jean).
2. Pas d'une poule (rareté fine, byes possibles entre 16 et 32) ou d'un
   palier de la table §5 (jamais de bye, mais jusqu'à 15 joueurs tenus sans
   débit si un tableau ferme à 31).
3. Fenêtre de paiement après promotion : 24 h est une estimation.
4. Dépasser 32 en `pool_knockout` : 64 = 16 poules, tableau de 32 ; rien ne
   l'interdit, rien ne l'a jamais fait tourner.

## 10. Faisabilité

Vérifiée le 14 septembre contre `lt-create-registration-payment`,
`lt-reap-stale-registration-payments` et le RPC d'inscription.

**Aujourd'hui** : PaymentIntent immédiat au nom du compte Connect de
l'organisateur, payé dans la feuille de paiement de l'app ; réservation
`payment_pending` avec expiration, balayée par une fonction edge ; taxe et
crédit figés à ce moment.

**La partie dure : le débit différé de §7.3.** Trois patrons Stripe :
autoriser puis capturer (l'autorisation vit 7 jours, la fenêtre de la Série 3
en durait 6) ; carte enregistrée et débit hors session (faisable, mais nouveau
parcours app + webhook, refus à gérer, un joueur peut finir confirmé puis
impayé) ; aucune carte avant que la poule soit pleine (un absent bloque la
poule). Dans tous les cas, taxe et crédit sont à recalculer au débit
(incident `20260826190000`).

**Simple** : plafond dérivé (SQL pur), liste d'attente (enum existant, une
branche du RPC), points, taux de bourse, deux notifications, texte de la
carte. **Moyen** : un seul point « place libérée » pour les trois producteurs ;
le clone en tableau frère.

**Recommandation** : livrer plafond dérivé, extension par pas avec débit
immédiat et liste d'attente ; laisser le rééquilibrage absorber une dernière
poule partielle. Vente à l'unité en deuxième phase, par carte enregistrée,
seul patron qui survit à une semaine.

## 11. Déploiement

1. Colonnes `capacity_mode`, `min_days_per_round`, `prize_per_entry_cents` à
   défauts neutres ; fonction de dérivation testée contre la table §5.
2. Branche `waitlisted`, promotion à la libération, notifications. Débit
   immédiat. Fixtures payantes.
3. Extension par pas et texte de la carte ; mesurer le remplissage contre la
   Série 3.
4. Clone en tableau frère, si une attente atteint une poule.
5. Vente à l'unité par carte enregistrée (§10).
