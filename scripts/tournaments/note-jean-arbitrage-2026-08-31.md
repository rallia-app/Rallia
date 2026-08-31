# Une décision à prendre sur l'arbitrage (31 août 2026)

Tu avais raison sur les 72 heures. En creusant pour les enlever, on a trouvé un
problème plus gros dans la même famille, et il y a une décision qui te revient.

## Ce qui est réglé sans discussion

**Les prolongations automatiques n'existent plus.** Ni la grâce de 72 h sur une
partie déjà planifiée, ni la prolongation quand les deux avaient fait des
efforts, ni le +72 h après une annulation pour la météo. L'échéance est un mur:
quand elle passe, le pairage se règle. La seule accommodation qui reste, c'est
toi qui déplaces une date **avant** qu'elle soit passée. Une fois passée, elle
ne bouge plus, même pour toi.

**Le forfait ne touche jamais la cote ni les points Rallia.** Il compte comme
une défaite dans la poule, point.

**Les joueurs vont enfin savoir tout ça d'avance.** Avant, la seule place où
c'était écrit, c'était la notification qui t'annonçait que ça venait de
t'arriver. Maintenant c'est dit au moment où tu donnes tes dispos, dans les
rappels, sur la page du tournoi, et il y a un écran "Comment marche l'échéance"
qui explique les règles en français ordinaire.

## Le problème qu'on a trouvé

L'app note chaque joueur sur 6 points pour décider qui avance:

- **2 points**: avoir répondu vite à la demande de dispos
- **2 points**: avoir donné assez d'heures
- **2 points**: avoir réagi quand l'adversaire propose quelque chose

Le troisième est le seul qui mesure un vrai échange entre deux personnes. Les
quatre autres points s'obtiennent en remplissant une grille.

Résultat, ce cas-là arrivait pour vrai (on l'a reproduit sur le vrai code):

> Deux joueurs de tableau. A remplit ses dispos tout de suite, généreusement.
> B répond trois jours plus tard avec une seule heure. **Ni l'un ni l'autre ne
> propose jamais de moment.** L'app éliminait B, 6-0 6-0.

Personne n'a essayé de jouer. L'app a couronné le meilleur remplisseur de
formulaire, et elle avait dit au joueur que c'était "celui qui a essayé
d'organiser la partie" qui avancerait.

## Ce qu'on a changé, et ce qu'on veut valider avec toi

Quand **aucun des deux** n'a réagi et qu'aucune partie n'a été proposée, l'écart
de points ne sert plus à départager:

- **en poule**, la partie est annulée, sans faute de personne, et elle sort du
  classement;
- **en tableau**, ça t'est renvoyé à toi avec une notification, parce qu'une
  place d'élimination doit envoyer quelqu'un au tour suivant et que la machine
  n'a pas de base honnête pour choisir.

On a écarté les deux autres options: avancer le mieux classé récompense celui
qui traîne, et tirer à pile ou face est indéfendable devant celui qui perd.

**La question pour toi: est-ce que c'est le bon compromis?** Concrètement, ça
veut dire qu'un tour d'élimination où deux joueurs se sont contentés de remplir
leurs dispos va atterrir sur ton bureau au lieu de se régler tout seul. On pense
que c'est le bon prix à payer, mais c'est du travail pour toi et c'est ton appel.

Si tu préfères que l'app tranche quand même dans ce cas-là, dis-le et on remet
l'écart de points. C'est une ligne à changer.

## Deux autres corrections, pour information

**En double, la réputation suivait la mauvaise personne.** Si ton partenaire ne
répondait jamais, vous perdiez la partie tous les deux (normal, vous êtes une
équipe) mais vous preniez aussi tous les deux la pénalité de réputation, même
celui qui avait fait sa part. Corrigé: la marque personnelle suit celui qui n'a
rien fait.

**Un score inscrit contre toi ne t'était jamais annoncé.** Depuis qu'un score
est final dès qu'il est entré, avec 48 h pour le contester, il n'y avait ni
notification ni bouton: la fenêtre pouvait expirer sur quelqu'un qui ne savait
même pas qu'un résultat existait. Les deux sont là maintenant.

## Ce qui reste ouvert

- **Le check-in n'est pas branché sur les tournois.** La règle qui distingue
  "s'est présenté" de "ne s'est pas présenté" existe, mais personne n'est invité
  à faire son check-in sur une partie de tournoi, donc elle ne sert presque
  jamais. À faire avant que ça compte pour vrai.
- **Défaire une décision, c'est réservé à l'organisateur.** Un joueur qui pense
  que l'app s'est trompée n'a aucun recours dans l'app: il doit t'écrire.
