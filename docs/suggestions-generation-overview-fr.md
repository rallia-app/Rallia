# Suggestions — comment elles sont générées

**Une suggestion = un trio (adversaire, lieu, créneau).** On en produit quand il manque de vrais matchs à afficher. Les vrais matchs passent toujours en premier; les suggestions complètent.

## Vue d'ensemble (les 5 étapes)

1. **Choisir les adversaires candidats** — filtres durs : sport, distance, disponibilité partagée, niveau, etc.
2. **Calculer un score de compatibilité** pour chaque adversaire (`player_compat`, entre 0 et 1).
3. **Calculer un score de lieu** pour chaque (adversaire × installation) (`facility_affinity`, entre 0 et 1).
4. **Générer les créneaux horaires** réels (parmi 6 heures fixes : 8 h, 10 h, 14 h, 16 h, 18 h, 20 h) sur les 7 prochains jours, en excluant les conflits d'horaire des deux côtés.
5. **Classer et dédupliquer** — un seul créneau par adversaire (le mieux noté), trié par score, on garde les N premiers (5, 15 ou 30 selon l'écran).

Le score final d'une suggestion : `0,70 × compatibilité du joueur + 0,30 × affinité du lieu`, plus de petits boosts (urgence du créneau, nombre de créneaux disponibles, un peu d'aléatoire).

---

## Joueur connecté vs. visiteur non connecté

La grosse différence : **un visiteur n'a pas d'identité**. On ne peut donc pas comparer son niveau, son historique ou ses préférences à celles de l'adversaire. La logique se rabat alors sur des signaux génériques de qualité de l'adversaire (est-il actif ? répond-il ? est-il flexible ?).

### Joueur connecté — facteurs de compatibilité

Mélange pondéré (somme = 1,0) :

| Facteur                | Poids | Ce qu'on regarde                                                                                    |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| Type de match          | 18 %  | Casuel vs compétitif — les deux veulent la même chose                                               |
| Niveau                 | 18 %  | Écart de classement ≤ 0,5, modulé selon la fiabilité du badge (certifié, auto-déclaré, contesté)    |
| Durée préférée         | 5 %   | Même durée souhaitée (30, 60, 90, 120 min)                                                          |
| Disponibilité partagée | 22 %  | Cases (jour × période) en commun. 7+ cases = crédit plein.                                          |
| Réputation             | 10 %  | Score de réputation public de l'adversaire (si non public → neutre)                                 |
| Réactivité             | 17 %  | À quel point l'adversaire répond et accepte les invitations (90 derniers jours). Nouveaux = neutre. |
| Activité               | 10 %  | Date de dernière connexion. Actifs cette semaine = max; > 90 jours = très bas.                      |

**Ajustements supplémentaires sur `player_compat`** :

- **Historique caller↔adversaire** (`-0,5` à `+0,5`) : matchs passés (récents pondérés plus fort), étoiles données, favori, réseaux partagés, conversations — vs rapports, no-shows, retards. Activé seulement quand on a au moins 2 signaux (sinon = 0, pour éviter qu'un seul favori fasse exploser le classement).
- **Pénalité « contesté »** (`-0,15`) : un adversaire dont le classement est contesté est rétrogradé d'un cran, sans être exclu.

**Filtres durs** (avant même le scoring) :

- Sport en commun, actif.
- Distance respectée pour les deux côtés (rayon de l'appelant ET rayon de l'adversaire).
- Au moins une case (jour × période) en commun.
- Écart de classement ≤ 0,5 (sauf si l'un des deux n'a pas de classement).
- Pas de blocage mutuel.
- L'adversaire n'a pas déjà une invitation en attente venant de l'appelant.

### Visiteur non connecté — facteurs de compatibilité

Pas d'identité → pas de comparaison personnelle. On classe les adversaires sur leur **qualité brute** :

| Facteur                  | Poids | Ce qu'on regarde                                                               |
| ------------------------ | ----- | ------------------------------------------------------------------------------ |
| Densité de disponibilité | 60 %  | Nombre de cases (jour × période) flaggées par l'adversaire / 21. Plus = mieux. |
| Réactivité               | 25 %  | Même calcul que connecté.                                                      |
| Activité                 | 15 %  | Même calcul que connecté.                                                      |

**Filtres durs** :

- Sport en commun, actif.
- Adversaire dans le rayon donné (par défaut 25 km autour des coordonnées du visiteur).
- Au moins une case de disponibilité active.

**Pas de filtre de niveau, pas d'historique, pas de pénalité contestée.** Le visiteur ne peut pas voir tous ces signaux personnels.

---

## Affinité du lieu (`facility_affinity`)

Pour chaque installation favorite de l'adversaire qui est aussi joignable par les deux, on calcule :

### Connecté

| Composante           | Poids | Détail                                                                                                                          |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| Lieu favori partagé  | 30 %  | L'appelant a aussi cette installation en favori (binaire).                                                                      |
| Proximité appelant   | 25 %  | Plus c'est proche de l'appelant, mieux c'est.                                                                                   |
| Proximité adversaire | 25 %  | Plus c'est proche de l'adversaire, mieux c'est.                                                                                 |
| Bookabilité (3 j)    | 20 %  | Nombre de créneaux confirmés disponibles via le fournisseur externe. Pas de fournisseur ou pas encore rafraîchi → neutre (0,5). |

### Visiteur

| Composante           | Poids |
| -------------------- | ----- |
| Proximité appelant   | 50 %  |
| Proximité adversaire | 30 %  |
| Bookabilité (3 j)    | 20 %  |

---

## Génération des créneaux

Une fois les paires (adversaire, installation) classées, on génère leurs créneaux :

- **Horaires fixes** : 8 h, 10 h, 14 h, 16 h, 18 h, 20 h (heure locale).
- **Fenêtre** : 7 prochains jours.
- **Filtres** :
  - La case (jour × période) doit être active pour l'adversaire (et pour l'appelant en mode connecté).
  - Aucun conflit avec les matchs déjà bookés des deux côtés.
  - Dans la fenêtre 3 jours, si l'installation a un fournisseur externe avec données fraîches, on garde seulement les créneaux confirmés disponibles. Hors fenêtre ou sans données → on émet quand même (mieux vaut une suggestion spéculative qu'aucune).

**Petits boosts au score final** :

- **Urgence** : +0,05 pour aujourd'hui/demain, +0,03 à J+2, +0,01 à J+3, sinon 0.
- **Actionnabilité** : jusqu'à +0,10 pour les adversaires qui ont beaucoup de créneaux disponibles (signal de flexibilité réelle).
- **Aléatoire** : ±0,03 pour éviter les égalités identiques d'une requête à l'autre.

---

## Déduplication finale

Beaucoup de paires (adversaire × installation × créneau) sortent du pipeline. On garde **un seul créneau par adversaire** (celui qui a le meilleur score), puis on trie tous les adversaires retenus par score décroissant et on coupe à N (5, 15, 30 selon l'écran).

---

## Pourquoi cette logique

- **Visiteurs** : on optimise pour « voici des gens actifs et flexibles près de chez toi » — on ne peut pas mieux faire sans identité.
- **Connectés** : on optimise pour « voici la meilleure occasion réelle pour TOI » — on combine compatibilité personnelle, qualité de la relation, et qualité du lieu.
- **Les vrais matchs passent toujours avant** : les suggestions ne remplacent pas l'inventaire réel, elles le complètent quand il manque de matière.
