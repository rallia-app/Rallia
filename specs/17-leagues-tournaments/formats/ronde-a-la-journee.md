# Ronde à la journée

> Un événement d'une seule journée, sans arbre éliminatoire : les participants jouent plusieurs courtes parties contre des adversaires différents, un classement commun s'accumule au fil des rondes, et un gagnant est couronné à la fin.

Les règles communes à tous les formats (comptes, cote, réputation, argent, litiges, visibilité, conservation) sont dans le [README](./README.md) et s'appliquent intégralement ici.

## 1. Concept

- L'événement se déroule en un seul bloc : une date, une heure de début, une durée, un lieu.
- Personne n'est éliminé. Tout le monde joue toutes les rondes, peu importe ses résultats.
- L'événement appartient à un seul sport (tennis ou pickleball) et à un seul format de jeu (simple, double ou double mixte).
- C'est le format idéal pour les soirées de club, les mixers sociaux et l'initiation des nouveaux joueurs.
- L'organisateur est responsable des terrains : il les réserve lui-même, en dehors de l'application. Le prix d'entrée sert typiquement à couvrir ce coût.

## 2. Cycle de vie

| État                  | Ce qui est possible                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Brouillon             | L'organisateur configure ; rien n'est visible des joueurs                                            |
| Inscriptions ouvertes | Les joueurs s'inscrivent, paient, se retirent ; l'organisateur peut modifier les détails et reporter |
| Inscriptions fermées  | La liste est figée ; l'organisateur prépare et publie la feuille de parties                          |
| En cours              | Les rondes se jouent, les pointages entrent, le classement vit                                       |
| Terminé               | Classement final figé, gagnant annoncé, événement archivé                                            |
| Annulé                | Tous avisés, remboursements automatiques si payant, événement archivé                                |

Transitions : les inscriptions ferment automatiquement à l'heure de début, ou plus tôt si l'organisateur le décide. L'événement passe « en cours » quand la feuille de parties est publiée. Il passe « terminé » quand l'organisateur clôt, ou automatiquement 48 heures après l'heure de fin prévue si l'organisateur oublie (avec le classement en l'état, les parties restantes annulées).

## 3. Rôles

| Rôle            | Ce qu'il peut faire                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisateur    | Créer et configurer l'événement, gérer les inscriptions, publier la feuille de parties, entrer et corriger les pointages, reporter, clore, annuler |
| Co-organisateur | Tout comme l'organisateur, sauf supprimer l'événement ou le transférer                                                                             |
| Participant     | S'inscrire, se retirer, entrer et confirmer ses pointages, consulter la feuille de parties et le classement                                        |
| Spectateur      | Consulter la feuille de parties et le classement si l'événement est public                                                                         |

## 4. Création

L'organisateur fournit :

- Nom de l'événement, sport, description, image (optionnelle).
- Date, heure de début, durée prévue, lieu (installation ou adresse libre).
- Format de jeu : simple, double ou double mixte. Un seul format par événement.
- Nombre de rondes (entre 2 et 6). Chaque ronde correspond à une courte partie (par exemple un set, ou une partie de pickleball à 11 points). Le format de partie est choisi à la création et vaut pour toutes les rondes.
- Capacité maximale de participants, et minimum requis pour tenir l'événement (4 par défaut en simple, 8 en double).
- Mode de pairage :
  - **Aléatoire** : les affrontements sont tirés au hasard à chaque ronde.
  - **Par calibre** : les joueurs de force semblable s'affrontent, selon leur cote au début de l'événement (les résultats de la journée ne modifient pas les pairages : on ne peut rien gagner à perdre exprès).
  - **Éviter les répétitions** : le système fait de son mieux pour que personne ne rejoue contre le même adversaire.
- Visibilité et mode d'inscription (voir les règles communes).
- Prix d'entrée (optionnel) et politique de remboursement : l'organisateur choisit la date limite jusqu'à laquelle un retrait est remboursé, et si le remboursement est complet ou partiel.
- Exigences d'admissibilité (optionnelles) : cote minimale, cote maximale.

À la création, l'application montre un aperçu : « 16 joueurs, 4 rondes : chacun jouera 4 courtes parties. Prévois environ 3 heures et 4 terrains. » L'estimation du nombre de terrains nécessaires (participants divisés par joueurs par terrain) aide l'organisateur à réserver juste.

## 5. Inscription

- S'inscrire à l'événement vaut confirmation de présence. Il n'y a pas d'étape distincte de confirmation : si tu es inscrit, tu es attendu.
- Un participant peut se retirer tant que l'événement n'a pas commencé. Son retrait libère une place. S'il avait payé, le remboursement suit la politique de l'événement.
- Si la capacité est atteinte, l'inscription est refusée : pas de liste d'attente (règle commune). Une place libérée par un retrait redevient disponible tant que les inscriptions sont ouvertes.
- L'inscription ferme automatiquement à l'heure de début, ou plus tôt si l'organisateur le décide. L'organisateur peut rouvrir les inscriptions tant que la feuille de parties n'est pas publiée.

### Particularités du double

- Chaque joueur s'inscrit individuellement, jamais en équipe : c'est un mixer, les équipes changent à chaque ronde.
- Le classement reste individuel : chaque joueur de l'équipe gagnante reçoit les points de victoire, chaque joueur de l'équipe perdante les points de défaite.
- Les équipes de chaque ronde sont formées selon le mode de pairage : aléatoire (équipes tirées au hasard), par calibre (équipes équilibrées, les plus forts répartis plutôt que concentrés dans la même équipe), éviter les répétitions (le système varie partenaires et adversaires d'une ronde à l'autre).
- Deux joueurs qui se désignent mutuellement comme partenaires préférés jouent ensemble à chaque ronde, tant que la composition le permet. Un souhait non réciproque est ignoré.
- En double mixte, l'organisateur est responsable de veiller à l'équilibre des inscriptions ; l'application n'impose pas de quota par genre.

## 6. Déroulement de la journée

1. **Fermeture des inscriptions.** La liste des participants est figée. L'organisateur peut encore retirer un absent de dernière minute, ou inscrire lui-même un retardataire tant que la feuille n'est pas publiée (dans le respect de la capacité et des exigences d'admissibilité ; pour un événement payant, l'organisateur peut marquer l'entrée comme payée sur place, sous sa responsabilité). Une entrée payée sur place ne passe pas par Rallia : elle est exclue des remboursements automatiques, n'apparaît pas dans les encaissements de l'application et est signalée à part dans le tableau de bord de l'organisateur.
2. **Génération de la feuille de parties.** Le système produit toutes les rondes d'un coup : qui affronte qui, à quelle ronde. L'organisateur consulte la feuille avant de la publier, peut verrouiller des affrontements qu'il veut garder, puis régénérer le reste.
3. **Ajustements en cours d'événement.** Si un joueur arrive ou disparaît après la publication, l'organisateur peut régénérer les rondes non encore jouées : les résultats des rondes jouées sont préservés, seules les rondes à venir sont recomposées.
4. **Nombre impair de joueurs.** À chaque ronde, un joueur différent est exempté (il « passe son tour »). Le système fait tourner les exemptions pour que personne n'en subisse plus d'une, tant que le nombre de rondes le permet. Un joueur exempté reçoit des points d'exemption pour ne pas être pénalisé au classement. En double, les joueurs en surplus (jusqu'à trois) sont exemptés à tour de rôle selon la même logique.
5. **Absents en cours d'événement.** Si un joueur disparaît, l'organisateur marque ses parties restantes : ses adversaires prévus gagnent par forfait, et l'absence est traitée selon les règles de réputation communes.
6. **Progression des rondes.** L'organisateur annonce le début de chaque ronde. Les participants voient en tout temps leur prochaine partie et le terrain annoncé par l'organisateur (l'attribution des terrains se fait à la voix ; l'application ne gère pas les terrains pour ce format dans la première version).

## 7. Pointage

- Chaque affrontement de la feuille est rattaché à une vraie partie Rallia et le pointage passe par le mécanisme habituel (règle commune) : à la fin de sa partie, un joueur entre le pointage, l'adversaire le confirme, et le résultat alimente automatiquement le classement de l'événement.
- Pour garder le rythme d'une journée à rondes courtes, la confirmation est encouragée sur place ; un pointage non confirmé suit la validation automatique commune (72 heures) et n'empêche pas les rondes suivantes de se jouer.
- L'organisateur (ou un co-organisateur) peut saisir un pointage à la place des joueurs, au fur et à mesure ou à la fin de chaque ronde, et corriger un résultat pendant l'événement et jusqu'à 72 heures après la clôture (fenêtre de correction commune). Chaque intervention est consignée.
- Un participant qui conteste un pointage s'adresse à l'organisateur, qui tranche (règle commune).
- Issues particulières : abandon en cours de partie et victoire par forfait, selon les définitions communes.

## 8. Classement et fin

- Le classement est commun à tout l'événement et se met à jour après chaque pointage entré.
- Points : victoire, défaite jouée, exemption et victoire par forfait rapportent chacun un nombre de points prédéfini. Barème par défaut : victoire 10, victoire par forfait 8, défaite jouée 3, exemption 3, défaite par forfait 0, partie annulée 0. Deux principes : la défaite jouée rapporte autant que l'exemption (jouer et perdre ne doit jamais être pire que ne pas jouer) et la victoire par forfait rapporte moins que la victoire jouée (un forfait ne doit jamais être préférable à une partie).
- Bris d'égalité, dans l'ordre :
  1. Confrontation directe (si exactement deux joueurs sont à égalité et se sont affrontés).
  2. Ratio de manches gagnées sur manches jouées.
  3. Ratio de jeux gagnés sur jeux joués (ou de points au pickleball). Les ratios, plutôt que les différentiels bruts, comparent équitablement des joueurs qui n'ont pas joué le même nombre de parties (exemptions, forfaits).
  4. Tirage au sort stable (fixé au début de l'événement, le même pour toute sa durée).
- Quand toutes les parties sont terminées (jouées, forfaits ou annulées), l'organisateur clôt l'événement. Le classement final est figé, le gagnant est annoncé et l'événement est archivé.
- Chaque partie jouée compte dans l'historique et la cote des joueurs (règle commune).

## 9. Annulation et report

- L'organisateur peut annuler l'événement en tout temps avant sa clôture, avec un motif. Tous les inscrits sont avisés ; remboursement intégral automatique si payant (frais de service exclus, règle commune).
- L'organisateur peut reporter (changer date et heure) tant que l'événement n'a pas commencé. Tous les inscrits sont avisés et disposent de 72 heures pour se retirer avec remboursement complet, même si la date limite de remboursement normale est passée : un report rouvre toujours la porte de sortie. Cette fenêtre est écourtée au besoin pour se terminer au plus tard à la nouvelle heure de début.
- Un événement annulé ou reporté plus de deux fois affiche un avertissement discret sur les événements futurs du même organisateur (fiabilité de l'organisateur).

## 10. Notifications

| Moment                                       | Qui est avisé                                               |
| -------------------------------------------- | ----------------------------------------------------------- |
| Inscription confirmée (ou paiement complété) | Le participant                                              |
| Rappel la veille de l'événement              | Tous les inscrits                                           |
| Feuille de parties publiée                   | Tous les participants                                       |
| Ronde suivante annoncée                      | Tous les participants                                       |
| Événement reporté                            | Tous les inscrits (avec la fenêtre de retrait de 72 heures) |
| Événement annulé                             | Tous les inscrits                                           |
| Classement final publié                      | Tous les participants                                       |

## 11. Cas limites

| Situation                                                                                             | Comportement                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Le minimum de participants n'est pas atteint à l'heure de début (4 par défaut en simple, 8 en double) | L'événement ne peut pas démarrer ; l'organisateur reporte ou annule, avec remboursement complet automatique si payant                      |
| Un joueur se blesse après quelques rondes                                                             | Ses parties restantes deviennent des forfaits ; ses résultats déjà joués restent au classement                                             |
| L'organisateur ne clôt jamais l'événement                                                             | Clôture automatique 48 heures après l'heure de fin prévue, parties restantes annulées, classement en l'état                                |
| Deux joueurs contestent un pointage                                                                   | L'organisateur tranche ; sa correction fait foi                                                                                            |
| L'organisateur veut changer le nombre de rondes après publication                                     | Impossible ; il peut seulement annuler des rondes restantes en clôturant plus tôt                                                          |
| Météo : événement extérieur interrompu à mi-parcours                                                  | L'organisateur clôt avec le classement en l'état (les rondes jouées comptent), ou reporte les rondes restantes en modifiant l'heure de fin |
