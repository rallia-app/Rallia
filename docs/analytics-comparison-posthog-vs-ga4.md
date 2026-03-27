# Analytique : PostHog vs Google Analytics 4

**Contexte :** Monorepo Expo/React Native + Next.js + Supabase

---

## Comparaison

|                               | PostHog                                          | GA4                                                |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| **SDK RN/Expo**               | Officiel (`posthog-react-native`)                | Communautaire (`@react-native-firebase/analytics`) |
| **Next.js App Router**        | Officiel (`posthog-js` + `posthog-node`)         | Officiel (`@next/third-parties/google`)            |
| **Disponibilité des données** | Temps réel                                       | Délai de 24–72h                                    |
| **Session replay**            | 5K web + 2.5K mobile/mois gratuit                | Non                                                |
| **Feature flags**             | 1M req/mois gratuit                              | Non (nécessite Firebase Remote Config)             |
| **A/B testing**               | Intégré                                          | Non (nécessite Firebase A/B)                       |
| **Heatmaps**                  | Gratuit                                          | Non                                                |
| **Suivi d'erreurs**           | 100K erreurs/mois gratuit                        | Non (nécessite Firebase Crashlytics)               |
| **Intégration Supabase**      | Connecteur Data Warehouse direct                 | Aucune                                             |
| **Hébergement EU**            | Oui (Francfort)                                  | Non (traitement aux États-Unis)                    |
| **Tracking sans cookies**     | Intégré, aucune bannière de consentement requise | Non (nécessite cookies + CMP)                      |
| **Tier gratuit**              | 1M événements/mois (limite stricte)              | Illimité (échantillonné à 10M)                     |
| **Auto-hébergement**          | Oui (MIT)                                        | Non                                                |

---

## Pourquoi PostHog est le meilleur choix pour nous

- **Un seul outil au lieu de quatre** — GA4 ne couvre que l'analytique événementielle. Pour égaler PostHog, il faudrait ajouter Hotjar (replay), LaunchDarkly (flags), Sentry (erreurs) et Optimizely (A/B). Plus de SDKs, plus de poids dans le bundle, plus de comptes fournisseurs.
- **Données en temps réel** — PostHog est instantané. GA4 a un délai de 24–72h, ce qui bloque l'itération et le débogage.
- **Connecteur Supabase** — On peut joindre nos tables DB directement avec les données analytiques. GA4 nécessiterait un export BigQuery + un pipeline custom.
- **Vie privée simplifiée** — Hébergement EU + mode sans cookies prêt à l'emploi. GA4 exige des cookies first-party, un CMP, Consent Mode v2, et achemine quand même les données via l'infrastructure américaine. Plusieurs autorités de protection des données européennes (Autriche, France, Italie, Danemark) ont jugé GA non conforme en 2022 ; le EU-US DPF (2023) améliore la situation mais n'est pas pleinement garanti.
- **Setup monorepo plus simple** — Une seule clé API pour `apps/web` et `apps/mobile`. GA4 utilise des SDKs différents (gtag vs Firebase), des outils de débogage différents (DevTools vs DebugView), des flux de validation d'événements différents.

## Là où GA4 gagne

- **Attribution marketing** — Référence pour Google Ads, UTMs et audiences de retargeting. Le support UTM de PostHog est basique.
- **Tier gratuit illimité** — Pas de limite stricte d'événements. PostHog arrête l'ingestion à 1M/mois.
- **Familiarité** — Les parties prenantes non techniques connaissent GA4. PostHog est orienté développeurs.

---

## Recommandation

**PostHog maintenant** comme plateforme principale — couvre l'analytique, le replay, les flags et le suivi d'erreurs dans un seul outil avec support natif Expo + Next.js + Supabase.

**GA4 plus tard (web seulement)** si/quand on lance des campagnes publicitaires — un `gtag` sur Next.js prend 5 minutes, sans Firebase côté mobile.
