# Indicateur de réactivité — spec de la métrique

Statut : brouillon · Responsable : à déterminer · Mise à jour : 2026-06-20

Un signal positif uniquement qui récompense les joueurs qui répondent réellement
aux invitations de parties. Affiché comme badge sur la carte joueur et le profil,
et (phase 2) utilisé comme critère de classement. Objectif : rendre la réactivité
visible et désirable, pour que les joueurs réactifs attirent plus de parties et
que le goulot d'étranglement du côté « join » (les invitations qui meurent en
silence) reçoive une correction par le marché.

Ce spec est basé sur des données réelles de prod (extraites le 2026-06-20). Les
seuils ci-dessous sont dérivés de la distribution réelle, pas devinés.

---

## 1. Ce qu'on mesure (et ce qu'on évite délibérément)

**Signal : la réponse aux invitations de parties envoyées par un hôte.** Le cycle
de vie de `match_participant` est propre et déjà instrumenté (timestamps ajoutés
le 2026-06-09) :

- `created_at` : invitation envoyée
- `responded_at` : première réponse (accepter / refuser / proposer un horaire). NULL = jamais répondu.
- `expired_at` : invitation en attente qui a expiré (la partie a commencé ou a été annulée).

Une réponse reste une réponse, qu'on **accepte ou qu'on refuse**. Un « non » rapide
et clair garde le tunnel sain, c'est un comportement réactif. Seul le **silence**
(expiré avec `responded_at IS NULL`) est le signal négatif.

**Pas dans la v1 :**

- **Les messages de chat.** Trop bruités : la plupart des messages n'appellent pas
  de réponse, la « première réponse » est ambiguë, il y a les groupes, et lu-sans-
  répondre est parfaitement normal. Mesurer le taux de réponse au chat de façon
  naïve punirait un comportement normal. À revoir plus tard, seulement comme bonus
  secondaire.
- **Les auto-demandes** (`requested_at IS NOT NULL`). C'est le joueur qui fait la
  démarche, pas qui répond. Exclu.
- **La fiabilité** (no-shows, retards). Concept différent, déjà couvert par
  `reputation_event`. À garder séparé : les deux se complètent mais mesurent des
  choses différentes.

---

## 2. Les deux exclusions obligatoires (sans elles, la métrique ne vaut rien)

Les données de prod ont prouvé que les deux sont déterminantes :

### 2a. Exclure les invitations auto-générées (`match.is_auto_generated = true`)

L'auto-génération de parties inonde les joueurs d'invitations machine qu'ils
ignorent de façon rationnelle.

| Source de l'invitation      | Répondu | Ignoré (expiré) | Taux de réponse (résolu) |
| --------------------------- | ------- | --------------- | ------------------------ |
| Auto-générée                | 265     | 5 046           | **5,0 %**                |
| Humaine (créée par un hôte) | 205     | 419             | 32,9 %                   |

Compter les auto-invitations fait paraître _tout le monde_ non réactif et rend le
badge inatteignable. La réactivité est calculée **uniquement sur les invitations
humaines**.

### 2b. Exclure les expirations des parties annulées (`match.cancelled_at IS NOT NULL`)

Sur 419 invitations humaines ignorées, **263 (63 %) appartenaient à des parties que
l'hôte a annulées par la suite** : l'invitation est devenue caduque, sans faute de
l'invité. L'invitation médiane est restée active environ 17 jours avant d'expirer,
donc « pas eu le temps » n'est pas le problème. L'annulation est toute la
distorsion.

Effet du filtre sur le taux de base honnête :

- Brut (toutes les invitations humaines) : 205 / 624 = **32,9 %**
- Juste (expirations de parties annulées retirées) : 205 / 361 = **56,8 %**

**Règles de résolution (par invitation) :**

```
répondu     := responded_at IS NOT NULL
ignoré      := responded_at IS NULL AND expired_at IS NOT NULL AND match.cancelled_at IS NULL
non résolu  := responded_at IS NULL AND expired_at IS NULL          -- encore en attente, non compté
exclu       := match.is_auto_generated OR (ignoré mais match.cancelled_at IS NOT NULL)

résolu      := répondu OR ignoré
```

(Si un joueur a répondu à une invitation dont la partie a été annulée _plus tard_,
ça compte quand même comme `répondu` : il a été réactif.)

---

## 3. La métrique

### Population éligible (par joueur destinataire, fenêtre glissante)

```sql
match_participant mp JOIN match m ON m.id = mp.match_id
WHERE mp.is_host = false
  AND mp.requested_at IS NULL          -- invité par un hôte, pas une auto-demande
  AND m.is_auto_generated = false      -- exclusion 2a
  AND mp.created_at >= now() - interval '90 days'
```

### Quantités

- `invites_resolved` = répondu + ignoré (règles du §2 ; les expirations de parties
  annulées ne comptent pas comme ignoré, exclusion 2b)
- `invites_responded` = nombre avec `responded_at IS NOT NULL`
- `response_rate` = invites_responded / invites_resolved
- `median_response_seconds` = médiane de (`responded_at - created_at`) sur les invitations répondues

### Pourquoi le taux est la vedette (la « rapidité » doit se mesurer relativement au délai avant la partie)

Mise en garde méthodologique (relevée en révision) : le brut « 97 % des réponses
dans les 24 h » ne prouve **pas** la rapidité. `expired_at` est posé au début de la
partie, et une réponse doit arriver avant l'expiration. Si les parties commencent
bientôt, « répondu dans les 24 h » veut seulement dire « répondu avant la partie »,
pas « répondu vite ». Le stat est censuré par l'échéance. La rapidité n'a de sens
que **relativement au délai disponible** (invitation envoyée → début de la partie).

Mesuré correctement (invitations humaines, 90 j) :

- **Délai avant la partie** (invitation → début) : p50 ≈ 15-22 h ; ~55-69 % des
  parties commencent dans les 24 h, ~86 % dans les 72 h. La plupart commencent dans
  la journée, mais il y a une vraie traîne de plusieurs jours.
- **Délai de réponse en proportion du délai disponible** : p50 = 1,3 %, p75 = 14 %,
  p90 = 55 %. Le répondeur médian avait encore **~20 h de marge** au moment de
  répondre ; seulement 6 % répondent avec moins de 1 h de marge.

Donc même après avoir retiré la censure, ceux qui répondent sont réellement
rapides : ils répondent après n'avoir utilisé qu'une fraction de la fenêtre. La
conclusion tient, honnêtement cette fois : **le taux est le signal qui discrimine ;
le temps ne sépare pas les bons répondeurs des mauvais.** Le badge ne se base donc
**pas** sur le temps. La rapidité typique est affichée sur le profil à titre
descriptif seulement.

---

## 4. Définition du badge (lancement)

**Un joueur obtient le badge « Réactif » quand, sur les 90 derniers jours :**

1. `invites_resolved >= 3` (seuil d'échantillon), **et**
2. `response_rate >= 0,67` (répond à au moins 2 invitations sur 3)

Pas de barrière de temps. Mesurée relativement au délai avant la partie, la
rapidité ne sépare pas les bons répondeurs des mauvais (le répondeur médian laisse
~20 h de marge, voir §3) : s'en servir comme barrière n'ajouterait que du bruit. Le
temps de réponse typique est montré sur le profil à titre descriptif, jamais comme
condition du badge.

### Ce que les données disent que ça donne (prod, aujourd'hui)

Population juste, fenêtre de 90 jours : 150 joueurs avec ≥1 invitation résolue, 39
avec ≥3, 23 avec ≥5. Taux de réponse moyen dans la cohorte ≥3 = 55 %.

| Seuil       | Seuil de taux | Joueurs qui l'obtiendraient |
| ----------- | ------------- | --------------------------- |
| ≥3 résolues | ≥67 %         | **16**                      |
| ≥3 résolues | ≥80 %         | 10                          |
| ≥5 résolues | ≥67 %         | 6                           |
| ≥5 résolues | ≥80 %         | 5                           |

**Recommandation au lancement = ≥3 / ≥67 % → ~16 joueurs badgés** (~41 % de la
cohorte ≥3, ~10 % de tous les destinataires actifs). Assez rare pour être désirable,
assez fréquent pour apparaître réellement en navigation. 67 % est nettement au-
dessus de la moyenne de 55 % et facile à expliquer (« répond à 2 invitations sur 3 »).

### Règle de visibilité (positif uniquement)

- Sous le seuil : **ne rien afficher**. Jamais de « lent », jamais de score bas. Un
  signal négatif fait fuir les joueurs nouveaux ou occasionnels et va à l'encontre
  de l'objectif de désirabilité.
- On reprend la logique de réputation existante : `ReputationDisplay.isVisible`
  n'affiche qu'une fois assez de données accumulées. `responsiveness.is_visible`
  suit la même idée (seuil d'échantillon atteint + seuil de taux franchi).
- Les nouveaux joueurs sans invitation n'ont tout simplement pas de badge : neutre,
  pas pénalisé.

---

## 5. Score continu (phase 2, pour le classement)

Le badge est binaire et, vu le volume actuel d'invitations humaines, **rare (~16
joueurs)**. Pour que les données rares restent utiles, on calcule un
`responsiveness_score` continu (0-100) pour le **classement / tri et la pondération
des suggestions de parties**, même sous le seuil du badge.

On utilise la **borne inférieure de Wilson** du taux de réponse (95 %), pas le taux
brut, pour que les petits échantillons soient pénalisés et que le volume soit
récompensé :

- 2/3 (67 %, n=3) → borne inf. Wilson ≈ 0,21
- 8/12 (67 %, n=12) → borne inf. Wilson ≈ 0,39

`responsiveness_score = round(100 * wilson_lower_bound(responded, resolved))`.

C'est le vrai levier : si les joueurs réactifs remontent dans l'annuaire et sont
pondérés dans les suggestions, le goulot du côté « join » se règle _mécaniquement_,
pas juste par l'information. Le badge est la carotte visible, le classement est le
gain. On lance le badge d'abord, on branche le score sur le classement une fois
qu'on lui fait confiance.

---

## 6. Stockage et calcul (calqué sur `player_reputation`)

**Ne pas calculer en ligne dans `search_players_nearby`.** Les RPC de
suggestion/recherche atteignent déjà des timeouts de 8 s à ~250 joueurs ; un agrégat
sur fenêtre par ligne empire la situation. On précalcule, exactement comme la
réputation.

Nouvelle table `player_responsiveness` :

| colonne                   | type             | notes                               |
| ------------------------- | ---------------- | ----------------------------------- |
| `player_id`               | uuid PK → player |                                     |
| `invites_resolved`        | int              | 90 derniers jours, population juste |
| `invites_responded`       | int              |                                     |
| `response_rate`           | numeric          | responded / resolved                |
| `median_response_seconds` | int              | null si 0 répondu                   |
| `responsiveness_score`    | int              | borne inf. Wilson × 100 (phase 2)   |
| `is_responsive`           | bool             | badge obtenu (§4)                   |
| `is_visible`              | bool             | seuil d'échantillon atteint         |
| `window_start`            | timestamptz      |                                     |
| `calculated_at`           | timestamptz      |                                     |
| `updated_at`              | timestamptz      |                                     |

Rafraîchir via `recalculate_all_responsiveness()` dans un job `pg_cron` quotidien
(faible volatilité : un calcul par jour suffit, le badge n'a pas besoin d'être en
temps réel). Suivre le modèle de `recalculate_player_reputation`. Ne pas oublier les
GRANT explicites sur la nouvelle table publique (Supabase retire les grants Data API
par défaut).

---

## 7. Branchement dans l'app

1. **`PlayerSearchResult`** (`packages/shared-services/src/players/playerService.ts`) :
   ajouter des champs à côté de ceux de réputation :
   `responsiveness_is_responsive: boolean`, `response_rate: number | null`,
   `responsiveness_is_visible: boolean`.
2. **`search_players_nearby()`** + le RPC du profil : faire un
   `LEFT JOIN player_responsiveness` et retourner les colonnes précalculées (aucune
   agrégation dans le RPC).
3. **`ResponsivenessBadge`** : nouveau composant à côté de
   `apps/mobile/src/components/ReputationBadge.tsx` ; l'afficher dans la rangée de
   badges de `PlayerCard.tsx` (à côté de `RatingBadge` / `ReputationBadge`) et dans
   `PlayerProfile.tsx`.
   - Carte : puce compacte seulement si `is_responsive` (ex. ⚡ « Répond vite »).
   - Profil : ligne plus riche, ex. « Répond à la plupart des invitations, souvent
     en moins d'une heure. » Seulement si visible.

### Copy (suivre les conventions du repo)

- Côté utilisateur, FR : « Répond vite ». Ton québécois correct, pas de tirets cadratins.
- EN : « Responsive » / « Quick to reply ».
- Pas de 🎾 (on sert les deux sports) : utiliser ⚡ / 💬 / ✅.
- Garder `match` dans les identifiants code/DB ; « invitations » / « parties » dans le copy.

---

## 8. Cas limites et pièges

- **Refuser compte comme une réponse** : ne pas punir un « non » rapide.
- **Expirations de parties annulées exclues** (§2b) : 63 % des « ignorés » étaient ça.
- **Auto-invitations exclues** (§2a) : feraient tomber tout le monde à ~5 %.
- **Échantillon minimal + fenêtre glissante** : `>=3 résolues`, 90 jours. Évite
  qu'une invitation malchanceuse définisse un badge ; récompense le comportement
  _actuel_.
- **Invitations à court délai** : mesuré par rapport au début de la partie, les
  invitations ignorées avaient un délai médian de ~15 h, et 23 % visaient des parties
  commençant dans les 6 h suivant l'invitation, mais la même proportion de 23 % se
  retrouve chez les invitations _répondues_, donc un court délai ne prédit pas le
  fait d'ignorer. Aucune exclusion nécessaire pour l'instant ; à revoir si les
  invitations de dernière minute augmentent (une partie qui doit commencer dans <2 h
  et qui reste sans réponse est à la limite du « pas vue », pas du « ignorée »).
- **Triche** : risque faible (on récompense un comportement qu'on veut). Surveiller
  l'auto-accept-puis-no-show ; ça, c'est capté par les événements no-show de
  réputation, pas ici.

---

## 9. Déploiement et quoi surveiller

1. Livrer la table `player_responsiveness` + le cron quotidien (sans UI).
2. Vérifier que l'ensemble badgé a du sens (~16 joueurs) et reste stable d'un
   rafraîchissement à l'autre.
3. Ajouter le badge sur la carte + le profil derrière la règle de visibilité.
4. Phase 2 : brancher `responsiveness_score` sur le tri de l'annuaire + la
   pondération des suggestions.
5. Mesurer : est-ce que les invitations aux joueurs badgés sont plus répondues / se
   convertissent en parties remplies à un meilleur taux ? Est-ce que la présence du
   badge corrèle avec le CTR profil → invitation ?

### Boutons de réglage ouverts (valeurs par défaut basées sur les données ; à revoir avec le volume)

- Fenêtre : 90 j (choisie pour l'échantillon ; l'instrumentation ne remonte qu'à ~avril 2026).
- Seuil d'échantillon : 3 résolues. Le monter à 5 réduit l'ensemble badgé à ~6, trop peu pour un lancement.
- Seuil de taux : 67 %. 80 % donne un palier « top répondeur » plus serré (~10 joueurs) si on préfère que ça se lise comme une élite.
- À mesure que le volume d'invitations humaines grandit (surtout quand « find a
  match » remplace l'auto-génération), la population badgée grandit sans changer les seuils.

```

```
