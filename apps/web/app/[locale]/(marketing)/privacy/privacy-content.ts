/* eslint-disable no-irregular-whitespace --
 * The French text uses non-breaking spaces (U+00A0) as required by French
 * typography (before « : ; ? » and inside guillemets). These are intentional
 * legal-content characters carried over from counsel's source document. */
import type { Locale } from '@rallia/shared-translations';

/**
 * Rallia's Privacy Policy, authored by legal counsel and converted from the
 * source Word documents (dated 2026-05-14) to Markdown. Rendered inline on
 * /[locale]/privacy via react-markdown — replaces the former Enzuzo embed.
 *
 * To update: re-export the .docx from counsel, run it through pandoc
 * (gfm, --wrap=none) and the heading-promotion transform, then regenerate
 * this file. Do not hand-edit the legal wording.
 */
export const privacyPolicy: Record<Locale, string> = {
  'en-US': `
# Privacy Policy

**Rallia inc.**

Last updated: May 14, 2026

Rallia inc. (hereinafter "**Rallia**") operates a digital platform that connects tennis and pickleball enthusiasts, helping them find players at their level and organize matches. Rallia is committed to protecting your personal information. This policy clearly and accessibly describes how we collect, use, disclose, retain, and destroy personal information about you, in compliance with the Act.

## DEFINITIONS

**"Personal information":** any information that relates to a natural person and allows, directly or indirectly, that person to be identified, regardless of the medium on which it is recorded.

**"Sensitive information":** any personal information that, by its nature or the context of its collection, gives rise to a high degree of reasonable expectation of privacy. Precise geolocation data and financial information are considered sensitive information.

**"Privacy incident":** the unauthorized access, use, or disclosure of personal information, the loss of such information, or any other breach of its protection.

**"Service provider":** any third-party service provider to whom Rallia communicates personal information in the context of a mandate or service agreement.

**"Privacy Impact Assessment (PIA)":** a process for identifying and assessing privacy risks related to the transfer of information outside Quebec, allowing appropriate measures to be put in place to mitigate them.

**"Data subject":** any natural person whose personal information is processed by Rallia.

## SCOPE

### 1. Who is responsible for the protection of your personal information?

Jean de Laure Sonkin Tenessong, President of Rallia inc., is the designated person responsible for the protection of personal information (Privacy Officer). He is accountable for Rallia's compliance with the Act, oversees adherence to this policy and applicable laws, handles access and rectification requests, and manages privacy incidents. He may delegate all or part of these functions in writing to a person capable of effectively assuming this role. In the event of such delegation, Mr. Sonkin Tenessong remains accountable for compliance with the law within Rallia inc..

You may contact the Privacy Officer by email at [contact@rallia.ca](mailto:contact@rallia.ca) or by phone at 514.601.4198.

### 2. To whom does this policy apply?

This policy applies to any person who uses the Rallia mobile application, visits the website rallia.ca, or communicates with us by any other means, whether a registered user or not.

It does not apply to third-party websites, applications, or services accessible through links in our application or on our website. These third parties have their own privacy practices over which we have no control.

## COLLECTION AND USE

### 3. What personal information do we collect?

We only collect information that is necessary for the purposes described in this policy. The necessity criterion guides each of our collection decisions: information is only collected if the objective pursued is legitimate, important, and real, and if the resulting privacy impact is proportionate to that objective. Depending on the moment and context of your interaction with the platform, this information may include the following.

**After downloading the application:** sports played (tennis and/or pickleball) and postal code.

**When creating your account:** first name, last name, and email address.

**When creating your user profile (Onboarding):** first and last name, date of birth, gender, profile photo, playing level (tennis and/or pickleball), preferred hand, maximum distance (the player is willing to travel), preferred game duration, preferred game type (recreational or competitive), favourite playing venues, and weekly availability.

**When using the application:** full address, phone number, proof of playing level, short biography, playing preferences, playing style, match history, ratings received, reliability score, user-generated content (messages, comments), device-specific identifiers (brand, model, IMEI, phone number), login and authentication data, IP address, timestamps, and time zone.

**When enabling geolocation:** precise location data, collected only with your prior explicit consent. This constitutes sensitive information.

**When using payment features:** billing information, phone number, and payment method (credit card, debit, or other).

**Via social networks:** if you choose to sign in to Rallia through a social network (Google, Apple, or other), we receive account information shared by that platform in accordance with its own privacy settings.

**Via our automated technologies:** browsing data, IP address, login information, and authentication logs automatically generated during your interactions with the platform.

### 4. Do you collect information from third parties?

In most cases, we collect your information directly from you. However, we may occasionally receive information about you from third parties, including analytics service providers, or social media platforms when you choose to connect through them.

### 5. Do you collect information about minors?

We do not knowingly collect personal information from persons under the age of 18 without the express consent of a parent or guardian. If you are the parent or guardian of a minor and believe that they have provided us with information without your consent, please contact us so that we may address the situation.

### 6. Why do we use your personal information?

We use your personal information to create and manage your user account; to connect you with players at your level in your geographic area; to verify and certify your playing level by video or player references; to allow you to create, find, and manage matches; to calculate and display your reliability score based on your punctuality, cancellations, and ratings received; to process payments and fee-sharing between players; to send you communications regarding your account and our services; to improve our platform and develop new features; to ensure the security of the platform and prevent abuse; and to fulfil our legal obligations.

We only use your information for the purposes for which it was collected, unless you consent to a different use or the law expressly authorizes it.

### 7. How do we obtain your consent?

Your consent is obtained before or at the time of collection of your information. To be valid, it must be manifest (expressed clearly and unambiguously), free (given without coercion), informed (you have all the information needed to understand its scope), specific (tied to a defined purpose), time-limited (valid for the duration necessary to achieve the purpose for which it was requested), and granular (you may consent to some purposes without consenting to others).

Consent may be explicit, for example when creating your account or enabling geolocation, or implicit when you voluntarily provide us with information in a context where its use is reasonably foreseeable. Consent related to sensitive information, such as precise geolocation data, must always be expressed explicitly.

You may withdraw your consent at any time by modifying your device or account settings, or by contacting us directly. Such withdrawal may limit your access to certain features of the application, including the ability to search for players and courts nearby.

Consent to informational or promotional communications is collected separately from acceptance of the general terms and conditions, by means of an unchecked checkbox at the time of purchase or registration. Each promotional communication sent by Rallia clearly identifies Rallia as the sender and includes a functional unsubscribe mechanism.

## DISCLOSURE

### 8. Do we share your information with third parties?

We do not sell, rent, or exchange your personal information to third parties for commercial purposes.

We disclose it to other users of the platform to the extent necessary to facilitate connections (profile, certified playing level, reliability score, approximate location); to our service providers in the context of delivering our services; to competent authorities when required by law or in response to a court order; and, in the context of a reorganization or asset sale, to the successor entity, subject to appropriate confidentiality undertakings and prior notice from us.

Access to personal information within Rallia inc. is strictly limited to persons for whom such information is necessary in the performance of their duties.

A list of our main service providers, including their role and location, is available upon request at [contact@rallia.ca](mailto:contact@rallia.ca).

### 9. Do your service providers have access to your information?

Yes. Some of our service providers process personal information on our behalf. Any contract entered into with a service provider includes provisions requiring that provider to take measures to ensure the protection and confidentiality of the information entrusted to it, a commitment that such information will only be used within the scope of its mandate, an obligation not to retain it after the end of the mandate, an obligation to immediately notify Rallia of any breach or attempted breach of its confidentiality obligations, and authorization for Rallia to carry out any verification related to such confidentiality.

Our main service providers are currently Supabase (storage and database), Sentry (technical error monitoring), and Vercel (web application hosting).

### 10. Is your information disclosed outside of Quebec?

Some of our digital tools may store or process personal information outside of Quebec, including in the United States. Before any disclosure outside Quebec, we conduct a Privacy Impact Assessment (PIA) to ensure that your information will receive adequate protection.

## PROFILING

### 11. Do we use cookies or similar technologies?

Yes. We use tracking technologies to ensure the proper functioning of our platform and to analyze its use.

We also use PostHog to track user behaviour within the application (time spent on each screen, actions performed, and usage rates of the application's various features).

We also use Sentry to monitor technical errors in the application. This tool may collect data about your device and your interactions with the application to help us identify and correct issues.

### 12. Do we build profiles about you?

Yes, partially. The Rallia application builds a profile for each user, including your certified playing level, your reliability score (calculated based on your attendance, cancellations, and ratings received from other players), and your playing preferences. This profile is used to connect you with the most compatible players.

In accordance with the Act, you are informed of this practice through this policy. You may object to it by contacting us directly at the coordinates indicated in the last section, it being understood that such an objection would make use of the platform impossible, as profiling is inherent to its operation.

### 13. Do we make automated decisions about you?

Partially. Certain features of Rallia, such as your reliability score and player suggestions, are based on automated processing. You may request a review of any automated decision concerning you by contacting our Privacy Officer at the coordinates indicated in the last section.

## RETENTION

### 14. How long do we retain your information?

We only retain your personal information for as long as necessary to fulfil the purposes for which it was collected, and to the extent required by applicable law.

**Account and profile data:** for the entire duration of your use of Rallia, then for 3 years following the closure of your account.

**Browsing and geolocation data:** maximum 24 months.

**Financial data:** 7 years in accordance with applicable tax and accounting obligations.

Upon expiry of these periods, your information is securely destroyed or irreversibly anonymized.

### 15. How do we ensure the security of your information?

We have implemented appropriate organizational safeguards and security measures to protect your information against accidental loss, unauthorized access or use, modification, or disclosure.

These measures include encryption of communications between your device and our servers, use of certified service providers for data storage and processing (Supabase, Vercel), continuous monitoring of technical errors and anomalies (Sentry), and internal policies governing access to personal information.

In the event of a personal data breach, we will promptly assess the risk of serious harm. If such risk is confirmed, we will notify you and the Commission d'accès à l'information du Québec in accordance with our legal obligations.

## YOUR RIGHTS

### 16. What rights do you have over your personal information?

In accordance with the Act, you have the following rights with respect to the personal information we hold about you.

**Right of access:** you may request to consult the personal information we hold about you. We will respond within 30 days, extendable by an additional 30 days if the complexity of the request justifies it, with prior notice.

**Right of rectification:** you may request the correction of any inaccurate, incomplete, or ambiguous information we hold about you.

**Right to erasure:** you may request the deletion of your personal information when its retention is no longer necessary for the purposes for which it was collected, subject to our legal retention obligations.

**Right to portability:** you may request that your information be transmitted to you in a structured, commonly used technological format that allows commonly used software applications to read and extract the information.

**Right to de-indexation:** if personal information about you is published online and such publication causes or is likely to cause you serious harm, you may request that the dissemination cease and that any hyperlinks providing access to that information be de-indexed.

**Right to object:** you may object to the use of your information for commercial prospecting purposes or to the building of a profile for such activities.

**Right regarding automated decisions:** you have the right to be informed when a decision based exclusively on automated processing concerns you, and to request that it be reviewed by a natural person.

**Right to withdraw consent:** you may withdraw your consent at any time, subject to legal or contractual restrictions and reasonable notice, which may limit your access to certain features of the platform.

### 17. How do you exercise your rights?

To exercise any of these rights, contact our Privacy Officer at the coordinates indicated in the last section. We may ask you to confirm your identity before processing your request, in order to protect the confidentiality of your information.

If you are not satisfied with our response, you have the right to file a complaint with the Commission d'accès à l'information du Québec at [www.cai.gouv.qc.ca](https://www.cai.gouv.qc.ca).

## GENERAL PROVISIONS

### 18. What happens in the event of a privacy incident?

Any incident that may have compromised the confidentiality of your personal information is immediately assessed by our Privacy Officer. We promptly take the necessary measures to limit the consequences and prevent a similar incident from occurring again. If the incident presents a risk of serious harm, we will notify you without delay and inform the Commission d'accès à l'information. All incidents are recorded in our internal privacy incident register.

### 19. Can this policy be amended?

We may amend this policy at any time to keep it current. In the event of a significant change, we will notify you via an in-app notice or by email before the changes take effect. The date of the last update appears at the top of this policy.

### 20. How to contact us?

For any questions regarding this policy, to exercise your rights, or to file a complaint, please contact our person responsible for the protection of personal information (Privacy Officer).

**Rallia inc.**

Attn: Jean de Laure Sonkin Tenessong

Person Responsible for the Protection of Personal Information (Privacy Officer)

203-5740 boul. Cavendish, Côte-Saint-Luc (Québec) H4W 2T8

[contact@rallia.ca](mailto:contact@rallia.ca)

514.601.4198
`,
  'fr-CA': `
# POLITIQUE DE CONFIDENTIALITE

**Rallia inc.**

Dernière mise à jour : 14 mai 2026

Rallia inc. (ci-après « **Rallia** ») exploite une plateforme numérique permettant aux amateurs de tennis et de pickleball de se connecter, de trouver des joueurs de leur niveau et d'organiser des parties. Rallia accorde une grande importance à la protection de vos renseignements personnels. La présente politique décrit de façon claire et accessible la manière dont nous recueillons, utilisons, communiquons, conservons et détruisons les renseignements personnels vous concernant, en conformité avec la Loi.

## DÉFINITIONS

**« Renseignement personnel » :** tout renseignement qui concerne une personne physique et permet, directement ou indirectement, de l'identifier, quelle que soit la nature de son support.

**« Renseignement sensible » :** tout renseignement personnel qui, en raison de sa nature ou du contexte de sa collecte, suscite un degré élevé d'attente raisonnable en matière de vie privée. Constituent notamment des renseignements sensibles les données de géolocalisation précises et les informations financières.

**« Incident de confidentialité » :** l'accès, l'utilisation ou la communication non autorisés d'un renseignement personnel, ou la perte d'un tel renseignement, ou toute autre atteinte à sa protection.

**« Sous-traitant » :** tout fournisseur de services auquel Rallia confie des renseignements personnels dans le cadre de l'exécution d'un mandat ou d'un contrat de services.

**« Évaluation des facteurs relatifs à la vie privée (EFVP) » :** démarche d'identification et d'évaluation des risques d'atteinte à la vie privée liés à un transfert de renseignements hors Québec, permettant de mettre en place les mesures appropriées pour les atténuer.

**« Personne concernée » :** toute personne physique dont les renseignements personnels sont traités par Rallia.

## PORTÉE

### 1. Qui est responsable de la protection de vos renseignements personnels?

Jean de Laure Sonkin Tenessong, Président de Rallia inc., est la personne désignée responsable de la protection des renseignements personnels. Il est imputable de la conformité de Rallia avec la Loi, veille au respect de la présente politique et des lois applicables, traite les demandes d'accès et de rectification, et assure la gestion des incidents de confidentialité. Il peut déléguer tout ou partie de ces fonctions par écrit à une personne en mesure d'assumer efficacement ce rôle. En cas de délégation, M. Sonkin Tenessong demeure imputable du respect de la loi au sein de Rallia inc..

Vous pouvez communiquer avec le responsable par courriel à [contact@rallia.ca](mailto:contact@rallia.ca) ou par téléphone au 514.601.4198.

### 2. À qui cette politique s'applique-t-elle?

Cette politique s'applique à toute personne qui utilise l'application mobile Rallia, visite le site Web rallia.ca, ou communique avec nous par tout autre moyen, qu'elle soit un utilisateur inscrit ou non.

Elle ne s'applique pas aux sites Web, applications ou services de tiers accessibles via des liens présents dans notre application ou sur notre site. Ces tiers disposent de leurs propres pratiques en matière de confidentialité, sur lesquelles nous n'avons aucun contrôle.

## COLLECTE ET UTILISATION

### 3. Quels renseignements personnels collectons-nous?

Nous ne recueillons que les renseignements nécessaires aux fins décrites dans cette politique. Le critère de nécessité guide chacune de nos décisions de collecte, en effet, un renseignement n'est recueilli que si l'objectif poursuivi est légitime, important et réel, et si l'atteinte à la vie privée qui en découle est proportionnelle à cet objectif. Selon le moment et le contexte de votre interaction avec la plateforme, ces renseignements peuvent comprendre les éléments suivants.

**Après le téléchargement de l’application** : sports pratiqués (tennis et/ou pickleball) et code postal.

**À la création de votre compte :** nom, prénom et adresse courriel

**À la création du profil de l’utilisateur « Onboarding »** : nom et prénom, date de naissance, le sexe, une photo de profil, le niveau de jeu (tennis et/ou pickleball), la main préférée, la distance maximale (que le joueur est prêt à parcourir), la durée préférée des parties, le type de partie préféré (récréatif ou compétitif), les lieux de jeu favoris et les disponibilités pour joueur (base hebdomadaire).

**À l'utilisation de l'application :** adresse complète, numéro de téléphone, preuves du niveau de jeu, courte biographie, préférences de jeu, style de jeu, historique de parties, évaluations reçues, score de fiabilité, contenu généré (messages, commentaires), identifiants spécifiques à votre appareil mobile (marque, modèle, IMEI, numéro de téléphone), données de connexion et d'authentification, adresse IP, horodatages et fuseau horaire.

**À l'activation de la géolocalisation :** données de localisation précises, recueillies uniquement avec votre consentement explicite préalable. Il s'agit d'un renseignement sensible.

**À l'utilisation des fonctions de paiement :** informations de facturation, numéro de téléphone et moyen de paiement (carte de crédit, débit ou autre).

**Via les réseaux sociaux :** si vous choisissez de vous connecter à Rallia via un réseau social (Google, Apple ou autre), nous recevons les renseignements de compte partagés par cette plateforme selon ses propres paramètres de confidentialité.

**Via nos technologies automatisées :** données de navigation, adresse IP, informations de connexion et enregistrements d'authentification générés automatiquement lors de vos interactions avec la plateforme.

### 4. Recueillez-vous des renseignements auprès de tiers?

Dans la plupart des cas, nous recueillons vos renseignements directement auprès de vous. Il peut toutefois arriver que nous recevions des renseignements vous concernant de la part de tiers, notamment des fournisseurs de services d'analyse, ou de plateformes de réseaux sociaux lorsque vous choisissez de vous y connecter.

### 5. Recueillez-vous des renseignements concernant des mineurs?

Nous ne recueillons pas sciemment de renseignements personnels auprès de personnes âgées de moins de 18 ans sans le consentement exprès d'un parent ou d'un tuteur. Si vous êtes le parent ou le tuteur d'un mineur et que vous croyez que celui-ci nous a transmis des renseignements sans votre consentement, communiquez avec nous afin que nous puissions y remédier.

### 6. Pourquoi utilisons-nous vos renseignements personnels?

Nous utilisons vos renseignements personnels pour créer et gérer votre compte utilisateur ; pour vous mettre en relation avec des joueurs de votre niveau dans votre zone géographique ; pour vérifier et certifier votre niveau de jeu par vidéo ou références de joueurs ; pour vous permettre de créer, de trouver et de gérer des parties ; pour calculer et afficher votre score de fiabilité fondé sur votre ponctualité, vos annulations et les évaluations reçues ; pour traiter les paiements et partages de frais entre joueurs ; pour vous envoyer des communications relatives à votre compte et à nos services ; pour améliorer notre plateforme et développer de nouvelles fonctionnalités ; pour assurer la sécurité de la plateforme et prévenir les abus ; et pour satisfaire à nos obligations légales.

Nous n'utilisons vos renseignements qu'aux fins pour lesquelles ils ont été recueillis, sauf si vous consentez à une utilisation différente ou si la loi l'autorise expressément.

### 7. Comment obtenons-nous votre consentement?

Votre consentement est obtenu avant ou au moment de la collecte de vos renseignements. Pour être valide, il doit être manifeste (exprimé de façon évidente et non ambiguë), libre (donné sans contrainte), éclairé (vous disposez de toutes les informations pour en comprendre la portée), spécifique (lié à une fin précise), temporaire (valide pour la durée nécessaire à l'atteinte de la fin pour laquelle il a été demandé) et granulaire (vous pouvez consentir à certaines fins sans consentir à d'autres).

Le consentement peut être explicite, par exemple lors de la création de votre compte ou de l'activation de la géolocalisation, ou implicite lorsque vous nous transmettez volontairement des renseignements dans un contexte où leur utilisation est raisonnablement prévisible. Le consentement lié à des renseignements sensibles, comme les données de géolocalisation précises, doit toujours être exprimé de manière explicite.

Vous pouvez retirer votre consentement en tout temps en modifiant les paramètres de votre appareil ou de votre compte, ou en nous contactant directement. Ce retrait pourrait limiter votre accès à certaines fonctionnalités de l'application, notamment la recherche de joueurs et de terrains à proximité.

Le consentement aux communications à caractère informatif ou promotionnel est recueilli séparément de l'acceptation des conditions générales de vente, au moyen d'une case à cocher non pré-cochée lors de l'achat ou de l'inscription. Chaque communication promotionnelle envoyée par Rallia identifie clairement Rallia comme expéditeur et contient un mécanisme de désabonnement fonctionnel.

## COMMUNICATION

### 8. Partageons-nous vos renseignements avec des tiers?

Nous ne vendons, ne louons et n'échangeons pas vos renseignements personnels à des tiers à des fins commerciales.

Nous les communiquons aux autres utilisateurs de la plateforme dans la mesure nécessaire à la mise en relation (profil, niveau de jeu certifié, score de fiabilité, localisation approximative) ; à nos sous-traitants dans le cadre de la prestation de nos services ; aux autorités compétentes lorsque la loi l'exige ou en réponse à une ordonnance judiciaire ; et, dans le cadre d'une réorganisation ou d'une vente d'actifs, à l'entité successeure, sous réserve d'engagements de confidentialité appropriés et d'un avis préalable de notre part.

L'accès aux renseignements personnels au sein de Rallia inc. est strictement limité aux personnes pour qui ces renseignements sont nécessaires à l'exercice de leurs fonctions.

La liste de nos principaux fournisseurs de services, incluant leur rôle et leur localisation, est disponible sur demande à [contact@rallia.ca](mailto:contact@rallia.ca).

### 9. Nos sous-traitants ont-ils accès à vos renseignements ?

Oui. Certains de nos fournisseurs de services traitent des renseignements personnels pour notre compte. Tout contrat conclu avec un sous-traitant prévoit les mesures que ce dernier doit prendre pour assurer la protection et la confidentialité des renseignements qui lui sont confiés, l'engagement que ces renseignements ne seront utilisés que dans le cadre de son mandat, l'obligation de ne pas les conserver après la fin du mandat, l'obligation d'aviser immédiatement Rallia de toute violation ou tentative de violation de ses obligations de confidentialité, et l'autorisation pour Rallia d'effectuer toute vérification relative à cette confidentialité.

Nos principaux sous-traitants sont actuellement Supabase (stockage et base de données), Sentry (surveillance technique des erreurs) et Vercel (hébergement de l'application web).

### 10. Vos renseignements sont-ils communiqués à l'extérieur du Québec ?

Certains de nos outils numériques peuvent conserver ou traiter des renseignements personnels à l'extérieur du Québec, notamment aux États-Unis. Avant toute communication hors Québec, nous procédons à une évaluation des facteurs relatifs à la vie privée (EFVP) afin de nous assurer que vos renseignements bénéficieront d'une protection adéquate.

## PROFILAGE

### 11. Utilisons-nous des témoins (cookies) ou des technologies similaires ?

Oui. Nous utilisons des technologies de suivi pour assurer le bon fonctionnement de notre plateforme et en analyser l'utilisation.

Nous utilisons aussi PostHog pour le suivi du comportement des utilisateurs dans l'application (le temps passé sur chaque écran, les actions effectuées et les taux d'utilisation des différentes fonctionnalités de l’application).

Nous utilisons également Sentry pour surveiller les erreurs techniques de l'application. Cet outil peut collecter des données sur votre appareil et vos interactions avec l'application afin de nous permettre d'identifier et de corriger les défaillances.

### 12. Constituons-nous des profils à votre sujet ?

Oui, partiellement. L'application Rallia constitue un profil pour chaque utilisateur, comprenant notamment votre niveau de jeu certifié, votre score de fiabilité (calculé sur la base de vos présences, de vos annulations et des évaluations reçues d'autres joueurs) et vos préférences de jeu. Ce profil est utilisé pour vous mettre en relation avec les joueurs les plus compatibles.

Conformément à la Loi, vous êtes informé de cette pratique par la présente politique. Vous pouvez vous y opposer en nous contactant directement aux coordonnées indiquées à la dernière section, sachant que cette opposition rendrait l'utilisation de la plateforme impossible, le profilage étant inhérent à son fonctionnement.

### 13. Prenons-nous des décisions automatisées à votre sujet ?

Partiellement. Certaines fonctionnalités de Rallia, comme votre score de fiabilité et les suggestions de joueurs, reposent sur des traitements automatisés. Vous pouvez demander une révision de toute décision automatisée vous concernant en contactant notre responsable aux coordonnées indiquées à la dernière section.

## CONSERVATION

### 14. Combien de temps conservons-nous vos renseignements ?

Nous ne conservons vos renseignements personnels que le temps nécessaire à la réalisation des fins pour lesquelles ils ont été recueillis, et dans la mesure requise par la loi applicable.

**Données de compte et de profil :** pendant toute la durée de votre utilisation de Rallia, puis 3 ans après la fermeture de votre compte.

**Données de navigation et de géolocalisation :** 24 mois maximum.

**Données financières :** 7 ans conformément aux obligations fiscales et comptables applicables.

À l'expiration de ces délais, vos renseignements sont détruits de façon sécuritaire ou rendus anonymes de manière irréversible.

### 15. Comment assurons-nous la sécurité de vos renseignements ?

Nous avons mis en place des protections organisationnelles et des mesures de sécurité appropriées pour protéger vos renseignements contre la perte accidentelle, l'utilisation ou l'accès non autorisé, la modification ou la divulgation.

Ces mesures comprennent notamment le chiffrement des communications entre votre appareil et nos serveurs, l'utilisation de fournisseurs de services certifiés pour le stockage et le traitement de vos données (Supabase, Vercel), la surveillance continue des erreurs et anomalies techniques (Sentry), ainsi que des politiques internes de contrôle des accès aux renseignements personnels.

Dans le cas d'une violation de données personnelles, nous évaluerons sans délai le risque de préjudice sérieux. Si ce risque est avéré, nous vous en informerons et en aviserons la Commission d'accès à l'information du Québec conformément à nos obligations légales.

## VOS DROITS

### 16. Quels droits avez-vous sur vos renseignements personnels ?

Conformément à la Loi, vous disposez des droits suivants à l'égard des renseignements personnels que nous détenons à votre sujet.

**Droit d'accès :** vous pouvez demander à consulter les renseignements personnels que nous détenons à votre sujet. Nous y répondrons dans un délai de 30 jours, prolongeable de 30 jours additionnels si la complexité de la demande le justifie, moyennant un avis préalable.

**Droit de rectification :** vous pouvez demander la correction de tout renseignement inexact, incomplet ou équivoque vous concernant.

**Droit à l'effacement :** vous pouvez demander la suppression de vos renseignements personnels lorsque leur conservation n'est plus nécessaire aux fins pour lesquelles ils ont été recueillis, sous réserve de nos obligations légales de conservation.

**Droit à la portabilité :** vous pouvez demander que vos renseignements vous soient transmis dans un format technologique structuré et couramment utilisé, qui permette à des applications logicielles d'usage courant de reconnaître et d'extraire l'information.

**Droit à la déindexation :** si des renseignements personnels vous concernant sont diffusés en ligne et que cette diffusion vous cause ou est susceptible de vous causer un préjudice sérieux, vous pouvez demander la cessation de cette diffusion et la déindexation de tout hyperlien donnant accès à ces renseignements.

**Droit d'opposition :** vous pouvez vous opposer à l'utilisation de vos renseignements à des fins de prospection commerciale ou à la constitution d'un profil à des fins de telles activités.

**Droit concernant les décisions automatisées :** vous avez le droit d'être informé lorsqu'une décision fondée exclusivement sur un traitement automatisé vous concerne, et de demander qu'elle soit révisée par une personne physique.

**Droit au retrait du consentement :** vous pouvez retirer votre consentement en tout temps, sous réserve de restrictions légales ou contractuelles et d'un préavis raisonnable, ce qui pourrait limiter votre accès à certaines fonctionnalités de la plateforme.

### 17. Comment exercer vos droits ?

Pour exercer l'un ou l'autre de ces droits, contactez notre responsable de la protection des renseignements personnels aux coordonnées indiquées à la dernière section. Nous pourrions vous demander de confirmer votre identité avant de traiter votre demande, afin de protéger la confidentialité de vos renseignements.

Si vous n'êtes pas satisfait de notre réponse, vous avez le droit de déposer une plainte auprès de la Commission d'accès à l'information du Québec au [www.cai.gouv.qc.ca](https://www.cai.gouv.qc.ca).

## DISPOSITIONS GÉNÉRALES

### 18. Que se passe-t-il en cas d'incident de confidentialité ?

Tout incident susceptible d'avoir compromis la confidentialité de vos renseignements personnels est immédiatement évalué par notre responsable de la protection des renseignements personnels. Nous prenons sans délai les mesures nécessaires pour en limiter les conséquences et éviter qu'un incident similaire ne se reproduise. Si l'incident présente un risque de préjudice sérieux, nous vous en informons sans délai et en avisons la Commission d'accès à l'information. Tous les incidents sont consignés dans notre registre interne des incidents de confidentialité.

### 19. Cette politique peut-elle être modifiée ?

Nous pouvons modifier la présente politique en tout temps pour la maintenir à jour. En cas de modification importante, nous vous en informerons par un avis dans l'application ou par courriel avant que les changements n'entrent en vigueur. La date de la dernière mise à jour figure en haut de la présente politique.

### 20. Comment nous joindre ?

Pour toute question relative à la présente politique, pour exercer vos droits ou pour formuler une plainte, contactez notre responsable de la protection des renseignements personnels.

Rallia inc.

A/s : Jean de Laure Sonkin Tenessong

Responsable de la protection des renseignements personnels

203-5740 boul. Cavendish, Côte-Saint-Luc (Québec) H4W 2T8

[contact@rallia.ca](mailto:contact@rallia.ca)

514.601.4198
`,
};
