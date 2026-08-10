# Récapitulatif du chantier Momentum

_Version non technique, pour validation. Mise à jour du 9 août 2026 (v5)._

Le fil conducteur : placer une action là où l'envie est déjà là, et enlever la friction qui reste. Tout est livré sauf la météo, volontairement mise de côté.

## A. Partir une partie plus facilement

**1. Boutons « Créer une partie » aux moments creux.** Quand le fil est vide ou qu'il n'y a rien à rejoindre, l'app propose de créer au lieu de laisser le joueur devant du vide.

**2. Rebond après une annulation.** Quand ta partie est annulée, toucher la notification amène directement aux parties ouvertes, avec une bannière de récupération et la date déjà filtrée. Avant, ça menait à une page morte.

**3. Écran d'accueil des parties publiques retravaillé.** Un vrai état vide qui explique quoi faire, au lieu d'une liste vide.

**4. Nouveau filtre « Places libres ».** On pouvait filtrer par « 1 place », « 2 places » ou « 3 et plus », mais pas demander la seule chose que le monde veut vraiment : ne pas voir les parties déjà complètes. C'est maintenant possible, et ça profite à tout le monde, pas juste aux notifications.

## B. La liste d'invitation, refaite au complet

C'est le plus gros morceau du chantier.

**1. Classement par compatibilité.** Avant, la liste d'invitation était triée par ordre d'identifiant, donc essentiellement au hasard. Elle est maintenant classée selon la partie précise qui vient d'être créée : disponibilité à cette heure-là, niveau, habitude de répondre aux invitations, historique commun, proximité, terrain habituel.

**2. La liste d'invitation est devenue l'écran de succès.** Après avoir créé une partie, on atterrit directement dessus. Avant, elle était cachée derrière un chevron, donc peu de gens invitaient.

**3. Des badges qui expliquent le choix.** Chaque joueur suggéré porte au plus deux badges : « Déjà joué ensemble », « Libre à l'heure de la partie », « Répond souvent », « Niveau de ta partie », « Actif cette semaine », « Terrain favori », « À proximité ». Tous du même style visuel, sur des rangées plates comme les listes de tournois.

**4. Les badges sont devenus des filtres.** _Nouveau depuis la v4._ On pouvait lire les badges, pas s'en servir. Maintenant, une rangée de filtres au-dessus de la liste reprend exactement les mêmes critères : toucher « Terrain favori » et « Déjà joué ensemble » ne garde que les joueurs qui ont les deux. Les filtres se cumulent, et un bouton « Réinitialiser » apparaît dès qu'il y en a un d'actif.

Le tri se fait du côté serveur, pas juste sur les joueurs déjà chargés à l'écran. Ça veut dire que le nombre de résultats est le vrai nombre, et que faire défiler la liste continue de ne montrer que les joueurs qui correspondent. La rangée de filtres a le même look que celle des parties publiques et du répertoire de terrains.

**5. Les signaux ont été rendus honnêtes.** C'est un travail de correction, pas d'ajout, et ça compte :

- « Libre à l'heure » ne lisait qu'une seule heure d'horloge, donc quelqu'un libre à 17 h mais pas à 18 h était annoncé comme libre pour une partie de 17 h à 18 h 30. Maintenant on couvre toutes les heures touchées.
- Le signal ignorait les horaires jamais reconfirmés. Après 2 semaines, on considère qu'on ne sait pas, au lieu de tenir ça pour vrai.
- Il ne vérifiait pas si la personne était déjà occupée ailleurs à la même heure. Maintenant oui.
- « Répond vite » est devenu « Répond souvent », parce qu'on mesure un taux de réponse, pas une vitesse. Et le calcul excluait mal les invitations automatiques (0,6 % de réponse) et les parties annulées par l'hôte, ce qui faisait passer tout le monde pour irresponsable.
- « Joue ici souvent » pouvait s'obtenir en mettant un terrain en favori sans jamais y jouer. Renommé « Terrain favori ».
- « Même niveau » est devenu « Niveau de ta partie ». _Nouveau depuis la v4._ Le badge ne compare pas le joueur à toi : il le compare au niveau minimum exigé par la partie que tu viens de créer, et il retombe sur ton propre niveau seulement quand la partie n'exige rien. Si tu crées une partie 4.0 alors que tu es 3.5, l'ancien libellé annonçait « Même niveau » pour des joueurs qui n'étaient pas du tien. Le nouveau dit la vérité dans les deux cas.

**6. Le terrain habituel compte maintenant dans le classement.** Avant, mettre un terrain en favori n'influençait rien : un habitué du parc arrivait à égalité avec un inconnu à la même distance.

## C. Après la partie

**1. Proposition de suite après le feedback.** Une fois la partie évaluée, l'app propose soit de rejouer la semaine prochaine (le formulaire est prérempli), soit de rejoindre une autre partie.

## D. Les trois notifications actives

### Des terrains sont libres

**Le moment :** une partie vient d'être créée dans un parc sans réserver de terrain, et il en reste de libres à cette heure-là.

**Qui la reçoit :** l'organisateur seulement.

**Garde-fou :** envoyée 10 minutes après la création, une seule fois par partie, jamais si le terrain est déjà réservé.

### Ta partie ne s'est pas remplie

**Le moment :** une partie vient de passer sans que personne ne se joigne.

**Qui la reçoit :** l'organisateur.

**Ce qu'on annonce :** le nombre de parties de cette semaine que l'organisateur pourrait **vraiment** rejoindre : même niveau, préférence de genre respectée, à sa distance, et avec des places libres.

**En touchant :** l'écran des parties publiques arrive avec ces filtres déjà appliqués. La liste contient donc exactement le nombre annoncé, ni plus ni moins.

_Deux choses ont été retirées de cette notification en cours de route._ Elle disait d'abord « on a déjà repéré N joueurs compatibles pour le même créneau la semaine prochaine ». Retiré : ces mêmes joueurs étaient déjà joignables cette semaine et ne se sont pas joints, donc le chiffre ne prouvait rien et arrivait au pire moment. Elle comptait ensuite toutes les parties à proximité, même celles réservées à un autre niveau ou déjà complètes. Corrigé : on ne compte que ce qui est réellement joignable.

### Inscriptions ouvertes

**Le moment :** un organisateur certifié ouvre les inscriptions d'un tournoi.

**Qui la reçoit :** les joueurs de la région (jusqu'à 50 km), du bon niveau, pas déjà inscrits.

**Garde-fou :** seulement les organisateurs certifiés, une seule fois par joueur et par tournoi, et l'envoi est étalé au lieu de partir d'un coup.

## E. Deux notifications construites puis mises de côté

Les deux sont terminées et testées. Rien n'a été supprimé : les rallumer, c'est un seul réglage à changer, sans redéploiement.

### « Ça commence bientôt » (désactivée le 7 août)

Elle devait avertir les joueurs tout près qu'une partie commençant dans 2 à 6 heures avait encore de la place.

Deux raisons. Son audience était très étroite une fois les deux filtres appliqués : il fallait être à moins de 5 km et avoir exactement le même niveau que la partie. Et elle partageait son quota hebdomadaire avec les notifications de parties à proximité qui existaient déjà, donc les deux se disputaient les mêmes places.

### « Ton créneau habituel est libre » (désactivée le 9 août)

Elle se déclenchait quand demain tombait sur un créneau où le joueur a dit jouer d'habitude, qu'il n'avait rien de prévu, et qu'une partie compatible cherchait des joueurs dans un rayon de 10 km. Garde-fou : maximum une par semaine et par joueur, et rien du tout si l'horaire déclaré n'avait pas été confirmé depuis 2 semaines.

Elle a été mise de côté sur décision produit, pas parce qu'un problème a été trouvé. C'est celle qui repose le plus sur des horaires que les joueurs déclarent eux-mêmes, donc c'est aussi celle dont la qualité dépend le plus de la fraîcheur de ces horaires.

## F. Un principe qu'on s'est donné en cours de route

Plusieurs corrections de ce chantier viennent du même réflexe : **un chiffre ou un badge doit pouvoir se défendre**. Si on annonce « 3 parties », il doit y en avoir 3 dans la liste. Si on affiche « Libre à l'heure », la personne doit l'être. Quand on ne peut pas tenir la promesse, on dit quelque chose de plus simple plutôt que quelque chose de flatteur.

C'est ce principe qui a fait retirer le compte de joueurs compatibles, renommer trois badges, resserrer la fraîcheur des horaires à 2 semaines, brancher les filtres sur la notification de récupération, et faire porter le tri des filtres d'invitation par le serveur plutôt que par l'écran.

## G. Pouvoir mesurer

**Interrupteur et dosage par type.** Chaque notification peut être coupée ou envoyée à un pourcentage de l'audience, sans redéploiement. Mettre un type à 90 % crée un groupe témoin stable de 10 % : on peut donc comparer ceux qui la reçoivent à ceux qui ne la reçoivent pas, et savoir si elle sert vraiment à quelque chose. C'est ce mécanisme qui a permis de mettre deux notifications de côté en une minute chacune, sans toucher au code.

## H. Pas fait

**La météo.** Volontairement mise de côté, en attente d'une décision sur les seuils et l'audience. La forme recommandée serait de l'utiliser comme filtre pour supprimer des notifications quand il pleut, plutôt que comme déclencheur.

## Points à valider

**Le volume total.** Chaque type a son plafond, mais il n'y a pas encore de plafond global tous types confondus. Un joueur actif pourrait en recevoir plusieurs par jour. C'est le principal risque et c'est une décision produit, pas technique. À noter que le risque a beaucoup baissé depuis la v4, vu qu'il ne reste que trois types actifs, et que deux des trois ne s'adressent qu'à l'organisateur d'une partie.

**Les parties sans niveau exigé.** Pour que la liste corresponde exactement au chiffre annoncé, la notification de récupération ne compte que les parties qui exigent un niveau précis. Les parties ouvertes à tous les niveaux, environ 11 % du total, ne sont donc pas comptées. C'est un compromis assumé : à valider.

**Par où commencer.** Des trois qui restent, « Ta partie ne s'est pas remplie » est la plus intéressante à mesurer en premier : elle tombe sur le moment de découragement le plus dangereux pour l'offre, et c'est la seule dont on peut vérifier la promesse de bout en bout, vu que la liste ouverte correspond exactement au chiffre annoncé.

**Quand rallumer les deux mises de côté.** Pour « Ça commence bientôt », il faudra d'abord décider d'élargir un des deux filtres : le rayon de 5 km ou l'égalité stricte de niveau. Telle quelle, elle touche trop peu de monde pour valoir son quota. Pour « Ton créneau habituel », la question est plutôt de savoir si on veut d'abord relancer les joueurs pour qu'ils confirment leurs horaires, puisque la notification ne part pas quand l'horaire date de plus de 2 semaines.

---

_État au 9 août 2026 : tout est sur la branche de développement et déployé sur staging pour les tests. Rien n'est en production. Les nouveautés de la v4 (les badges devenus filtres, le renommage « Niveau de ta partie ») demandent une nouvelle version de test pour être visibles sur téléphone. Cette version remplace les v1, v2, v3 et v4 du même nom._
