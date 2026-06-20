# Indicateur de réactivité — résumé d'une page

_Spec complet : `specs/responsiveness/README.fr.md`. Données : prod, 2026-06-20._

## L'idée

Un badge **« Répond vite »** sur la carte joueur et le profil, qui récompense les
joueurs qui répondent vraiment à leurs invitations de parties. Objectif : rendre la
réactivité visible et désirable, pour que les joueurs réactifs attirent plus de
parties.

## Pourquoi ça compte

Notre goulot, ce n'est pas l'offre de parties, c'est le côté « join » qui meurt en
silence (invitations ignorées). Un signal de réactivité attaque ça sur deux fronts :
les joueurs choisissent des adversaires qui répondent (moins d'invitations
gaspillées), et répondre devient un comportement visible et récompensé.

## Comment on le mesure

On se base sur les réponses aux invitations envoyées par un hôte (`match_participant`
est déjà instrumenté : envoyée → répondue / expirée). Un refus rapide compte comme
une réponse ; seul le **silence** est négatif.

**Deux filtres obligatoires, sinon la métrique ne vaut rien (prouvé par les données) :**

1. **Exclure les invitations auto-générées** : taux de réponse de 5 % vs 33 % pour
   les invitations humaines. Les compter ferait paraître tout le monde non réactif.
2. **Exclure les parties annulées par l'hôte** : 63 % des invitations « ignorées »
   venaient de parties annulées plus tard (l'invitation devient caduque, sans faute
   de l'invité).

Une fois filtré, le **vrai taux de réponse de base est de 57 %**, pas le 5-33 % que
suggéraient les chiffres bruts.

## La règle du badge (lancement)

Sur les **90 derniers jours** : au moins **3 invitations résolues** ET un **taux de
réponse ≥ 67 %** (répond à 2 invitations sur 3). C'est tout.

- **~16 joueurs** l'obtiendraient aujourd'hui (sur 150 destinataires actifs). Assez
  rare pour être désirable, assez fréquent pour apparaître en navigation.
- **Pas de barrière de temps.** On a vérifié : ceux qui répondent le font vite (ils
  laissent ~20 h de marge avant la partie), mais le temps ne sépare pas les bons des
  mauvais répondeurs. La rapidité reste affichée sur le profil, à titre descriptif.

## Décisions clés

- **Positif seulement.** Le badge apparaît au-dessus du seuil, rien en dessous.
  Jamais d'étiquette « lent ». Un signal négatif ferait fuir les nouveaux et les
  joueurs occasionnels.
- **Le taux, pas le temps.** Le taux est le signal qui discrimine.
- **Calcul précalculé** (table + job quotidien), jamais en direct dans la recherche
  (nos RPC de recherche frôlent déjà des timeouts de 8 s).

## Le vrai levier (phase 2)

Le badge est la carotte visible. Le gain réel, c'est de **classer les joueurs
réactifs plus haut** dans l'annuaire et de les pondérer dans les suggestions : ça
règle le goulot mécaniquement, pas juste par l'information. On lance le badge
d'abord, on branche le classement ensuite.

## Limite honnête

Au volume actuel d'invitations humaines, le badge est **rare (~16 joueurs)**. C'est
correct pour un signal premium, et la population grandit toute seule à mesure que
« find a match » remplace l'auto-génération. C'est pourquoi le score de classement
(phase 2) compte plus que le badge à long terme.

## Prochaine étape

Au choix : (1) **prototype du badge** sur la carte/profil avec une valeur fictive,
ou (2) **migration** (table `player_responsiveness` + recalcul quotidien).
