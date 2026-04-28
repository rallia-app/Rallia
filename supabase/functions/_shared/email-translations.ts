/**
 * Email Translation Strings
 * Provides i18n for all email templates (en-US and fr-CA).
 */

type Translations = Record<string, Record<string, string>>;

const translations: Translations = {
  'en-US': {
    // Layout
    'layout.needHelp': 'Need help?',
    'layout.supportText': "If you're having trouble, please contact our support team.",
    'layout.allRightsReserved': 'All rights reserved.',
    'layout.downloadApp': 'Download the app',
    'layout.appStoreAlt': 'Download on the App Store',
    'layout.googlePlayAlt': 'Get it on Google Play',
    'layout.managePreferences': 'Manage notification preferences',

    // Preheaders
    'preheader.confirmation': 'Your Rallia verification code is inside',
    'preheader.magicLink': 'Your one-time login code for Rallia',
    'preheader.invitation': "You've been invited to join {networkName} on Rallia",
    'preheader.matchInvitation': '{playerName} wants to play {sportName} with you',
    'preheader.matchJoinRequest': '{playerName} wants to join your game',
    'preheader.matchJoinAccepted': "You're in! Your game is confirmed",
    'preheader.matchJoinRejected': 'Your join request was not accepted',
    'preheader.matchPlayerJoined': '{playerName} joined your game',
    'preheader.matchCancelled': 'A game you were part of has been cancelled',
    'preheader.matchUpdated': 'Your game details have been updated',
    'preheader.matchStartingSoon': 'Your game starts soon — time to warm up!',
    'preheader.matchCheckInAvailable':
      'Check-in is now open — confirm your presence when you arrive',
    'preheader.playerKicked': "You've been removed from a game",
    'preheader.playerLeft': 'A player left your game',
    'preheader.reminder': "Don't forget your upcoming game",
    'preheader.feedbackRequest': 'Submit your score and rate your game',
    'preheader.feedbackReminder': 'Your score and rating are still pending',
    'preheader.notification': '{body}',
    'preheader.orgBooking': 'Booking update from {orgName}',
    'preheader.orgMember': 'Member update from {orgName}',
    'preheader.orgPayment': 'Payment update from {orgName}',
    'preheader.orgGeneral': 'Update from {orgName}',

    // Invitation
    'invitation.subject': "You're Invited to Join Rallia",
    'invitation.heading': "You're Invited!",
    'invitation.ctaButton': 'Accept Invitation',
    'invitation.expiresAt': 'This invitation will expire on',
    'invitation.disclaimer':
      "If you didn't expect this invitation, you can safely ignore this email.",
    'invitation.footerNote': "You're receiving this email because you were invited to join Rallia.",
    'invitation.messageOrg': '{inviter} has invited you to join {org} on Rallia as a {role}.',
    'invitation.messagePlatform': '{inviter} has invited you to join Rallia as a {role}.',
    'invitation.ctaDescription':
      'Click the button below to accept your invitation and create your account.',

    // Notification (send-email)
    'notification.disclaimer':
      "If you didn't expect this notification, you can safely ignore this email.",
    'notification.footerNote':
      "You're receiving this email because of your notification preferences on Rallia.",
    'notification.supportText': "If you're having trouble, please contact our support team.",

    // Match email (send-notification)
    'match.sport': 'Sport',
    'match.when': 'When',
    'match.where': 'Where',
    'match.with': 'With',
    'match.address': 'Address',
    'match.duration': 'Duration',
    'match.disclaimer': "If you didn't expect this notification, you can safely ignore this email.",
    'match.footerNote':
      "You're receiving this email because of your notification preferences on Rallia.",
    'match.managePreferences': 'Manage preferences',
    'match.viewOnMap': 'View on map',

    // Calendar
    'match.addToGoogleCalendar': 'Add to Google Calendar',
    'match.downloadIcs': 'Download .ics file',

    // Match action buttons
    'match.button.viewInvitation': 'View Invitation',
    'match.button.reviewRequest': 'Review Request',
    'match.button.browseGames': 'Browse Games',
    'match.button.rateGame': 'Rate Your Game',
    'match.button.viewGame': 'View Game',
    'match.button.viewGameDetails': 'View Game Details',
    'match.button.viewMessage': 'View Message',
    'match.button.viewProfile': 'View Profile',
    'match.button.viewRating': 'View Rating',
    'match.button.openRallia': 'Open Rallia',

    // Match status badges
    'match.status.cancelled': 'Cancelled',
    'match.status.updated': 'Updated',
    'match.status.startingSoon': 'Starting Soon',
    'match.status.checkInOpen': 'Check-in Open',

    // Organization email
    'org.court': 'Court',
    'org.location': 'Location',
    'org.when': 'When',
    'org.player': 'Player',
    'org.amount': 'Amount',
    'org.from': 'From',
    'org.reason': 'Reason',
    'org.address': 'Address',
    'org.timestamp': 'Date',
    'org.disclaimer': 'You received this email because you are a member of {org}.',
    'org.managePreferences': 'Manage notification preferences',
    'org.poweredBy': 'Powered by Rallia',
    'org.button.viewBooking': 'View Booking',
    'org.button.viewMembers': 'View Members',
    'org.button.viewPayments': 'View Payments',
    'org.button.viewReport': 'View Report',
    'org.button.viewAnnouncement': 'View Announcement',
    'org.button.viewDetails': 'View Details',
    'org.scanQrCode': 'Scan this QR code at the venue',
    'match.dateAt': 'at',
    'org.dateAt': 'at',

    // Welcome (post-onboarding)
    'welcome.subject': 'Welcome to Rallia — your next game is waiting',
    'welcome.preheader': 'Your next game is waiting. Here is what you can do with Rallia.',
    'welcome.heading': 'Welcome to Rallia, {firstName}',
    'welcome.headingDefault': 'Welcome to Rallia',
    'welcome.missionTagline': 'Your next game is waiting.',
    'welcome.intro':
      "We're glad to have you on board. Rallia is built to turn your intent to play into actual matches — making it as easy as possible to find the right opponents, organize the details, and enjoy every game you show up for.",
    'welcome.featuresHeading': 'What you can do with Rallia',
    'welcome.features.courts.title': 'The most complete court directory in Greater Montreal',
    'welcome.features.courts.body':
      'Browse tennis and pickleball courts across Greater Montreal, see real-time availability for most public courts, and get redirected to the official booking page in a few clicks.',
    'welcome.features.matches.title': 'Create or join a match',
    'welcome.features.matches.body':
      'Open a public or private game, or jump into matches that fit your level, schedule, and favorite spots — no more group-chat chaos.',
    'welcome.features.levels.title': 'Skill ratings you can actually trust',
    'welcome.features.levels.body':
      "Self-declared ratings are easy — trusting them isn't. Rallia adds a layer of trust on top of NTRP / DUPR with player references and rating proofs, so the levels you see on profiles hold up and you know exactly who you're stepping on court with.",
    'welcome.features.reputation.title': 'Reliability & reputation',
    'welcome.features.reputation.body':
      'Every game counts. Build your reputation with Bronze → Platinum badges and play with people who show up.',
    'welcome.ctaButton': 'Open Rallia',
    'welcome.footerTagline': 'See you on the court.',
    'welcome.disclaimer':
      "You're receiving this email because you just finished creating your Rallia account.",
    'welcome.footerNote': 'Rallia — Find players, join games, play more',

    // Match Interest (public visitor conversion email)
    'matchInterest.subject': 'Join this {sportName} game on Rallia',
    'matchInterest.preheader': 'Download Rallia to join the {sportName} game on {matchDate}',
    'matchInterest.heading': 'Your Spot Is Waiting',
    'matchInterest.greeting': 'Hi {name},',
    'matchInterest.greetingDefault': 'Hi there,',
    'matchInterest.body':
      "You're one step away from joining this game. Download the Rallia app and create your free account to secure your spot.",
    'matchInterest.ctaButton': 'Get Rallia & Join the Game',
    'matchInterest.gameInfoLabel': 'Game info',
    'matchInterest.sport': 'Sport',
    'matchInterest.date': 'Date',
    'matchInterest.time': 'Time',
    'matchInterest.location': 'Location',
    'matchInterest.valueProp':
      "Once you're signed up, you'll also be able to discover more games near you, connect with local players, and organize your own matches.",
    'matchInterest.disclaimer':
      "You received this email because you expressed interest in a game on Rallia. If this wasn't you, you can safely ignore this email.",
    'matchInterest.footerNote': 'Rallia — Find players, join games, play more',

    // SMS formatter
    'sms.prefix': 'Rallia: ',
    'sms.urgent.startingSoon': 'STARTING {timeUntil}!',
    'sms.urgent.startingSoonFallback': 'STARTING SOON!',
    'sms.urgent.checkInOpen': 'CHECK-IN NOW OPEN!',
    'sms.urgent.cancelled': 'CANCELLED',
    'sms.youreIn': "You're in!",
    'sms.startsIn': 'Starts {timeUntil}',
    'sms.startsInFallback': 'Starts soon',
    'sms.checkInOpen': 'Check-in is open',
    'sms.reminder': 'Reminder',
    'sms.at': 'at {location}',
    'sms.gameOn': 'Game on {date}',
    'sms.separator': ' - ',

    // Push: nearby_match_available
    'notification.nearby.title': 'New {sportName} game nearby',
    'notification.nearby.body':
      '{matchDate}{startTime}{locationName}{minRatingLabel}{spotsLabel}{hostLabel}',
    'notification.nearby.hostLabel': ' · with {hostName}',
    'notification.nearby.startTimePrefix': ' at {time}',
    'notification.nearby.locationPrefix': ' · {location}',
    'notification.nearby.minRatingPrefix': ' · {score}+',
    'notification.nearby.spotsLabel': ' · {count} spot left',
    'notification.nearby.spotsLabel_plural': ' · {count} spots left',
    'notification.nearby.today': 'Today',
    'notification.nearby.tomorrow': 'Tomorrow',

    // Morning digest
    'digest.subject': 'Your morning game briefing',
    'digest.preheader': 'Upcoming games near you + players to challenge this week',
    'digest.heading': 'Good morning, {firstName}',
    'digest.headingDefault': 'Good morning',
    'digest.intro': "Here's what's coming up near you this week.",
    'digest.matchesSection': 'Games near you',
    'digest.suggestionsSection': 'Players to challenge',
    'digest.joinButton': 'Join',
    'digest.challengeButton': 'Challenge',
    'digest.browseAll': 'Browse all games',
    'digest.disclaimer':
      "You're receiving this email because you have a Rallia account. To stop these emails, update your notification preferences in the app.",
    'digest.footerNote': 'Rallia — Find players, join games, play more',
  },

  'fr-CA': {
    // Layout
    'layout.needHelp': "Besoin d'aide ?",
    'layout.supportText': 'En cas de problème, contactez notre équipe de soutien.',
    'layout.allRightsReserved': 'Tous droits réservés.',
    'layout.downloadApp': "Téléchargez l'application",
    'layout.appStoreAlt': "Télécharger dans l'App Store",
    'layout.googlePlayAlt': 'Disponible sur Google Play',
    'layout.managePreferences': 'Gérer les préférences de notification',

    // Preheaders
    'preheader.confirmation': "Ton code de vérification Rallia est à l'intérieur",
    'preheader.magicLink': 'Ton code de connexion à usage unique pour Rallia',
    'preheader.invitation': 'Tu as été invité à rejoindre {networkName} sur Rallia',
    'preheader.matchInvitation': '{playerName} veut jouer au {sportName} avec toi',
    'preheader.matchJoinRequest': '{playerName} veut rejoindre ta partie',
    'preheader.matchJoinAccepted': "C'est confirmé — ta partie est réservée",
    'preheader.matchJoinRejected': "Ta demande n'a pas été retenue",
    'preheader.matchPlayerJoined': '{playerName} a rejoint ta partie',
    'preheader.matchCancelled': 'Une partie à laquelle tu participais a été annulée',
    'preheader.matchUpdated': 'Les détails de ta partie ont changé',
    'preheader.matchStartingSoon': "Ta partie commence bientôt — c'est l'heure de t'échauffer",
    'preheader.matchCheckInAvailable':
      "L'enregistrement est ouvert — confirme ta présence à l'arrivée",
    'preheader.playerKicked': "Tu as été retiré d'une partie",
    'preheader.playerLeft': 'Un joueur a quitté ta partie',
    'preheader.reminder': "N'oublie pas ta prochaine partie",
    'preheader.feedbackRequest': 'Soumets ton score et évalue ta partie',
    'preheader.feedbackReminder': 'Ton score et ton évaluation sont toujours en attente',
    'preheader.notification': '{body}',
    'preheader.orgBooking': 'Mise à jour de réservation de {orgName}',
    'preheader.orgMember': 'Mise à jour de membre de {orgName}',
    'preheader.orgPayment': 'Mise à jour de paiement de {orgName}',
    'preheader.orgGeneral': 'Mise à jour de {orgName}',

    // Invitation
    'invitation.subject': 'Tu es invité à rejoindre Rallia',
    'invitation.heading': 'Tu es invité !',
    'invitation.ctaButton': "Accepter l'invitation",
    'invitation.expiresAt': 'Cette invitation expire le',
    'invitation.disclaimer': "Si tu n'attendais pas cette invitation, tu peux ignorer ce courriel.",
    'invitation.footerNote': 'Tu reçois ce courriel parce que tu as été invité à rejoindre Rallia.',
    'invitation.messageOrg':
      "{inviter} t'a invité à rejoindre {org} sur Rallia en tant que {role}.",
    'invitation.messagePlatform': "{inviter} t'a invité à rejoindre Rallia en tant que {role}.",
    'invitation.ctaDescription':
      'Touche le bouton ci-dessous pour accepter ton invitation et créer ton compte.',

    // Notification (send-email)
    'notification.disclaimer':
      "Si tu n'attendais pas cette notification, tu peux ignorer ce courriel.",
    'notification.footerNote':
      'Tu reçois ce courriel en raison de tes préférences de notification sur Rallia.',
    'notification.supportText': 'En cas de problème, écris à notre équipe de soutien.',

    // Match email (send-notification)
    'match.sport': 'Sport',
    'match.when': 'Quand',
    'match.where': 'Où',
    'match.with': 'Avec',
    'match.address': 'Adresse',
    'match.duration': 'Durée',
    'match.disclaimer': "Si tu n'attendais pas cette notification, tu peux ignorer ce courriel.",
    'match.footerNote':
      'Tu reçois ce courriel en raison de tes préférences de notification sur Rallia.',
    'match.managePreferences': 'Gérer les préférences',
    'match.viewOnMap': 'Voir sur la carte',

    // Calendar
    'match.addToGoogleCalendar': 'Ajouter à Google Agenda',
    'match.downloadIcs': 'Télécharger le fichier .ics',

    // Match action buttons
    'match.button.viewInvitation': "Voir l'invitation",
    'match.button.reviewRequest': 'Examiner la demande',
    'match.button.browseGames': 'Parcourir les parties',
    'match.button.rateGame': 'Évaluer ta partie',
    'match.button.viewGame': 'Voir la partie',
    'match.button.viewGameDetails': 'Voir les détails de la partie',
    'match.button.viewMessage': 'Voir le message',
    'match.button.viewProfile': 'Voir le profil',
    'match.button.viewRating': "Voir l'évaluation",
    'match.button.openRallia': 'Ouvrir Rallia',

    // Match status badges
    'match.status.cancelled': 'Annulé',
    'match.status.updated': 'Mis à jour',
    'match.status.startingSoon': 'Commence bientôt',
    'match.status.checkInOpen': 'Enregistrement ouvert',

    // Organization email
    'org.court': 'Terrain',
    'org.location': 'Emplacement',
    'org.when': 'Quand',
    'org.player': 'Joueur',
    'org.amount': 'Montant',
    'org.from': 'De',
    'org.reason': 'Raison',
    'org.address': 'Adresse',
    'org.timestamp': 'Date',
    'org.disclaimer': 'Vous recevez ce courriel car vous êtes membre de {org}.',
    'org.managePreferences': 'Gérer les préférences de notification',
    'org.poweredBy': 'Propulsé par Rallia',
    'org.button.viewBooking': 'Voir la réservation',
    'org.button.viewMembers': 'Voir les membres',
    'org.button.viewPayments': 'Voir les paiements',
    'org.button.viewReport': 'Voir le rapport',
    'org.button.viewAnnouncement': "Voir l'annonce",
    'org.button.viewDetails': 'Voir les détails',
    'org.scanQrCode': 'Scannez ce code QR sur place',
    'match.dateAt': 'à',
    'org.dateAt': 'à',

    // Welcome (post-onboarding)
    'welcome.subject': "Bienvenue sur Rallia — ta prochaine partie t'attend",
    'welcome.preheader': "Ta prochaine partie t'attend. Voici ce que tu peux faire avec Rallia.",
    'welcome.heading': 'Bienvenue sur Rallia, {firstName}',
    'welcome.headingDefault': 'Bienvenue sur Rallia',
    'welcome.missionTagline': "Ta prochaine partie t'attend.",
    'welcome.intro':
      "On est content de t'avoir avec nous. Rallia est conçu pour transformer ton envie de jouer en vraies parties — en rendant le plus simple possible de trouver les bons adversaires, d'organiser les détails, et de profiter pleinement de chaque match.",
    'welcome.featuresHeading': 'Ce que tu peux faire avec Rallia',
    'welcome.features.courts.title': 'Le répertoire de terrains le plus complet du Grand Montréal',
    'welcome.features.courts.body':
      'Parcours les terrains de tennis et de pickleball du Grand Montréal, vois les disponibilités en temps réel sur la plupart des terrains publics, et fais-toi rediriger vers la page officielle de réservation en quelques clics.',
    'welcome.features.matches.title': 'Crée ou rejoins une partie',
    'welcome.features.matches.body':
      'Ouvre une partie publique ou privée, ou rejoins des matchs adaptés à ton niveau, ton horaire et tes terrains préférés — fini le chaos des groupes de texto.',
    'welcome.features.levels.title': 'Des niveaux auxquels tu peux te fier',
    'welcome.features.levels.body':
      "Les notes auto-déclarées, c'est facile — les croire, c'est autre chose. Rallia ajoute une couche de confiance par-dessus NTRP / DUPR avec des références de joueurs et des preuves de niveau, pour que les classements affichés reflètent la réalité et que tu saches vraiment avec qui tu embarques sur le terrain.",
    'welcome.features.reputation.title': 'Fiabilité et réputation',
    'welcome.features.reputation.body':
      'Chaque partie compte. Bâtis ta réputation avec les badges Bronze → Platine et joue avec du monde qui se présente.',
    'welcome.ctaButton': 'Ouvrir Rallia',
    'welcome.footerTagline': 'On se voit sur le terrain.',
    'welcome.disclaimer':
      'Tu reçois ce courriel parce que tu viens de terminer la création de ton compte Rallia.',
    'welcome.footerNote': 'Rallia — Trouve des joueurs, rejoins des parties, joue plus',

    // Match Interest (public visitor conversion email)
    'matchInterest.subject': 'Rejoins cette partie de {sportName} sur Rallia',
    'matchInterest.preheader':
      'Télécharge Rallia pour rejoindre la partie de {sportName} le {matchDate}',
    'matchInterest.heading': "Ta place t'attend",
    'matchInterest.greeting': 'Salut {name},',
    'matchInterest.greetingDefault': 'Salut,',
    'matchInterest.body':
      "Tu es à un pas de rejoindre cette partie. Télécharge l'application Rallia et crée ton compte gratuit pour réserver ta place.",
    'matchInterest.ctaButton': 'Télécharger Rallia et rejoindre',
    'matchInterest.gameInfoLabel': 'Détails de la partie',
    'matchInterest.sport': 'Sport',
    'matchInterest.date': 'Date',
    'matchInterest.time': 'Heure',
    'matchInterest.location': 'Lieu',
    'matchInterest.valueProp':
      "Une fois inscrit, tu pourras aussi découvrir d'autres parties près de chez toi, rencontrer des joueurs locaux et organiser tes propres matchs.",
    'matchInterest.disclaimer':
      "Tu reçois ce courriel parce que tu as manifesté de l'intérêt pour une partie sur Rallia. Si ce n'était pas toi, ignore simplement ce courriel.",
    'matchInterest.footerNote': 'Rallia — Trouve des joueurs, rejoins des parties, joue plus',

    // SMS formatter
    'sms.prefix': 'Rallia : ',
    'sms.urgent.startingSoon': 'COMMENCE {timeUntil} !',
    'sms.urgent.startingSoonFallback': 'COMMENCE BIENTÔT !',
    'sms.urgent.checkInOpen': 'ENREGISTREMENT OUVERT !',
    'sms.urgent.cancelled': 'ANNULÉ',
    'sms.youreIn': "C'est confirmé !",
    'sms.startsIn': 'Commence {timeUntil}',
    'sms.startsInFallback': 'Commence bientôt',
    'sms.checkInOpen': 'Enregistrement ouvert',
    'sms.reminder': 'Rappel',
    'sms.at': 'à {location}',
    'sms.gameOn': 'Partie le {date}',
    'sms.separator': ' — ',

    // Push: nearby_match_available
    'notification.nearby.title': 'Nouvelle partie de {sportName} près de toi',
    'notification.nearby.body':
      '{matchDate}{startTime}{locationName}{minRatingLabel}{spotsLabel}{hostLabel}',
    'notification.nearby.hostLabel': ' · avec {hostName}',
    'notification.nearby.startTimePrefix': ' à {time}',
    'notification.nearby.locationPrefix': ' · {location}',
    'notification.nearby.minRatingPrefix': ' · {score}+',
    'notification.nearby.spotsLabel': ' · {count} place libre',
    'notification.nearby.spotsLabel_plural': ' · {count} places libres',
    'notification.nearby.today': "Aujourd'hui",
    'notification.nearby.tomorrow': 'Demain',

    // Morning digest
    'digest.subject': 'Ton briefing matinal de partie',
    'digest.preheader': 'Parties à venir près de toi + joueurs à défier cette semaine',
    'digest.heading': 'Bonjour, {firstName}',
    'digest.headingDefault': 'Bonjour',
    'digest.intro': 'Voici ce qui se passe près de toi cette semaine.',
    'digest.matchesSection': 'Parties près de toi',
    'digest.suggestionsSection': 'Joueurs à défier',
    'digest.joinButton': 'Rejoindre',
    'digest.challengeButton': 'Défier',
    'digest.browseAll': 'Voir toutes les parties',
    'digest.disclaimer':
      "Tu reçois ce courriel parce que tu as un compte Rallia. Pour arrêter ces courriels, modifie tes préférences de notification dans l'application.",
    'digest.footerNote': 'Rallia — Trouve des joueurs, rejoins des parties, joue plus',
  },
};

/**
 * Translate a key for the given locale, with en-US fallback.
 * Supports simple {placeholder} interpolation.
 */
export function t(locale: string, key: string, params?: Record<string, string>): string {
  const normalizedLocale = locale === 'fr' ? 'fr-CA' : locale;
  let value = translations[normalizedLocale]?.[key] ?? translations['en-US']?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return value;
}
