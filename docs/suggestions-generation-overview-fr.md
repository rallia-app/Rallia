# Suggestions — comment elles sont générées

**Une suggestion = un trio (adversaire, lieu, créneau).** On en produit quand il manque de vrais matchs à afficher. Les vrais matchs passent toujours en premier; les suggestions complètent.

Ce document décrit la logique complète de génération pour les deux modes :

- **Mode connecté** : un joueur authentifié reçoit des suggestions personnalisées (compatibilité personnelle + historique).
- **Mode visiteur** : un visiteur non connecté reçoit des suggestions basées uniquement sur la qualité brute des adversaires (pas d'identité, donc pas de comparaison personnelle).

---

## Vue d'ensemble (les 5 étapes)

1. **Sélection des adversaires candidats** — filtres durs (sport, distance, etc.) puis tri par distance, plafond du bassin.
2. **Score de compatibilité** par adversaire (`player_compat`, entre 0 et 1).
3. **Score de lieu** pour chaque (adversaire × installation favorite) (`facility_affinity`, entre 0 et 1).
4. **Génération des créneaux** réels (6 heures fixes : 8 h, 10 h, 14 h, 16 h, 18 h, 20 h) sur les 7 prochains jours, en excluant les conflits d'horaire et — pour la fenêtre 3 jours — les créneaux non bookables connus.
5. **Boosts du score final**, déduplication par adversaire, classement et coupe à N (5, 15 ou 30 selon l'écran).

**Formule finale d'une suggestion** :

```
score_final = 0,70 × player_compat + 0,30 × facility_affinity + boost_urgence + boost_actionnabilité + jitter
```

---

## Mode connecté — sélection des adversaires

### Filtres durs (avant le scoring)

Un adversaire doit satisfaire **toutes** ces conditions :

- Il pratique le même sport (entrée active dans `player_sport`).
- Sa position est connue, et il est dans le rayon de déplacement de l'appelant.
- **Aucun blocage mutuel** (dans l'une ou l'autre direction).
- **Au moins une case (jour × période) en commun** avec la disponibilité de l'appelant.
- **Écart de classement ≤ 0,5** — sauf si l'un des deux n'a pas de classement, auquel cas le filtre est désactivé.
- L'appelant n'a pas déjà une invitation en attente pour cet adversaire (suppression côté TypeScript, après l'appel SQL).
- L'adversaire a **au moins une installation favorite** pour ce sport qui est joignable par les deux côtés (rayons de l'appelant ET de l'adversaire respectés). **Sans installation favorite reachable des deux côtés, l'adversaire n'apparaît pas.**

### Plafond du bassin

Après filtrage, on garde les **500 adversaires les plus proches** (tri par distance). Au-delà, ils sont coupés avant le scoring. Le RPC retourne ensuite les meilleurs `p_limit` triplets — par défaut 140 pour le pipeline TS.

### Les 7 facteurs de compatibilité (`player_compat`)

Mélange pondéré, somme = 1,0 :

| Facteur                | Poids | Détail                                                                                                                                                                                                                     |
| ---------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type de match          | 18 %  | Casuel vs compétitif. Identique = 1,0. L'un des deux dit « les deux » = 0,7. Sinon 0.                                                                                                                                      |
| Niveau                 | 18 %  | Voir détail ci-dessous (écart × fiabilité du badge).                                                                                                                                                                       |
| Durée préférée         | 5 %   | Identique = 1,0. Adjacente (ex. 60↔90) = 0,5. 2 paliers d'écart (ex. 60↔120, 30↔90) = 0,3. Au-delà = 0,2. Manquante d'un côté = 0,5.                                                                                       |
| Disponibilité partagée | 22 %  | `min(cases en commun / 7, 1,0)`. 7+ cases (jour × période) en commun = crédit plein.                                                                                                                                       |
| Réputation             | 10 %  | Si profil public et ≥ 5 événements de réputation : `score / 100`. Sinon (privé, ou < 5 événements) : 0,5 neutre. La carte affiche aussi le « tier » comme « inconnu » tant que le seuil de 5 événements n'est pas atteint. |
| Réactivité             | 17 %  | Voir détail ci-dessous.                                                                                                                                                                                                    |
| Activité               | 10 %  | Buckets sur la date de dernière connexion (voir détail ci-dessous).                                                                                                                                                        |

#### Détail — Niveau (score_skill)

Le score est un **produit de deux composantes** : l'écart de classement × la fiabilité des badges.

**Composante écart** :

| Écart absolu                        | Score |
| ----------------------------------- | ----- |
| 0 (identique)                       | 1,0   |
| ≤ 0,5                               | 0,7   |
| ≤ 1,0                               | 0,3   |
| > 1,0                               | 0,0   |
| L'un des deux n'a pas de classement | 0,5   |

**Composante fiabilité du badge** (multiplicateur appliqué) :

| Appelant ↓ / Adversaire → | certifié | auto-déclaré | contesté |
| ------------------------- | -------- | ------------ | -------- |
| certifié                  | 1,0      | 0,6          | 0,3      |
| auto-déclaré              | 0,6      | 0,4          | 0,2      |
| contesté                  | 0,3      | 0,2          | 0,1      |
| pas de badge              | 0,5      | 0,5          | 0,3      |

#### Détail — Réactivité (score_responsiveness)

Calculé sur les 90 derniers jours d'invitations reçues par cet adversaire.

```
responsiveness = 0,7 × taux_réponse + 0,3 × taux_acceptation
```

où :

- `taux_réponse` = (joined + declined + left + refused) / invitations reçues
- `taux_acceptation` = joined / réponses données

**Garde-fou nouveaux joueurs** : moins de 3 invitations reçues sur 90 j → 0,5 (neutre).

#### Détail — Activité (score_activity)

Buckets sur le délai depuis la dernière connexion :

| Délai depuis la dernière connexion | Score |
| ---------------------------------- | ----- |
| ≤ 7 jours                          | 1,00  |
| ≤ 14 jours                         | 0,85  |
| ≤ 30 jours                         | 0,70  |
| ≤ 60 jours                         | 0,50  |
| ≤ 90 jours                         | 0,30  |
| > 90 jours (ou aucune connexion)   | 0,10  |

### Ajustements supplémentaires sur `player_compat`

Appliqués sur le mélange pondéré (et clampés ensuite dans `[0, 1]`) :

- **Historique caller↔adversaire** (`-0,5` à `+0,5`, ajouté avec un coefficient 0,5 → impact ±0,25 max sur `player_compat`) : voir détail ci-dessous.
- **Pénalité « contesté »** (`-0,15` flat) : si l'adversaire a un badge `disputed` sur son classement, on rétrograde de 0,15. Indépendant du multiplicateur de fiabilité du score_skill (donc le penalty s'applique même si l'un des deux n'a pas de rating et que score_skill est neutre).

#### Détail du score d'historique

**Signaux positifs** (poussent le score vers +0,5) :

| Signal                         | Impact                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Matchs joués ensemble          | Jusqu'à +0,40. Récents pondérés plus fort : ≤ 90 j = poids plein (×1,0), ≤ 180 j = ½, ≤ 365 j = ¼, au-delà = 0.             |
| Étoiles données par l'appelant | Jusqu'à ±0,30 (signé : 5★ = positif, 1★ = négatif, 3★ = neutre), récents pondérés plus fort selon la même décroissance.     |
| Favori (appelant → adversaire) | +0,15.                                                                                                                      |
| Favori mutuel                  | +0,10 supplémentaires (en plus du +0,15) quand l'adversaire a aussi mis l'appelant en favori.                               |
| Réseaux partagés               | Poids selon le type de réseau le plus fort en commun (voir tableau), plafonné à +0,20.                                      |
| Conversations                  | +0,05 si une conversation existe; +0,05 supplémentaires s'il y a au moins un message dans les 30 derniers jours. Max +0,10. |

**Pondération par type de réseau partagé** (on prend le poids du réseau le plus fort en commun) :

| Type de réseau           | Poids |
| ------------------------ | ----- |
| Amis / groupe de joueurs | 0,20  |
| Club                     | 0,12  |
| Communauté               | 0,08  |
| Réseau privé             | 0,06  |
| Réseau public            | 0,04  |

**Signaux négatifs** (poussent le score vers −0,5) :

| Signal                                               | Impact                          |
| ---------------------------------------------------- | ------------------------------- |
| Signalements de joueur (par l'appelant, non rejetés) | −0,20 chacun, plafonné à −0,30. |
| Signalements de match (par l'appelant)               | −0,10 chacun, plafonné à −0,20. |
| No-shows marqués par l'appelant                      | −0,25 chacun, plafonné à −0,40. |
| Retards marqués par l'appelant                       | −0,05 chacun, plafonné à −0,10. |

**Garde-fou démarrage à froid** : si le total des événements (matchs joués + feedback + favori + réseaux + conversations + signalements) est `< 2`, on force `score_history = 0`. Évite qu'un seul signal isolé (un favori, un match) fasse exploser ou plomber le classement.

---

## Mode visiteur — sélection des adversaires

### Filtres durs (avant le scoring)

- Adversaire pratique le sport.
- Adversaire dans le rayon donné (par défaut **25 km** autour des coordonnées du visiteur).
- Adversaire a au moins **une case de disponibilité active** (n'importe laquelle — pas besoin de chevauchement, puisque le visiteur n'a pas de disponibilité enregistrée).
- Adversaire a **au moins une installation favorite** joignable par les deux côtés (rayon du visiteur ET rayon de l'adversaire).

**Pas de filtre de niveau, pas de filtre de blocage, pas de pénalité contestée, pas d'historique.** Le visiteur n'a pas d'identité, donc aucun de ces signaux personnels n'est calculable.

### Plafond du bassin

Après filtrage : les **200 adversaires les plus proches** (tri par distance). Le RPC retourne ensuite les meilleurs `p_limit` triplets — par défaut 140 pour le pipeline TS.

### Les 3 facteurs de compatibilité (`player_compat`)

| Facteur                  | Poids | Détail                                                                                                                                   |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Densité de disponibilité | 60 %  | Nombre de cases (jour × période) flaggées actives par l'adversaire / 21. Adversaire dispo toute la semaine = 1,0; une seule case ≈ 0,05. |
| Réactivité               | 25 %  | Exactement le même calcul qu'en mode connecté (avec le garde-fou « < 3 invitations → 0,5 »).                                             |
| Activité                 | 15 %  | Mêmes buckets que connecté.                                                                                                              |

---

## Affinité du lieu (`facility_affinity`)

Pour chaque installation favorite de l'adversaire qui est joignable par les deux côtés, on calcule une affinité dans `[0, 1]`.

### Mode connecté

```
facility_affinity = min(score_facility_geo + 0,20 × score_bookability, 1,0)
```

où `score_facility_geo` est la somme :

| Composante           | Poids | Détail                                                                                                        |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| Lieu favori partagé  | 30 %  | 0,30 si l'appelant a aussi cette installation en favori pour le sport. Sinon 0. Binaire.                      |
| Proximité appelant   | 25 %  | Rampe linéaire : `0,25 × max(0, 1 − distance_appelant / rayon_appelant)`. 0 au-delà du rayon, 0,25 sur place. |
| Proximité adversaire | 25 %  | Idem côté adversaire (rampe sur son propre rayon).                                                            |

### Mode visiteur

| Composante           | Poids | Détail                                                       |
| -------------------- | ----- | ------------------------------------------------------------ |
| Proximité visiteur   | 50 %  | Rampe linéaire sur le rayon de recherche (25 km par défaut). |
| Proximité adversaire | 30 %  | Rampe linéaire sur le rayon de déplacement de l'adversaire.  |

### Bookabilité (`score_bookability`) — commun aux deux modes

Ajoutée comme un boost (`+ 0,20 × score_bookability`) au-dessus de `score_facility_geo`. Le total est ensuite plafonné à 1,0.

| Situation de l'installation                                            | Score        |
| ---------------------------------------------------------------------- | ------------ |
| Pas de fournisseur externe (gérée en interne, installation locale)     | 0,5 (neutre) |
| Fournisseur externe mais snapshot jamais rafraîchi                     | 0,5 (neutre) |
| Snapshot frais : `min(1,0, nombre de créneaux confirmés sur 3 j / 30)` | 0,0 à 1,0    |

---

## Génération des créneaux

Pour chaque paire (adversaire, installation) retenue, on génère les créneaux candidats sur les **7 prochains jours**.

- **Heures fixes** : 8 h, 10 h, 14 h, 16 h, 18 h, 20 h (heure locale).
- **Périodes** : matin (8 h, 10 h), après-midi (14 h, 16 h), soir (18 h, 20 h).
- **Conditions à respecter** :
  - La case (jour × période) doit être active pour l'adversaire (et pour l'appelant en mode connecté). En mode visiteur, on autorise toutes les cases actives de l'adversaire.
  - Le créneau doit être strictement futur.
  - Pas de conflit avec les matchs déjà bookés de l'appelant (`joined`, `requested`, `pending`, `waitlisted`).
  - Pas de conflit avec ceux de l'adversaire.
  - **Fenêtre 3 jours** : si l'installation a un fournisseur externe avec snapshot rafraîchi, on **garde uniquement** les créneaux confirmés disponibles. Hors fenêtre, ou sans fournisseur, ou snapshot pas encore rafraîchi → on émet de façon spéculative (mieux vaut une suggestion candidate qu'aucune).

---

## Boosts du score final

Appliqués au score de chaque triplet (adversaire × installation × créneau) :

```
score_final = 0,70 × player_compat + 0,30 × facility_affinity
            + boost_urgence + boost_actionnabilité + jitter
```

| Boost              | Plage     | Détail                                                                                                                   |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Urgence            | 0 à +0,05 | Aujourd'hui ou demain : +0,05. J+2 : +0,03. J+3 : +0,01. Au-delà : 0.                                                    |
| Actionnabilité     | 0 à +0,10 | `min(0,10, max(0, (n_créneaux_pour_cet_adversaire − 1) × 0,012))`. Récompense les adversaires avec beaucoup de créneaux. |
| Jitter (aléatoire) | ±0,03     | Évite les égalités exactes d'une requête à l'autre.                                                                      |

---

## Déduplication finale et coupe à N

Beaucoup de triplets sortent du pipeline. On compresse :

1. **Un seul créneau par adversaire** : on garde le triplet le mieux noté pour chaque adversaire (sur l'ensemble des installations + créneaux).
2. **Tri par score décroissant**.
3. **Coupe à N** :
   - Accueil (« Juste pour vous » / « À proximité ») : 5 cartes (vrais matchs d'abord, suggestions en padding).
   - Matchs publics : padding jusqu'à 30 si moins de 30 vrais matchs disponibles.
   - Fenêtre de suggestions : 15.
   - Fin d'inscription : 5.
   - Courriel quotidien : 5 par sport actif.

---

## Récapitulatif — différences clés connecté vs visiteur

| Aspect                                   | Connecté                        | Visiteur                                       |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Filtre de niveau (±0,5)                  | ✅ Oui                          | ❌ Non                                         |
| Filtre de blocage                        | ✅ Oui (dans les deux sens)     | ❌ Non                                         |
| Exclusion des adversaires déjà invités   | ✅ Oui                          | ❌ Non                                         |
| Compatibilité personnelle (7 facteurs)   | ✅ Oui                          | ❌ Non (3 signaux génériques)                  |
| Historique caller↔adversaire             | ✅ Oui (±0,5)                   | ❌ Non                                         |
| Pénalité « contesté » (−0,15)            | ✅ Oui                          | ❌ Non                                         |
| Densité de disponibilité de l'adversaire | Indirecte (via overlap partagé) | Signal principal (60 %)                        |
| Score de réactivité                      | 17 %                            | 25 %                                           |
| Score d'activité                         | 10 %                            | 15 %                                           |
| Plafond du bassin d'adversaires          | 500 plus proches                | 200 plus proches                               |
| Rayon de recherche                       | `max_travel_distance` du joueur | 25 km par défaut autour des coords du visiteur |

**Communs aux deux modes** :

- Adversaire doit avoir au moins une installation favorite joignable par les deux côtés.
- Mêmes 6 heures fixes pour les créneaux, même fenêtre 7 jours.
- Mêmes conflits busy filtrés (pour l'adversaire des deux côtés; pour l'appelant uniquement en connecté).
- Même filtre de bookabilité dans la fenêtre 3 jours quand le fournisseur a des données fraîches.
- Mêmes boosts (urgence, actionnabilité, jitter).
- Même formule finale `0,70 × compat + 0,30 × lieu`.

---

## Pourquoi cette logique

- **Visiteurs** : on optimise pour « voici des gens actifs, flexibles et près de chez toi » — on ne peut pas mieux faire sans identité.
- **Connectés** : on optimise pour « voici la meilleure occasion réelle pour TOI » — on combine compatibilité personnelle, qualité de la relation, et qualité du lieu.
- **Les vrais matchs passent toujours avant** : les suggestions ne remplacent pas l'inventaire réel, elles le complètent quand il manque de matière.
- **Démarrage à froid bienveillant** : nouveaux joueurs, nouveaux pairs, nouvelles installations — toujours des défauts neutres (0,5) pour éviter de plomber un joueur faute de données.
