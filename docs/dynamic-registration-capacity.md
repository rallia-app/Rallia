# Capacité d'inscription dynamique pour les tournois

Brouillon de spec, 14 septembre 2026. Écrit après que la Série 3 Intermédiaire
a rempli ses 16 places la veille de la fermeture des inscriptions et a dû être
relevée à 32 par migration (`20260914223807`), parce que `tournament_update`
n'accepte `max_participants` que tant que le tournoi est en brouillon.

## 1. L'idée

Ouvrir un événement sans plafond choisi à la main. Laisser s'inscrire autant
de joueurs qu'il y en a, et exiger seulement que le tableau final soit adéquat
pour le format. Ce qui arrive aux joueurs au-delà de ce que le format peut
absorber est la question ouverte, et ce document porte surtout là-dessus.

## 2. Ce qui est déjà dynamique

La moitié de l'idée existe. Rien, au moment de l'inscription, ne vérifie la
forme du tableau ; ce sont les générateurs qui le font au tirage.

- `_lt_compute_pool_assignment` prend n'importe quel nombre à partir de 6 et
  dimensionne les poules lui-même : poules de 3 à 5 autour du `pool_size`
  configuré, serpentin sur la liste des têtes de série. Sous 6, il lève
  `INSUFFICIENT_PARTICIPANTS`.
- `tournament_generate_knockout` arrondit le nombre de qualifiés à la
  puissance de 2 au-dessus et comble avec des byes.
- « Complet » n'est pas un statut. `tournament_register` refuse avec
  `TOURNAMENT_FULL` tant que les lignes actives atteignent `max_participants`,
  et le tournoi reste `registration_open`. Relever le nombre suffit à laisser
  passer le prochain joueur ; rien à rouvrir.
- `registration_status` porte déjà une valeur `waitlisted`. Elle sert aux
  participants de parties et aux saisons de ligue, jamais aux inscriptions de
  tournoi.

Donc pour `pool_knockout`, la vérification du « nombre adéquat » que l'idée
demande est déjà faite, juste tard. Le plafond n'est pas ce qui rend le tirage
valide.

## 3. Ce que le plafond fait aujourd'hui

Retirer `max_participants` casse six choses qui le lisent. Chacune a besoin
d'un remplaçant avant que la colonne cesse d'être une promesse.

| Lecteur                                        | Ce qu'il fait du nombre                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tournament_register`                          | La barrière `TOURNAMENT_FULL`.                                                                                                             |
| `tournament_update` / `tournament_create`      | Liste blanche des tailles : 8, 12, 16, 20, 24, 32 en poules ; puissances de 2 en arbre.                                                    |
| `lt_draw_multiplier(max_participants)`         | Le « jusqu'à N pts » affiché pendant les inscriptions. Une fois tiré, la vraie taille du tableau prend le relais.                          |
| Texte de bourse et `prize_is_prorated`         | Le règlement exprime le prorata contre un tableau complet (« 250 $ x inscriptions / 32 »). La pastille montre le plafond avec « jusqu'à ». |
| `process_tournament_closing_soon_fanout`       | Vend « X places restantes » 48 h avant la fermeture. Tableau complet : n'envoie rien.                                                      |
| La carte de découverte et la feuille de détail | « 16 places », places prises, le badge complet.                                                                                            |

## 4. La vraie contrainte, c'est le calendrier, pas le nombre

La taille du tableau ne dit rien du rythme. Ce qui fixe le rythme, c'est le
nombre de parties que joue un finaliste, donc le nombre de tours d'élimination,
qui vaut `ceil(log2(qualifiés))`.

| Tableau | Poules de 4 | Qualifiés (2/poule) | Tours d'élimination | Parties d'un finaliste |
| ------- | ----------- | ------------------- | ------------------- | ---------------------- |
| 8       | 2           | 4                   | 2                   | 5                      |
| 16      | 4           | 8                   | 3                   | 6                      |
| 17 à 32 | 5 à 8       | 10 à 16             | 4                   | 7                      |
| 33 à 64 | 9 à 16      | 18 à 32             | 5                   | 8                      |

La Série 3 a une fenêtre de 27 jours bornée par la fermeture des terrains
extérieurs. À 16, elle tournait sur 3 tours de 5 jours. Dès qu'elle a dépassé
16, l'élimination est passée à 4 tours de 4 jours. 64 inscrits demanderaient
5 tours et ne rentrent pas. Un événement sans plafond a quand même un plafond ;
il est juste calculé à partir de la fenêtre au lieu d'être tapé par
l'organisateur.

Les tailles impaires coûtent aussi en équité. 17 inscrits font 5 poules, 10
qualifiés et 6 byes dans un tableau de 16 : une tête de série reposée contre
quelqu'un qui vient de jouer. Le générateur le tolère. Les joueurs le
remarquent.

## 4 bis. « Adéquat » veut dire deux choses

Le nombre final d'inscrits doit respecter deux conditions distinctes, qui
n'ont pas le même coût.

**Des poules égales : le tableau est un multiple de la taille de poule.** Le
générateur ne l'exige pas aujourd'hui. Il rééquilibre : 17 joueurs en poules
de 4 donnent 4, 4, 3, 3, 3, pas quatre poules de 4 et une poule de 1. Des
poules de 3 à 5 autour de la taille configurée sont toutes acceptées. Exiger
un multiple exact rend toutes les poules identiques : chaque joueur joue le
même nombre de parties de poule, et le règlement peut le dire tel quel.

**Aucun bye : le nombre de poules est une puissance de 2.** Des poules
égales ne règlent pas l'élimination. 12 joueurs en trois poules de 4 donnent
6 qualifiés et un tableau de 8 avec 2 byes. Les byes disparaissent seulement
quand les qualifiés sont une puissance de 2, donc avec 2 qualifiés par poule
le nombre de poules lui-même doit être 2, 4, 8 ou 16.

Les deux conditions ensemble donnent une courte liste de tableaux valides par
taille de poule :

| Taille de poule | Tableaux valides |
| --------------- | ---------------- |
| 3               | 6, 12, 24, 48    |
| 4               | 8, 16, 32, 64    |
| 5               | 10, 20, 40       |

C'est la liste blanche actuelle moins 12, 20 et 24, qui sont des multiples
mais produisent des byes. Avec 1 qualifié par poule, la contrainte sur le
nombre de poules reste la même ; ce qui change, c'est le nombre de tours.

## 4 ter. Le dernier pas partiel

Si les places se vendent une à la fois et que les inscriptions ferment à 27
en poules de 4, le tableau n'est multiple de rien. Il n'y a que trois sorties,
et aucune n'est gratuite.

- **Rééquilibrer**, ce qui arrive aujourd'hui. Poules inégales, byes
  possibles. Le moins cher, le moins juste.
- **Rembourser le surplus** jusqu'à 24. Trois joueurs qui ont payé, renvoyés
  après coup. La section 5 explique pourquoi c'est la pire issue.
- **Vendre la dernière poule comme une unité.** Les places du dernier pas
  sont tenues en `payment_pending`, et le débit ne part que quand le pas
  entier est rempli. Si le pas ne se remplit pas avant la fermeture, personne
  dedans n'a été débité, et on le leur dit. Le multiple reste exact sans
  jamais rembourser, au prix d'un message « ta place est confirmée quand la
  poule est complète » pour les derniers inscrits.

La troisième sortie est la seule qui respecte le format sans toucher à
l'argent. C'est le mécanisme retenu en 6.2, et la table ci-dessus est la
définition de « adéquat » que la dérivation de 6.1 doit produire.

## 5. L'argent décide du sort des surplus

Une entrée payée ne se refuse pas après le débit. La refuser, c'est un
remboursement Stripe, un renversement de la taxe d'entrée dans
`lt_registration_payment`, un crédit de parrainage à restaurer, et un joueur
qui a payé pour rien. Donc quel que soit le mécanisme de débordement, la place
doit exister avant que l'intention de paiement soit créée. Ça exclut « tout le
monde paie, on trie au tirage ».

Ça exclut aussi de scinder en silence un tableau payé en deux tirages après
coup : chaque tableau a sa propre bourse, et le joueur a payé pour celui qu'il
a vu.

## 6. Proposition : un plafond dérivé, extensible, avec liste d'attente

Garder `max_participants` comme le nombre que les joueurs voient. Cesser de le
traiter comme un réglage manuel sur les événements ouverts.

### 6.1 Le dériver

Pour un événement marqué `capacity_mode = 'dynamic'` (nouvelle colonne, défaut
`'fixed'` pour que rien d'existant ne change) :

```
tours_disponibles = floor((end_date - cible_fin_poules) / jours_min_par_tour)
qualifies_max     = 2 ^ tours_disponibles
poules_max        = floor(qualifies_max / qualifiers_per_pool)
plafond           = poules_max × pool_size
```

Le résultat est ensuite ramené à la plus grande valeur de la table de la
section 4 bis qui ne le dépasse pas, pour que le plafond soit à la fois un
multiple de la poule et une puissance de 2 en poules.

`jours_min_par_tour` est un réglage d'organisateur, défaut 4. L'organisateur
pose les dates et le format ; le plafond en découle. Il est recalculé à chaque
modification de date ou de format tant que le tournoi est en brouillon ou
ouvert, et figé au tirage.

### 6.2 Grandir par poules entières, vendues comme une unité

Sous le plafond dérivé, le nombre visible grandit par pas de `pool_size` à
mesure que le tableau se remplit. Un pas est vendu comme une unité : ses
places restent en `payment_pending` sans débit tant qu'il n'est pas plein,
puis les débits partent ensemble. Un pas qui n'est pas plein à la fermeture
est libéré sans frais, et les joueurs dedans reçoivent le même message que la
liste d'attente (6.3). Le tableau qui part est donc toujours un multiple
exact de la poule, sans qu'un seul remboursement soit nécessaire.

Ce qui reste à trancher : entre deux valeurs de la table de 4 bis, par
exemple entre 16 et 32 en poules de 4, le pas d'une poule donne des tableaux
de 20, 24 ou 28 qui sont égaux mais font des byes. Soit on accepte les byes
entre deux paliers, soit le pas est le palier lui-même et 17 à 31 n'existent
pas. Voir la décision 5 en section 8. Les inscriptions ouvrent en affichant un pas
au-dessus du compte courant, jamais le maximum théorique, pour que la rareté
reste visible : « 4 places restantes » est vrai à tout moment et reste vrai
après que le pas a grandi.

C'est la partie à valider avant de bâtir. Les Séries 2 et 3 se sont toutes
deux remplies contre un plafond visible. Des places illimitées enlèvent le
levier sur lequel la relance « ferme bientôt » s'appuie. La règle du pas garde
le levier et ne retire que le nombre choisi à la main.

### 6.3 Liste d'attente au-dessus du plafond

Une fois le plafond dérivé atteint, `tournament_register` écrit une ligne
`waitlisted` au lieu de lever `TOURNAMENT_FULL`. Aucune intention de paiement
n'est créée. La ligne porte un rang par `registered_at`.

Quand une place se libère (retrait, remboursement, `payment_pending` expiré),
la première ligne en attente est promue en `payment_pending` avec un
`expires_at` de 24 h, et le joueur est notifié. Le balayage d'expiration
existant récupère déjà les places impayées, donc la promotion n'est qu'un
producteur de plus du même état. L'organisateur peut aussi étendre le plafond
dérivé d'une poule si le calendrier le permet, ce qui promeut une poule
entière.

À la fermeture des inscriptions, les lignes encore en attente sont notifiées
« le tableau est parti sans toi » et laissées en place comme audience pour la
prochaine série. Rien à rembourser, rien n'a été débité.

### 6.4 Débordement au-delà du calendrier : un deuxième tableau

Si la liste d'attente contient une poule ou plus à la fermeture, la réponse de
l'organisateur est un deuxième tournoi, pas un plus gros. La scission
régionale de la Série 1 est le précédent. Ce qui manque en outillage, c'est
une action « cloner en tableau frère » qui copie format, dates, taux de bourse
et règlement, et déplace les lignes en attente comme inscriptions neuves avec
un nouveau parcours de paiement. Chaque tableau garde sa bourse.

### 6.5 Bourse et points

Exprimer la bourse comme un taux par entrée payée (`prize_per_entry_cents`)
avec un plafond, plutôt qu'un plafond divisé par une taille de tableau. La
Série 3 est déjà à 7,8125 $ par entrée sur les deux tableaux ; le règlement le
dit juste à l'envers. La pastille montre `taux × plafond courant` avec
« jusqu'à », qui monte à mesure que le pas grandit, et c'est exactement le
comportement actuel à chaque taille fixe.

`lt_draw_multiplier` continue de lire `max_participants` avant le tirage et le
vrai tableau après. Rien à changer.

## 7. Ce qu'il ne faut pas bâtir

- **Aucun plafond du tout.** Le calendrier et le nombre de byes sont de vraies
  limites. Retirer le nombre déplace l'échec de « refusé à la porte » vers
  « tiré dans une élimination à 5 tours dans la noirceur ». Le refus à la porte
  avec une liste d'attente est l'échec le plus doux.
- **Le tri après paiement.** Voir la section 5.
- **Faire grandir le nombre en silence, sans pas.** Ça perd le signal de
  rareté et transforme la relance « ferme bientôt » en bruit.

## 8. Décisions ouvertes

1. Défaut de `jours_min_par_tour`. La Série 3 a accepté 4. Le plan d'origine
   de Jean était 5.
2. Pas d'une poule ou de deux. Une poule garde « 4 places » honnête ; deux
   divise par deux le nombre d'extensions qu'un événement chaud traverse.
3. Fenêtre de promotion depuis la liste d'attente : 24 h est une estimation.
   La réservation payée actuelle est plus courte.
4. Si le plafond dérivé peut un jour dépasser 32 sur un `pool_knockout`, le
   maximum actuel de la liste blanche. Un tableau de 64 en poules de 4, c'est
   16 poules et un tableau de 32 ; rien dans les générateurs ne l'interdit, et
   rien ne l'a jamais fait tourner.
5. Le pas est-il une poule ou un palier de la table de 4 bis ? Une poule
   garde la rareté fine (« 4 places ») mais tolère des byes entre deux
   paliers. Un palier double le tableau d'un coup (16 puis 32) et n'a jamais
   de bye, mais le dernier palier partiel peut être gros : 15 joueurs tenus
   en attente de débit si la Série 3 avait fermé à 31.

## 9. Déploiement

1. Colonnes `capacity_mode`, `min_days_per_round`, `prize_per_entry_cents`,
   avec des défauts qui ne changent rien. Fonction de dérivation, SQL pur,
   testée unitairement contre la table de la section 4.
2. Branche liste d'attente dans `tournament_register`, vente du pas comme
   une unité (débit différé jusqu'au pas plein), promotion à la libération
   d'une place, les deux notifications. Tester avec les fixtures
   payantes.
3. Extension par pas et texte de la carte. Mesurer la vitesse de remplissage
   sur la prochaine série contre la Série 3 avant de retirer quoi que ce soit.
4. Clone en tableau frère. Seulement si une liste d'attente atteint un jour
   une poule.
