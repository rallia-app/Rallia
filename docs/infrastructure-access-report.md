# Rallia — Inventaire des accès à l'infrastructure et guide de révocation

**Dernière mise à jour :** 2026-03-10
**Objectif :** Inventaire complet de toutes les plateformes, services et points d'accès utilisés par Rallia, avec des instructions étape par étape pour révoquer l'accès d'un membre de l'équipe et sécuriser tous les comptes.

---

## Légende des priorités

| Priorité     | Signification                                                                               |
| ------------ | ------------------------------------------------------------------------------------------- |
| **CRITIQUE** | À faire immédiatement — exposition financière, accès au code source ou à la base de données |
| **ÉLEVÉE**   | À faire dans les heures suivantes — déploiement et distribution de l'application            |
| **MOYENNE**  | À faire dans les 24h — services tiers et intégrations                                       |

---

## ÉTAPE 0 — SÉCURISER LE COMPTE GOOGLE PARTAGÉ

La plupart des services sont accessibles via un accès partagé au compte Google de l'entreprise (`apprallia@gmail.com`) par authentification Google OAuth. Sécuriser ce compte est **la première chose à faire** avant de révoquer les accès sur les plateformes individuelles.

### Pourquoi changer le mot de passe seul ne suffit pas

Lorsqu'un service est accédé via « Se connecter avec Google », cela fonctionne en deux étapes :

1. Google émet un **jeton OAuth** au service tiers (Supabase, Vercel, etc.)
2. Le service crée **sa propre session** (cookie/jeton) indépendante de Google

Après un changement de mot de passe, les **sessions Google** du cofondateur sont terminées, mais **les sessions des services tiers peuvent persister** jusqu'à l'expiration de leurs propres jetons (de quelques heures à plusieurs semaines selon le service). Le cofondateur ne pourra plus se reconnecter, mais il peut encore avoir des sessions actives.

### Procédure

1. **Changer le mot de passe du compte Google**
   - Aller à [Compte Google > Sécurité > Mot de passe](https://myaccount.google.com/signinoptions/password)
   - Changer le mot de passe
   - **Cocher l'option « Déconnecter toutes les autres sessions »** — c'est essentiel

2. **Activer la double authentification (2FA) immédiatement**
   - Aller à [Compte Google > Sécurité > Validation en deux étapes](https://myaccount.google.com/signinoptions/two-step-verification)
   - Configurer la 2FA avec votre numéro de téléphone personnel ou une application d'authentification

3. **Révoquer l'accès de toutes les applications tierces**
   - Aller à [Compte Google > Sécurité > Applications tierces ayant accès au compte](https://myaccount.google.com/permissions)
   - Supprimer l'accès pour **chaque** application listée (Supabase, Vercel, Stripe, Expo, GitHub, etc.)
   - Cela invalide les jetons OAuth que ces services détiennent, forçant une ré-authentification

4. **Vérifier les options de récupération**
   - Aller à [Compte Google > Sécurité > Récupération](https://myaccount.google.com/recovery)
   - Supprimer tout courriel ou numéro de téléphone de récupération appartenant au cofondateur
   - Définir votre propre courriel/téléphone personnel comme options de récupération

5. **Vérifier les accès délégués**
   - Dans Gmail : aller à **Paramètres > Comptes > Accorder l'accès à votre compte** — supprimer tout délégué
   - Vérifier **Google Workspace / Admin** (si applicable) pour les utilisateurs additionnels

6. **Vérifier les appareils connectés**
   - Aller à [Compte Google > Sécurité > Vos appareils](https://myaccount.google.com/device-activity)
   - Déconnecter tout appareil que vous ne reconnaissez pas

Après avoir complété ces étapes, procéder à la révocation par service ci-dessous. Même si le cofondateur ne peut plus s'authentifier via Google, **vous devez quand même le retirer de chaque service individuellement** pour garantir la terminaison immédiate des sessions et empêcher l'accès via des identifiants non-Google qu'il aurait pu configurer.

---

## PRIORITÉ CRITIQUE

### 1. GitHub

**Ce qu'il contrôle :** Code source, pipelines CI/CD (GitHub Actions), secrets du dépôt, clés de déploiement.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion, mais une session active peut persister.

**Identifiants :**

- Dépôt : `LordKenshiro/Rallia`
- Secrets CI/CD stockés dans : Settings > Secrets and variables > Actions

**Étapes de révocation :**

1. Aller dans les **Settings > Collaborators** du dépôt (ou Organization > People si vous utilisez une org GitHub)
2. Retirer la personne du dépôt / de l'organisation
3. Aller dans **Settings > Secrets and variables > Actions** et effectuer la rotation de chaque secret :
   - `EXPO_TOKEN`
   - `SUPABASE_PRODUCTION_ACCESS_TOKEN`
   - `SUPABASE_STAGING_ACCESS_TOKEN`
   - `DISCORD_WEBHOOK_URL`
   - `TURBO_TOKEN`
4. Aller dans **Settings > Deploy keys** — supprimer toute clé non reconnue
5. Vérifier **Settings > Webhooks** pour tout endpoint inattendu
6. Vérifier **Settings > Actions > General** — s'assurer qu'il n'y a pas de permissions de workflow non autorisées
7. Si vous utilisez une org GitHub : vérifier tous les jetons d'accès personnels dans les paramètres de l'org

**Clés à renouveler :** Tous les secrets GitHub Actions listés ci-dessus.

**Après rotation :** Les workflows GitHub Actions utiliseront les nouveaux secrets automatiquement au prochain lancement.

---

### 2. Stripe

**Ce qu'il contrôle :** Traitement des paiements, données financières des clients, comptes Stripe Connect des organisations, versements.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Identifiants :**

- Le compte utilise Stripe Connect (comptes Express pour les organisations)
- Version API : `2026-02-25.clover`
- Merchant ID (Apple Pay) : `merchant.com.mathisl971.rallia-app`

**Étapes de révocation :**

1. Se connecter au [Tableau de bord Stripe](https://dashboard.stripe.com)
2. Aller dans **Settings > Team** — retirer l'accès de la personne
3. Aller dans **Developers > API Keys** :
   - Renouveler la **clé secrète** (en générer une nouvelle, l'ancienne est invalidée)
   - Renouveler la **clé publiable**
4. Aller dans **Developers > Webhooks** — vérifier que les URLs des endpoints sont légitimes, renouveler le secret de signature du webhook
5. Vérifier **Connect > Accounts** pour tout compte connecté non autorisé
6. Vérifier les **Payments** et **Payouts** récents pour détecter des anomalies

**Clés à renouveler :**

- `STRIPE_SECRET_KEY` (env Vercel + Edge Functions)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (env Vercel)
- `STRIPE_WEBHOOK_SECRET` (env Vercel)

**Après rotation :** Redéployer l'application web sur Vercel. Mettre à jour les secrets des Edge Functions dans Supabase si Stripe y est utilisé.

---

### 3. Supabase

**Ce qu'il contrôle :** Base de données PostgreSQL, authentification des utilisateurs, politiques de Row-Level Security (RLS), Edge Functions, stockage de fichiers, abonnements Realtime.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Identifiants :**

- Projet production : `ncewkeoohdkpbcovbppd` (région : `ca-central-1`)
- Projet staging : `ahbaeewecdeguxtxtvhr`
- Buckets de stockage : `profile-pictures` (public), `facility-images` (privé)

**Étapes de révocation :**

1. Se connecter au [Tableau de bord Supabase](https://supabase.com/dashboard)
2. Aller dans **Organization Settings > Members** — retirer la personne
3. Pour chaque projet (production + staging) :
   - Aller dans **Settings > API** — régénérer la clé `anon` et la clé `service_role`
   - Aller dans **Settings > Auth** — vérifier les configurations des fournisseurs OAuth (s'assurer que les URIs de redirection sont correctes)
4. Vérifier les **Edge Functions** — s'assurer qu'aucune fonction non autorisée n'a été déployée
5. Vérifier **Database > Roles** — s'assurer qu'aucun utilisateur de base de données direct n'a été créé
6. Vérifier **Storage > Policies** — s'assurer que les politiques des buckets n'ont pas été modifiées
7. Vérifier **Auth > Users** — rechercher tout compte admin/test qui devrait être supprimé

**Clés à renouveler :**

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PRODUCTION_ACCESS_TOKEN` (GitHub Actions)
- `SUPABASE_STAGING_ACCESS_TOKEN` (GitHub Actions)

**Après rotation :** Mettre à jour les variables d'environnement dans Vercel, EAS/Expo et les secrets GitHub Actions. Tout redéployer.

---

### 4. Apple Developer et App Store Connect

**Ce qu'il contrôle :** Signature de l'app iOS, distribution TestFlight, fiche App Store, certificats de notifications push.

**Méthode d'accès :** Apple ID partagé `apprallia@gmail.com`. Cet Apple ID a ses propres identifiants (mot de passe Apple distinct). Le changement de mot de passe Google (étape 0) **ne suffit pas** — il faut aussi changer le mot de passe de l'Apple ID.

**Identifiants :**

- Team ID : `587DRRMTV8`
- Bundle ID : `com.mathisl971.rallia-app`

**Étapes de révocation :**

1. **Changer le mot de passe de l'Apple ID** `apprallia@gmail.com` sur [appleid.apple.com](https://appleid.apple.com)
2. Activer la **2FA** sur l'Apple ID si ce n'est pas déjà fait
3. Se connecter à [App Store Connect](https://appstoreconnect.apple.com) > **Utilisateurs et accès**
4. Retirer la personne de l'équipe
5. Se connecter à [Apple Developer](https://developer.apple.com) > **Account > People**
6. Retirer son adhésion
7. Aller dans **Certificates, Identifiers & Profiles** :
   - Révoquer tout certificat qu'il a créé
   - Vérifier les profils de provisionnement — régénérer si nécessaire
8. Renouveler la **clé API App Store Connect** utilisée pour les soumissions automatisées (config EAS)
9. Vérifier **TestFlight > Testeurs** — retirer si applicable
10. Vérifier les **appareils de confiance** liés à l'Apple ID — supprimer ceux du cofondateur

**Clés à renouveler :** Mot de passe Apple ID + clé API ASC (utilisée dans la config de build EAS pour la soumission automatisée).

**Après rotation :** Mettre à jour la clé API ASC dans les secrets EAS. Le prochain build EAS de production utilisera la nouvelle clé.

---

### 5. Google Play Console

**Ce qu'il contrôle :** Fiche de l'application Android, distribution sur le Play Store, clés de signature.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Étapes de révocation :**

1. Se connecter à la [Google Play Console](https://play.google.com/console)
2. Aller dans **Utilisateurs et autorisations** — retirer la personne
3. Renouveler la **clé JSON du compte de service** utilisée pour les soumissions automatisées sur le Play Store
4. Vérifier **App signing** — noter que les clés Play App Signing sont gérées par Google et ne peuvent pas être compromises via l'accès à la console
5. Vérifier les **releases** récentes pour détecter des publications non autorisées

**Clés à renouveler :** Clé JSON du compte de service Play Store (utilisée dans la config EAS).

**Après rotation :** Mettre à jour la clé du compte de service dans les secrets EAS.

---

### 6. Registraire de domaines (Spaceship)

**Ce qu'il contrôle :** Enregistrements DNS pour `rallia.ca` et `rallia.app` — perdre le contrôle signifie que l'application, le site web et le routage des courriels peuvent tous être détournés.

Les domaines sont enregistrés sur [Spaceship](https://www.spaceship.com) sous le compte personnel du troisième cofondateur (celui qui reste). **Aucune action de révocation nécessaire pour ce service.**

**Identifiants :**

- `rallia.ca` — site web principal (Vercel) + routage email (Neo)
- `rallia.app` — liens profonds mobile (iOS Universal Links, Android App Links)
- Registraire : Spaceship
- Propriétaire du compte : troisième cofondateur (de confiance)

**Vérifications recommandées :**

1. S'assurer que le cofondateur sortant n'a pas d'accès au compte Spaceship
2. Vérifier que les enregistrements DNS sont intacts :
   - `rallia.ca` doit pointer vers Vercel (enregistrements A/CNAME)
   - `rallia.ca` doit avoir les enregistrements MX corrects pour Neo Email
   - `rallia.app` doit avoir les bons enregistrements de vérification Apple/Google
3. S'assurer que le **verrouillage de transfert** et la **2FA** sont activés sur le compte Spaceship

---

## PRIORITÉ ÉLEVÉE

### 7. Vercel

**Ce qu'il contrôle :** Hébergement de l'application web, déploiements, variables d'environnement, configuration du domaine.

Le compte Vercel est accessible via Google OAuth avec `apprallia@gmail.com`. Le changement de mot de passe Google (étape 0) et la révocation des applications tierces empêcheront le cofondateur de se reconnecter, mais une session active peut persister.

**Identifiants :**

- Équipe : `team_Oj7ChOFF6jOPm09t1R3xcdAf`
- Projet : `prj_u1p6Rr3yrxPrfFfKyZnOOgpIuerj`
- Domaine : `www.rallia.ca`

**Étapes de révocation :**

1. Compléter l'**étape 0** (sécuriser le compte Google) en premier — cela empêchera toute reconnexion via Google
2. Se connecter au [Tableau de bord Vercel](https://vercel.com/dashboard)
3. Aller dans **Team Settings > Members** — retirer la personne
4. Aller dans **Project Settings > Environment Variables** — tous les secrets sont déjà ici ; les mettre à jour après la rotation des clés des autres services
5. Vérifier les **Deployments** — s'assurer qu'il n'y a pas de déploiements non autorisés
6. Renouveler le `TURBO_TOKEN` s'ils avaient accès aux paramètres Vercel
7. Vérifier les **Integrations** — supprimer toute intégration non autorisée

**Clés à renouveler :** `TURBO_TOKEN` (aussi mettre à jour dans GitHub Actions).

**Après rotation :** Déclencher un nouveau déploiement après la mise à jour de toutes les variables d'environnement.

---

### 8. Expo / EAS (Expo Application Services)

**Ce qu'il contrôle :** Builds de l'application mobile, mises à jour OTA (over-the-air), livraison des notifications push.

Le compte Expo est lié à `apprallia@gmail.com` mais utilise ses propres identifiants (pas Google OAuth). Le changement de mot de passe Google (étape 0) **ne suffit pas** — il faut aussi changer le mot de passe Expo directement.

**Identifiants :**

- EAS Project ID : `1baeff78-5ea2-4fa5-ab5a-b5f1386575b3`
- Propriétaire Expo : `rallia-app`
- URL des mises à jour OTA : `https://u.expo.dev/1baeff78-5ea2-4fa5-ab5a-b5f1386575b3`

**Étapes de révocation :**

1. Se connecter au [Tableau de bord Expo](https://expo.dev) avec les identifiants `apprallia@gmail.com`
2. **Changer le mot de passe** du compte Expo (Settings > Account)
3. Aller dans **Organization settings > Members** — retirer la personne
4. Générer un nouveau **jeton d'accès Expo** (ou jeton robot)
5. Révoquer l'ancien `EXPO_TOKEN`
6. Activer la **2FA** si disponible
7. Vérifier les **Builds** — rechercher des builds non autorisés
8. Vérifier les **Updates** — rechercher des mises à jour OTA non autorisées (celles-ci contournent la révision de l'App Store)

**Clés à renouveler :** `EXPO_TOKEN` (mettre à jour dans les secrets GitHub Actions).

**Après rotation :** Le prochain build CI/CD utilisera le nouveau jeton.

**Attention :** Les mises à jour OTA sont particulièrement sensibles — une mise à jour malveillante peut être envoyée à tous les utilisateurs sans passer par la révision de l'App Store. Prioriser ceci.

---

## PRIORITÉ MOYENNE

### 9. Resend (Service de courriel)

**Ce qu'il contrôle :** Livraison de courriels transactionnels (invitations, notifications, réinitialisation de mot de passe).

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Identifiants :**

- Domaine d'envoi : `updates.rallia.ca`
- Adresse d'expédition : `no-reply@updates.rallia.ca`

**Étapes de révocation :**

1. Se connecter au [Tableau de bord Resend](https://resend.com)
2. Retirer la personne de l'équipe
3. Aller dans **API Keys** — révoquer l'ancienne clé et en générer une nouvelle

**Clés à renouveler :** `RESEND_API_KEY` (mettre à jour dans les secrets des Edge Functions Supabase et l'env Vercel).

---

### 10. Twilio (SMS)

**Ce qu'il contrôle :** Livraison de notifications par SMS.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Étapes de révocation :**

1. Se connecter à la [Console Twilio](https://console.twilio.com)
2. Aller dans **Settings > User Management** — retirer la personne
3. Renouveler le **Auth Token** (Account > API Keys & Tokens)
4. Vérifier le numéro de téléphone — s'assurer qu'il est toujours correctement assigné

**Clés à renouveler :**

- `TWILIO_AUTH_TOKEN` (mettre à jour dans les secrets des Edge Functions Supabase)
- Envisager de renouveler `TWILIO_ACCOUNT_SID` si compromis

---

### 11. Google Cloud Platform

**Ce qu'il contrôle :** API Google Maps, API Google Places, identifiants OAuth Google.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Identifiants :**

- OAuth Web Client ID : `438904367358-...`
- OAuth iOS Client ID : `438904367358-...`

**Étapes de révocation :**

1. Se connecter à la [Google Cloud Console](https://console.cloud.google.com)
2. Aller dans **IAM & Admin > IAM** — retirer la personne
3. Aller dans **APIs & Services > Credentials** :
   - Restreindre ou renouveler la clé API Maps/Places
   - Vérifier les OAuth 2.0 Client IDs — s'assurer que les URIs de redirection sont correctes
4. Vérifier la **Facturation** — s'assurer qu'il n'y a pas de frais inattendus

**Clés à renouveler :**

- `GOOGLE_PLACES_API_KEY` / `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` / `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

**Après rotation :** Mettre à jour dans l'env Vercel et l'env EAS/Expo. Redéployer.

---

### 12. Mapbox

**Ce qu'il contrôle :** Rendu des cartes dans l'application mobile.

**Méthode d'accès :** Identifiants propres (compte `rallia` sur Mapbox). Le changement de mot de passe Google (étape 0) **ne suffit pas** — il faut changer le mot de passe Mapbox directement.

**Étapes de révocation :** 0. **Changer le mot de passe** du compte Mapbox

1. Se connecter au [Tableau de bord Mapbox](https://account.mapbox.com)
2. Retirer la personne du compte
3. Aller dans **Access tokens** — supprimer l'ancien jeton et en créer un nouveau avec les scopes appropriés

**Clés à renouveler :** `EXPO_PUBLIC_MAPBOX_TOKEN` (mettre à jour dans l'env EAS/Expo).

---

### 13. Facebook Developer

**Ce qu'il contrôle :** Connexion Facebook OAuth pour l'application mobile.

**Méthode d'accès :** Sous votre compte personnel. **Le cofondateur n'a pas d'accès direct.** Aucune action de révocation nécessaire, mais vérifier par précaution.

**Identifiants :**

- App ID : `25771890302497107`

**Vérifications recommandées :**

1. Se connecter au [Portail Facebook Developer](https://developers.facebook.com)
2. Aller dans **App Settings > Roles** — s'assurer que le cofondateur n'a aucun rôle
3. Vérifier **Facebook Login > Settings** — s'assurer que les URIs de redirection sont correctes

---

### 14. PostHog (Analytique)

**Ce qu'il contrôle :** Analytique produit, suivi du comportement utilisateur, données d'événements.

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Identifiants :**

- Hôte : `us.i.posthog.com`

**Étapes de révocation :**

1. Se connecter au [Tableau de bord PostHog](https://us.posthog.com)
2. Aller dans **Organization settings > Members** — retirer la personne
3. La clé API du projet est une clé publique en écriture seule — la rotation est optionnelle mais recommandée

**Clés à renouveler (optionnel) :** `NEXT_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_KEY`.

---

### 15. Sentry (Suivi des erreurs)

**Ce qu'il contrôle :** Surveillance des erreurs (configuré mais pas encore pleinement activé).

**Méthode d'accès :** Google OAuth via `apprallia@gmail.com`. L'étape 0 empêchera la reconnexion.

**Étapes de révocation :**

1. Si une organisation Sentry existe, se connecter à [Sentry](https://sentry.io)
2. Aller dans **Settings > Members** — retirer la personne
3. Renouveler le DSN si nécessaire

**Clés à renouveler :** `SENTRY_DSN` (si activé).

---

### 16. Discord (Notifications de build)

**Ce qu'il contrôle :** Webhook pour les notifications de build CI/CD.

**Le cofondateur est propriétaire du serveur Discord.** Il ne sera pas possible de le retirer — il faudra migrer vers un nouveau serveur.

**Étapes de migration :**

1. Créer un **nouveau serveur Discord** dont vous êtes propriétaire
2. Créer un nouveau webhook dans le nouveau serveur (**Settings > Integrations > Webhooks**)
3. Mettre à jour `DISCORD_WEBHOOK_URL` dans les secrets GitHub Actions avec la nouvelle URL
4. Migrer les canaux et membres nécessaires vers le nouveau serveur
5. Quitter l'ancien serveur une fois la migration terminée

**Clés à renouveler :** `DISCORD_WEBHOOK_URL` (secret GitHub Actions).

---

### 17. ClickUp (Gestion de projet)

**Ce qu'il contrôle :** Tâches, sprints, documentation de projet, historique de travail.

**Le cofondateur est propriétaire de l'espace ClickUp.** Il ne sera pas possible de le retirer — il faudra migrer vers un nouvel espace.

**Étapes de migration :**

1. **Exporter les données** avant toute action : aller dans les paramètres de l'espace ClickUp et exporter les tâches, listes et documents (format CSV ou JSON)
2. Créer un **nouvel espace ClickUp** (ou workspace) dont vous êtes propriétaire
3. Importer les données exportées dans le nouvel espace
4. Reconfigurer les intégrations (GitHub, Slack, etc.) si applicable
5. Inviter les membres de l'équipe nécessaires dans le nouvel espace
6. Quitter l'ancien espace une fois la migration terminée

**Note :** Contrairement aux autres services, la migration Discord et ClickUp nécessite de créer de nouveaux espaces puisque le cofondateur en est propriétaire. Planifier cette migration à l'avance si possible.

---

### 18. Google Drive (Documents partagés)

**Ce qu'il contrôle :** Documents de projet, fichiers partagés, ressources de l'entreprise.

Le Google Drive est rattaché au compte `apprallia@gmail.com`. L'accès sera sécurisé via l'étape 0 (changement de mot de passe du compte Google), mais des vérifications supplémentaires sont nécessaires.

**Étapes de révocation :**

1. Après avoir sécurisé le compte Google (étape 0), se connecter à [Google Drive](https://drive.google.com) avec `apprallia@gmail.com`
2. Aller dans **Drive > Partagé avec moi** — vérifier qu'aucun fichier critique n'est hébergé uniquement sur le Drive personnel du cofondateur
3. Vérifier les **permissions de partage** sur tous les dossiers et fichiers importants :
   - Clic droit > Partager > vérifier la liste des personnes ayant accès
   - Retirer l'adresse personnelle du cofondateur de tous les fichiers/dossiers partagés
4. Si des fichiers sont partagés via un lien « Toute personne ayant le lien » et que le cofondateur possède ces liens, changer les permissions en **Accès restreint**
5. Vérifier **Google Drive > Corbeille** — s'assurer qu'aucun fichier important n'a été supprimé
6. **Télécharger une copie de sauvegarde** de tous les fichiers importants via [Google Takeout](https://takeout.google.com) en sélectionnant uniquement Google Drive

**Note :** Puisque le Drive appartient au compte `apprallia@gmail.com`, le changement de mot de passe (étape 0) empêchera le cofondateur d'y accéder. Cependant, vérifier qu'il n'a pas copié des fichiers sur son propre Drive personnel avant la révocation.

---

### 19. Neo Email (Messagerie professionnelle)

**Ce qu'il contrôle :** Adresses email professionnelles sous le domaine `@rallia.ca` (ex : `contact@rallia.ca`). Utilisé pour les communications officielles de l'entreprise.

Le compte Neo est lié à `contact@rallia.ca`. Il n'est pas accessible via Google OAuth — il a ses propres identifiants.

**Étapes de révocation :**

1. Se connecter au [tableau de bord Neo](https://admin.neo.space) avec les identifiants administrateur
2. **Changer le mot de passe** du compte administrateur
3. Vérifier la liste des **utilisateurs/boîtes mail** — supprimer ou désactiver les boîtes mail du cofondateur
4. Vérifier les **règles de transfert** (forwarding) — s'assurer qu'aucun courriel n'est redirigé vers une adresse personnelle du cofondateur
5. Vérifier les **appareils connectés** / sessions actives — déconnecter toute session non reconnue
6. Activer la **2FA** si disponible
7. Vérifier les **alias email** — s'assurer qu'aucun alias non autorisé n'existe
8. Si le cofondateur utilisait un client mail (Outlook, Apple Mail, etc.), le changement de mot de passe invalidera sa connexion

**Note :** Le domaine `rallia.ca` doit pointer vers Neo pour le routage des emails (enregistrements MX). S'assurer que les enregistrements DNS du domaine n'ont pas été modifiés (voir section 6 — Registraire de domaines).

---

### 20. Bitwarden (Gestionnaire de mots de passe)

**Ce qu'il contrôle :** Tous les mots de passe et secrets partagés de l'entreprise. **C'est un service extrêmement sensible** — le cofondateur a potentiellement accès à tous les identifiants stockés.

Le compte Bitwarden est lié à `apprallia@gmail.com` mais utilise ses propres identifiants (pas Google OAuth). Le changement de mot de passe Google (étape 0) ne suffit pas.

**Étapes de révocation :**

1. Se connecter à [Bitwarden](https://vault.bitwarden.com) avec les identifiants du compte `apprallia@gmail.com`
2. **Changer le mot de passe maître** immédiatement
3. Aller dans **Settings > Sessions** — déconnecter toutes les sessions actives (« Deauthorize Sessions »)
4. Si Bitwarden est en organisation/équipe : aller dans **Organizations > Members** — retirer le cofondateur
5. Activer la **2FA** sur le compte Bitwarden si ce n'est pas déjà fait
6. Vérifier les **collections partagées** — retirer les accès du cofondateur

**Action critique post-révocation :**
Puisque le cofondateur a eu accès à Bitwarden, il faut considérer que **tous les mots de passe qui y étaient stockés sont potentiellement compromis**. Après la révocation :

- Changer les mots de passe de **tous** les services dont les identifiants étaient dans Bitwarden
- Cela inclut les plateformes listées dans ce document si leurs mots de passe y étaient enregistrés
- Prioriser : Stripe, Supabase, domaines, App Store Connect, Google Cloud

---

## LISTE DE VÉRIFICATION POST-RÉVOCATION

Après avoir complété toutes les étapes de révocation ci-dessus, suivre cette liste pour rétablir le service :

### Résumé de la rotation des clés

Passer en revue chaque service et confirmer que les nouvelles clés sont en place :

- [ ] **Secrets GitHub Actions** — les 5 secrets renouvelés
- [ ] **Variables d'environnement Vercel** — toutes les clés mises à jour (Supabase, Stripe, Resend, PostHog, Google)
- [ ] **Secrets des Edge Functions Supabase** — toutes les clés mises à jour (Resend, Twilio, Supabase service role)
- [ ] **Secrets EAS/Expo** — toutes les variables d'env mobile mises à jour (Supabase, Google, Mapbox, Facebook, PostHog)

### Redéploiement

- [ ] **Application web** — déclencher un nouveau déploiement Vercel (ou pousser sur `main`)
- [ ] **Edge Functions** — redéployer toutes les Edge Functions Supabase avec les nouveaux secrets
- [ ] **Application mobile** — pousser une mise à jour OTA (ou soumettre un nouveau build si la config native a changé)

### Vérification

- [ ] Le site web se charge à `https://www.rallia.ca`
- [ ] La connexion utilisateur fonctionne (courriel, Google, Apple, Facebook)
- [ ] Les paiements sont traités correctement (tester une transaction Stripe)
- [ ] Les courriels sont livrés (déclencher une notification test)
- [ ] L'application mobile fonctionne normalement (cartes, chat, notifications)
- [ ] Le pipeline CI/CD s'exécute correctement (pousser un commit test)
- [ ] Les enregistrements DNS sont corrects pour les deux domaines

### Renforcement de la sécurité (recommandé)

- [ ] Activer la 2FA sur tous les comptes de plateformes listés ci-dessus
- [ ] Vérifier et restreindre les permissions des clés API (listes blanches d'IP, restrictions de domaine)
- [ ] Auditer les politiques RLS de Supabase pour détecter des portes dérobées
- [ ] Vérifier les utilisateurs Supabase Auth pour détecter des comptes suspects
- [ ] Changer les mots de passe sur tous les comptes qui étaient partagés

---

## RÉFÉRENCE DES VARIABLES D'ENVIRONNEMENT

Toutes les variables d'environnement à mettre à jour après la rotation des clés :

### Vercel (Application web)

| Variable                             | Source       |
| ------------------------------------ | ------------ |
| `NEXT_PUBLIC_SUPABASE_URL`           | Supabase     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | Supabase     |
| `SUPABASE_SERVICE_ROLE_KEY`          | Supabase     |
| `STRIPE_SECRET_KEY`                  | Stripe       |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe       |
| `STRIPE_WEBHOOK_SECRET`              | Stripe       |
| `RESEND_API_KEY`                     | Resend       |
| `GOOGLE_PLACES_API_KEY`              | Google Cloud |
| `NEXT_PUBLIC_POSTHOG_KEY`            | PostHog      |

### EAS / Expo (Application mobile)

| Variable                            | Source       |
| ----------------------------------- | ------------ |
| `EXPO_PUBLIC_SUPABASE_URL`          | Supabase     |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`     | Supabase     |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Google Cloud |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`   | Google Cloud |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`  | Google Cloud |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`  | Google Cloud |
| `EXPO_PUBLIC_FACEBOOK_APP_ID`       | Facebook     |
| `EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN` | Facebook     |
| `EXPO_PUBLIC_MAPBOX_TOKEN`          | Mapbox       |
| `EXPO_PUBLIC_POSTHOG_KEY`           | PostHog      |
| `SENTRY_DSN`                        | Sentry       |

### Edge Functions Supabase

| Variable                    | Source   |
| --------------------------- | -------- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `RESEND_API_KEY`            | Resend   |
| `TWILIO_AUTH_TOKEN`         | Twilio   |
| `TWILIO_ACCOUNT_SID`        | Twilio   |

### GitHub Actions

| Secret                             | Source   |
| ---------------------------------- | -------- |
| `EXPO_TOKEN`                       | Expo     |
| `SUPABASE_PRODUCTION_ACCESS_TOKEN` | Supabase |
| `SUPABASE_STAGING_ACCESS_TOKEN`    | Supabase |
| `TURBO_TOKEN`                      | Vercel   |
| `DISCORD_WEBHOOK_URL`              | Discord  |
