# Récapitulatif du chantier Momentum

_Ce qui est en place et actif. 9 août 2026 (v6)._

## Créer et trouver une partie

**Boutons « Créer une partie » aux moments creux.** Quand le fil est vide ou qu'il n'y a rien à rejoindre, l'app propose de créer une partie.

**Rebond après une annulation.** Toucher la notification d'annulation amène aux parties ouvertes, avec la date de la partie annulée déjà filtrée.

**Filtre « Places libres ».** Permet de ne voir que les parties qui ne sont pas déjà complètes.

## La liste d'invitation

**Classement par compatibilité.** Les joueurs suggérés sont classés selon la partie qui vient d'être créée : disponibilité à cette heure-là, niveau, taux de réponse aux invitations, historique commun, proximité, terrain habituel.

**C'est l'écran qui suit la création.** Après avoir créé une partie, on atterrit directement sur la liste d'invitation.

**Des badges qui expliquent le choix.** Au plus deux badges par joueur : « Déjà joué ensemble », « Libre à l'heure de la partie », « Répond souvent », « Niveau de ta partie », « Actif cette semaine », « Terrain favori », « À proximité ».

**Les badges servent aussi de filtres.** Une rangée au-dessus de la liste reprend les mêmes critères. Ils se cumulent : « Terrain favori » plus « Déjà joué ensemble » ne garde que les joueurs qui ont les deux. Le tri se fait côté serveur, donc le nombre affiché est le vrai nombre et le défilement reste filtré.

Ce que les badges veulent dire précisément :

- **Libre à l'heure de la partie** : disponible sur toutes les heures couvertes par la partie, pas déjà engagé ailleurs au même moment, et horaire confirmé depuis moins de 2 semaines.
- **Répond souvent** : taux de réponse aux invitations reçues, en excluant les invitations automatiques et les parties annulées par l'hôte.
- **Niveau de ta partie** : correspond au niveau minimum exigé par la partie, ou à ton propre niveau si la partie n'exige rien.
- **Terrain favori** : le terrain de la partie est dans ses favoris, ou il y a joué au moins deux fois.
- **À proximité** : à moins de 5 km du terrain.

## Après la partie

**Proposition de suite après le feedback.** Une fois la partie évaluée, l'app propose de rejouer la semaine prochaine avec le formulaire prérempli, ou de rejoindre une autre partie.

## Les trois notifications actives

### Des terrains sont libres

**Le moment :** une partie vient d'être créée dans un parc sans réserver de terrain, et il en reste de libres à cette heure-là.

**Qui la reçoit :** l'organisateur.

**Garde-fou :** envoyée 10 minutes après la création, une seule fois par partie, jamais si le terrain est déjà réservé.

### Ta partie ne s'est pas remplie

**Le moment :** une partie vient de passer sans que personne ne se joigne.

**Qui la reçoit :** l'organisateur.

**Ce qu'on annonce :** le nombre de parties de cette semaine qu'il pourrait vraiment rejoindre, c'est-à-dire même niveau, préférence de genre respectée, à sa distance, et avec des places libres.

**En touchant :** les parties publiques s'ouvrent avec ces filtres déjà appliqués, donc la liste contient exactement le nombre annoncé.

### Inscriptions ouvertes

**Le moment :** un organisateur certifié ouvre les inscriptions d'un tournoi.

**Qui la reçoit :** les joueurs à moins de 50 km, du bon niveau, pas déjà inscrits.

**Garde-fou :** seulement les organisateurs certifiés, une seule fois par joueur et par tournoi, envoi étalé.

---

_Déployé sur staging pour les tests, pas en production._
