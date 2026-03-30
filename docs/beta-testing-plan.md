# Plan de test bêta — Rallia

**Période :** 30 mars – 3 mai 2026
**Testeurs :** ~100 utilisateurs
**Distribution :** Google Play Console (piste privée), App Store Connect (TestFlight externe)
**Objectif :** Valider la stabilité, l'utilisabilité et les parcours clés avant le lancement public

---

## Phase 1 : Déploiement contrôlé (Jours 1–5 | 30 mars – 3 avril)

- Commencer avec 10–20 testeurs de confiance (équipe, proches, utilisateurs avancés) avant d'ouvrir aux 100
- Mettre en place un canal de rétroaction principal (Slack/Discord dédié, Google Form ou mécanisme intégré à l'app)
- Préparer et partager une **liste des problèmes connus** pour éviter les doublons de rapports
- Rédiger un **guide du testeur** couvrant :
  - Quoi tester (parcours clés, écrans spécifiques)
  - Comment signaler un bogue (canal, format attendu)
  - À quoi s'attendre (c'est une bêta, des choses vont casser)

## Phase 2 : Bêta complète (Jours 5–20 | 3 avril – 19 avril)

- Ouvrir à l'ensemble des 100 testeurs
- Orienter les testeurs vers les **parcours principaux** :
  - Inscription et accueil (onboarding)
  - Découverte des installations et terrains
  - Parcours de réservation
  - Fonctionnalités clés de la proposition de valeur
- Surveiller activement :
  - Taux sans plantage (cible >99 %)
  - Complétion de l'onboarding — où les gens décrochent-ils ?
  - Complétion des parcours principaux — les utilisateurs arrivent-ils à terminer les tâches essentielles ?
  - Performance — temps de démarrage à froid, temps de réponse API sur réseaux réels
  - Notifications push sur les deux plateformes
  - Cas limites — connectivité faible, transitions arrière-plan/premier plan, tailles d'écran variées
- **Sondage mi-bêta (~jour 15) :**
  - « Qu'est-ce qui est confus ? »
  - « Qu'est-ce qui manque ? »
  - « Recommanderiez-vous cette app à un ami ? »

## Phase 3 : Stabilisation (Jours 20–30 | 19 avril – 30 avril)

- **Gel des fonctionnalités** — corrections de bogues et polissage seulement
- Résoudre tous les bogues P0/P1
- Finaliser les fiches des magasins :
  - Captures d'écran et descriptions (en-US et fr-CA)
  - Politique de confidentialité
  - Formulaire de sécurité des données (Google Play)
  - Détails de confidentialité de l'app (Apple)
- Soumettre à la révision de l'App Store tôt — la première révision peut prendre plus de temps et révéler des problèmes de métadonnées ou de lignes directrices
- Envoyer un **sondage de satisfaction final** (~jour 28)

## Semaine tampon (27 avril – 3 mai)

- Traiter les retours de la révision App Store
- Dernières corrections de bogues
- Lancement public

---

## Métriques clés à suivre

| Métrique                     | Cible                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Sessions sans plantage       | >99,5 %                                               |
| DAU/MAU des testeurs         | >30 % (signal de rétention)                           |
| Durée moyenne de session     | Établir une référence pour comparaison post-lancement |
| Rapports de bogues           | Tendance vers zéro P0/P1 au jour 25                   |
| NPS ou score de satisfaction | Mesurer aux jours 15 et 28                            |

---

## Résumé hebdomadaire

| Semaine   | Dates               | Priorité                                                     |
| --------- | ------------------- | ------------------------------------------------------------ |
| Semaine 1 | 30 mars – 5 avril   | Déploiement contrôlé, triage initial des bogues              |
| Semaine 2 | 6 avril – 12 avril  | Bêta complète, surveiller les parcours principaux            |
| Semaine 3 | 13 avril – 19 avril | Sondage mi-bêta, corriger les problèmes critiques            |
| Semaine 4 | 20 avril – 26 avril | Gel des fonctionnalités, stabiliser, soumettre aux magasins  |
| Tampon    | 27 avril – 3 mai    | Révision des magasins, corrections finales, lancement public |

---

## Liste de vérification

- [ ] Mettre en place le suivi des plantages (Sentry / Crashlytics)
- [ ] Mettre en place l'analytique pour le suivi des parcours principaux
- [ ] Créer le canal de rétroaction et le partager aux testeurs
- [ ] Rédiger le guide du testeur
- [ ] Préparer la liste des problèmes connus
- [ ] Inviter les 10–20 premiers testeurs
- [ ] Inviter les testeurs restants (jour 5)
- [ ] Envoyer le sondage mi-bêta (jour 15)
- [ ] Tester le flux de mise à jour OTA via EAS Update pendant la bêta
- [ ] Vérifier les liens profonds / liens universels / app links sur les deux plateformes
- [ ] Tester les flux de paiement/achats intégrés si applicable
- [ ] Finaliser les fiches des magasins (deux langues)
- [ ] Préparer la politique de confidentialité et les formulaires de sécurité des données
- [ ] Soumettre à la révision de l'App Store
- [ ] Envoyer le sondage de satisfaction final (jour 28)
- [ ] Lancement public

---

## Notes importantes

- **Prioriser impitoyablement** — corriger les bloquants et plantages, reporter le reste
- **Relancer les testeurs silencieux** — leur silence est une donnée (confusion, désintérêt ou échec d'installation)
- **Tester le flux de mise à jour** — pousser une mise à jour EAS Update pendant la bêta pour vérifier que les mises à jour arrivent correctement
- **Ne pas tout corriger** — se concentrer sur ce qui bloque le lancement public
