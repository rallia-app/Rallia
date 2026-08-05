# Ligue en boîtes

> Une ligue continue où les joueurs sont regroupés en petites « boîtes » de calibre semblable. Pendant un cycle de quelques semaines, chacun affronte tous les membres de sa boîte, au moment et à l'endroit qui conviennent aux deux joueurs. À la fin du cycle, les meilleurs montent dans la boîte supérieure, les derniers descendent, et un nouveau cycle commence.

Les règles communes à tous les formats (comptes, cote, réputation, argent, litiges, visibilité, conservation) sont dans le [README](./README.md) et s'appliquent intégralement ici.

## 1. Concept

- Aucun horaire imposé : les joueurs organisent eux-mêmes leurs parties à l'intérieur de la fenêtre du cycle.
- Aucun terrain à réserver par la ligue : chaque paire de joueurs choisit son lieu. Les frais de terrain éventuels sont partagés également entre les deux joueurs, sauf entente contraire entre eux.
- La ligue roule en continu, cycle après cycle, sans date de fin.
- Une ligue en boîtes appartient à un seul sport et se joue en simple. (Le double est envisageable plus tard avec des équipes fixes ; hors de la première version.)
- Pas de remplaçants : chaque partie doit être jouée par les deux joueurs assignés, sinon elle est réglée par forfait ou annulation.

## 2. Vocabulaire

| Terme             | Définition                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cycle             | La période de jeu, typiquement 5 à 6 semaines. Chaque cycle a une date de début et une date de fin connues d'avance. |
| Boîte             | Un groupe de 4 à 6 joueurs de calibre semblable. Les boîtes sont numérotées : la boîte 1 est la plus forte.          |
| Montée / descente | À la fin du cycle, les premiers de chaque boîte montent d'une boîte, les derniers descendent d'une boîte.            |

## 3. Cycle de vie

**La ligue** : active (des cycles s'enchaînent), en pause (aucun nouveau cycle ne se lance ; le cycle en cours va à son terme), fermée (plus rien ne se lance ; l'historique reste consultable). L'organisateur peut mettre en pause ou fermer la ligue entre deux cycles.

**Un cycle** :

| État                  | Ce qui est possible                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Inscriptions ouvertes | Les membres s'inscrivent au cycle et paient le cas échéant ; l'organisateur ajuste les règles du prochain cycle |
| Boîtes en préparation | Inscriptions closes ; le système propose les boîtes, l'organisateur ajuste puis publie                          |
| En cours              | Les joueurs organisent et jouent leurs parties ; les classements de boîtes vivent                               |
| Clôturé               | Parties restantes réglées, classements figés, montées et descentes appliquées, cycle archivé                    |
| Annulé                | Cycle abandonné avant son lancement ; remboursement intégral automatique si payant                              |

Transitions : l'organisateur fixe la date d'ouverture et de fermeture des inscriptions ainsi que les dates de début et de fin du cycle. La clôture se fait automatiquement à la date de fin (l'organisateur peut aussi clore manuellement si tout est joué avant). Un cycle en cours ne peut pas être annulé au sens ordinaire, seulement clôturé. Exception de force majeure : l'organisateur peut interrompre un cycle en cours (installations fermées, situation exceptionnelle). Les parties déjà jouées comptent dans l'historique et la cote, mais aucun classement final n'est établi, aucune montée ni descente ne s'applique, et le cycle est remboursé intégralement si payant.

## 4. Rôles

| Rôle            | Ce qu'il peut faire                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisateur    | Créer la ligue, configurer les règles, lancer et clore les cycles, ajuster les boîtes avant publication, trancher les litiges, corriger des résultats, retirer un joueur, prolonger un cycle |
| Co-organisateur | Tout comme l'organisateur, sauf supprimer la ligue ou la transférer                                                                                                                          |
| Membre          | S'inscrire aux cycles, organiser ses parties, entrer et confirmer ses pointages, consulter les classements                                                                                   |
| Spectateur      | Consulter les boîtes et classements si la ligue est publique                                                                                                                                 |

## 5. Création et configuration

L'organisateur fixe, à la création de la ligue :

- Nom, sport, description, image, visibilité et mode d'adhésion (voir les règles communes).
- Durée du cycle (4, 5, 6 ou 8 semaines ; 6 par défaut).
- Taille visée des boîtes (4, 5 ou 6 joueurs ; 5 par défaut).
- Nombre de joueurs qui montent et descendent à chaque fin de cycle (1 ou 2 ; 1 par défaut).
- Format de partie (par exemple deux manches gagnantes) : le même pour toute la ligue.
- Politique pour les parties non jouées à la fin du cycle (voir la section Fin de cycle).
- Prix par cycle (optionnel). Chaque cycle se paie séparément.
- Politique de remboursement pour les retraits avant le lancement d'un cycle (complet, partiel ou aucun).
- Capacité maximale de la ligue (optionnelle).
- Exigences d'admissibilité (optionnelles) : cote minimale et maximale.

Ces règles peuvent être ajustées entre deux cycles, jamais pendant un cycle en cours. Un changement s'applique à partir du cycle suivant et les membres en sont avisés avant d'avoir à se réinscrire.

## 6. Inscription à un cycle

- L'unité d'engagement est le cycle : un membre s'inscrit (et paie, le cas échéant) pour un cycle à la fois.
- Avant le début de chaque cycle, une période d'inscription est ouverte. Les membres du cycle précédent sont invités à reconduire leur place en priorité (fenêtre de reconduction de 7 jours avant l'ouverture générale).
- Un nouveau venu qui arrive pendant un cycle en cours ne peut pas y entrer : il est avisé quand les inscriptions du prochain cycle ouvrent. Personne n'entre dans un cycle déjà lancé.
- Un membre peut sauter un cycle (vacances, blessure) sans perdre sa place dans la ligue : à son retour, il est replacé selon sa cote actuelle, pas nécessairement dans son ancienne boîte.
- Quand la capacité est atteinte, les inscriptions du cycle ferment : pas de liste d'attente (règle commune). Une place libérée par un retrait avant le lancement redevient disponible.
- Le retrait avant le lancement du cycle est remboursé selon la politique de la ligue. Le retrait après le lancement n'est pas remboursé.

## 7. Formation des boîtes

- À la clôture des inscriptions, le système ordonne tous les inscrits et propose un découpage en boîtes.
- L'ordre de placement combine deux sources, dans cet ordre de priorité :
  1. Les résultats du cycle précédent : montées et descentes s'appliquent d'abord, puis l'ordre d'arrivée au classement précédent est conservé entre joueurs d'une même boîte.
  2. La cote : les nouveaux venus et les revenants sont insérés selon leur cote actuelle.
- Les montées et descentes gagnées sur le terrain sont garanties : un nouveau venu ou un revenant, quelle que soit sa cote, ne déloge jamais un joueur de la boîte que ses résultats lui ont value. Les nouveaux sont insérés dans les places restantes ; s'il n'y en a plus dans la boîte correspondant à leur cote, ils commencent une boîte plus bas.
- Si le nombre d'inscrits ne se divise pas également, les boîtes du bas absorbent la différence (une boîte peut avoir un joueur de plus ou de moins que la taille visée, jamais moins de 3).
- L'organisateur peut ajuster manuellement la composition avant de publier. Une fois le cycle publié, les boîtes sont figées pour toute sa durée.
- Chaque joueur voit sa boîte : la liste de ses adversaires du cycle, avec leur profil, leur cote et un bouton pour organiser chaque partie.

## 8. Déroulement du cycle

- Chaque joueur doit affronter une fois chaque autre membre de sa boîte avant la fin du cycle. Dans une boîte de 5, cela fait 4 parties, soit environ une par semaine.
- Pour chaque affrontement, l'application ouvre une conversation privée entre les deux joueurs. Ils y conviennent du moment et du lieu : l'application propose des créneaux qui croisent leurs disponibilités et leurs installations favorites, et chacun vote.
- Quand une entente est trouvée, la partie est créée et rattachée à l'affrontement. Une fois jouée, un des deux joueurs entre le pointage et l'autre le confirme (validation automatique après 72 heures sans réponse, règle commune). Le résultat compte alors automatiquement au classement de la boîte. Rien d'autre à faire.
- Si un joueur ne se présente pas à une partie convenue, l'autre le signale : l'absent perd par forfait et sa réputation en souffre (règle commune). L'organisateur peut renverser un forfait contesté.
- Chaque joueur voit en tout temps : ses parties jouées, ses parties à organiser, le temps restant au cycle et le classement de sa boîte.

## 9. Rappels et échéances

- Rappels automatiques aux joueurs qui ont encore des parties à organiser : à mi-cycle, à deux semaines de la fin, puis 3 jours avant la fin.
- Le rappel mène directement à la conversation d'organisation de la partie concernée.
- L'organisateur voit un tableau de bord du cycle : parties jouées, parties planifiées, parties sans aucune activité, joueurs silencieux, et peut relancer des joueurs précis.
- L'organisateur peut prolonger un cycle en cours, une seule fois, d'au plus deux semaines. Tous les joueurs sont avisés et le cycle suivant est décalé d'autant.

## 10. Classement de boîte

- Points, barème par défaut : victoire 10, victoire par forfait 8, défaite jouée 3, défaite par forfait 0, partie annulée 0. Deux principes : la victoire par forfait rapporte moins que la victoire jouée, et la défaite jouée rapporte plus que la défaite par forfait. Jouer vaut toujours mieux que ne pas jouer, et personne ne doit pouvoir bâtir sa montée sur des forfaits.
- Admissibilité à la montée : pour monter, un joueur doit avoir réellement joué au moins la moitié de ses parties du cycle (arrondie vers le bas). Un joueur inadmissible garde son rang mais la montée passe au suivant admissible du classement.
- Bris d'égalité, dans l'ordre :
  1. Confrontation directe (si exactement deux joueurs sont à égalité).
  2. Ratio de manches gagnées sur manches jouées.
  3. Ratio de jeux gagnés sur jeux joués (ou de points au pickleball). Les ratios, plutôt que les différentiels bruts, comparent équitablement des joueurs qui n'ont pas joué le même nombre de parties (forfaits, annulations).
  4. Tirage au sort stable (fixé au lancement du cycle).
- Le classement de chaque boîte est visible en tout temps par ses membres, et par tous si la ligue est publique.

## 11. Fin de cycle

1. **Résultats en attente.** Un pointage entré avant la date de fin compte comme une partie jouée : la clôture n'efface jamais un résultat en attente de confirmation ; sa validation suit son cours (règle commune).
2. **Parties non jouées.** À la date de fin, les affrontements restants sont réglés selon la politique choisie par l'organisateur :
   - **Responsabilité** (par défaut) : si un des deux joueurs a clairement tenté d'organiser la partie (propositions de créneaux restées sans réponse dans la conversation), il gagne par forfait. Si aucun des deux n'a bougé, ou si les deux ont fait des efforts comparables sans aboutir, la partie est annulée et ne rapporte de points à personne. Les forfaits sont proposés par le système à partir des conversations d'organisation et confirmés par l'organisateur, qui peut en renverser.
   - **Annulation simple** : toute partie non jouée est annulée, sans points.
3. **Classement provisoire et fenêtre de contestation.** Le classement de chaque boîte est figé à titre provisoire. Pendant 72 heures, un joueur peut contester un forfait ou un résultat attribué à la clôture, et l'organisateur peut corriger. Passé ce délai, tout est définitif.
4. **Champion.** Le premier de la boîte 1 est le champion du cycle et est mis en valeur (annonce dans la ligue, badge de gamification).
5. **Montées et descentes.** Appliquées seulement une fois la fenêtre de contestation fermée : les premiers de chaque boîte montent, les derniers descendent, selon le nombre configuré et sous réserve de l'admissibilité à la montée (section 10). La boîte 1 n'a pas de montée possible ; la dernière boîte n'a pas de descente.
6. **Inactivité.** Un joueur qui n'a joué aucune partie du cycle descend automatiquement, peu importe sa position, et reçoit un avertissement. Après deux cycles consécutifs sans aucune partie, il n'est plus invité à reconduire automatiquement et devra se réinscrire lui-même.
7. **Nouveau cycle.** Les inscriptions du cycle suivant peuvent ouvrir pendant la fenêtre de contestation, mais les boîtes ne sont publiées qu'après sa fermeture, une fois les montées et descentes définitives.

## 12. Départs en cours de cycle

- Un joueur qui se retire en cours de cycle (blessure, déménagement) : ses parties déjà jouées restent au classement, et toutes ses parties restantes deviennent des victoires par forfait pour ses adversaires, sans distinction. C'est la règle standard des ligues et tournois à la ronde, et elle traite pareillement tous les joueurs encore en course. (Imperfection assumée : ceux qui ont déjà affronté le retiré n'obtiennent pas ce gain ; la valeur réduite de la victoire par forfait et les bris d'égalité en ratios en limitent l'effet.)
- Un joueur retiré en cours de cycle est classé dernier de sa boîte et traité comme descendant à la reformation suivante.
- Si un retrait laisse une boîte à moins de 3 joueurs actifs, la boîte finit le cycle telle quelle ; le correctif se fait naturellement à la reformation suivante.
- Si le cycle est payant, le retrait volontaire en cours de cycle n'est pas remboursé. L'organisateur peut émettre un remboursement discrétionnaire (cas humanitaires), toujours net des frais de service.
- L'organisateur peut retirer un joueur d'un cycle (comportement, tricherie) ; les mêmes règles de règlement des parties s'appliquent, et le remboursement est au jugement de l'organisateur.

## 13. Paiement (si la ligue est payante)

- Le prix est par cycle et par joueur. Les règles communes s'appliquent (frais de service, fenêtre de paiement, remboursements d'annulation, tableau de bord des encaissements).
- L'inscription à un cycle payant est atomique : elle n'existe qu'au moment où le paiement réussit (règle commune). Aucune place n'est retenue en attente de paiement.
- Si l'organisateur annule un cycle avant son lancement, tous les inscrits sont remboursés intégralement.
- Si la ligue ferme alors qu'un cycle payé n'a pas encore commencé, ce cycle est remboursé intégralement.

## 14. Notifications

| Moment                                                                | Qui est avisé                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Ouverture de la fenêtre de reconduction                               | Membres du cycle précédent                                   |
| Ouverture des inscriptions générales                                  | Membres de la ligue et joueurs qui ont demandé à être avisés |
| Cycle lancé, boîtes publiées                                          | Tous les inscrits du cycle, avec leur boîte                  |
| Nouvelle proposition de créneau ou message d'organisation             | Les deux joueurs concernés                                   |
| Rappels de parties à organiser (mi-cycle, 2 semaines, derniers jours) | Les joueurs concernés                                        |
| Pointage à confirmer                                                  | L'adversaire                                                 |
| Pointage confirmé ou validé automatiquement                           | Les deux joueurs                                             |
| Forfait signalé                                                       | Le joueur déclaré absent et l'organisateur                   |
| Prolongation du cycle                                                 | Tous les inscrits du cycle                                   |
| Fin de cycle : classement final, montée ou descente, champion         | Chaque joueur, avec son résultat personnel                   |
| Avertissement d'inactivité                                            | Le joueur concerné                                           |
| Changement de règles pour le prochain cycle                           | Tous les membres                                             |

## 15. Cas limites

| Situation                                                     | Comportement                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moins de 8 inscrits au lancement d'un cycle                   | Le cycle démarre avec une ou deux boîtes seulement, ou l'organisateur reporte le lancement                                                                                                                                             |
| Deux joueurs ne trouvent aucun créneau commun                 | La politique de fin de cycle s'applique ; l'organisateur peut aussi prolonger le cycle (une fois, deux semaines au plus)                                                                                                               |
| Un joueur conteste un forfait attribué à la clôture           | Fenêtre de contestation de 72 heures, l'organisateur tranche                                                                                                                                                                           |
| Un joueur qui monte ou qui doit descendre ne se réinscrit pas | Une montée non réclamée passe au suivant admissible du classement de la boîte, en cascade ; une descente s'applique telle quelle (personne n'est épargné) ; les places vacantes restantes sont comblées par les nouveaux selon la cote |
| Égalité parfaite après tous les bris d'égalité                | Le tirage au sort stable départage ; il est fixé au lancement du cycle, donc incontestable                                                                                                                                             |
| L'organisateur abandonne la ligue                             | Transfert à un co-organisateur ; sans co-organisateur, la ligue se ferme à la fin du cycle en cours et tous les membres sont avisés                                                                                                    |
| Un joueur signale un forfait de mauvaise foi                  | L'autre joueur peut contester ; l'organisateur tranche à partir de la conversation d'organisation, qui fait preuve                                                                                                                     |
| La cote d'un joueur change fortement en cours de cycle        | Aucun effet sur le cycle en cours ; la nouvelle cote joue à la reformation suivante                                                                                                                                                    |
