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
    'preheader.tournamentInvitation': "You've been invited to {tournamentName}",
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
    'invitation.subject': "You're invited to join Rallia",
    'invitation.heading': "You're invited!",
    'invitation.ctaButton': 'Accept invitation',
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
    'match.button.viewInvitation': 'View invitation',
    'match.button.viewTournamentInvitation': 'View tournament',
    'match.button.reviewRequest': 'Review request',
    'match.button.browseGames': 'Browse games',
    'match.button.rateGame': 'Rate your game',
    'match.button.viewGame': 'View game',
    'match.button.viewGameDetails': 'View game details',
    'match.button.viewMessage': 'View message',
    'match.button.viewProfile': 'View profile',
    'match.button.viewRating': 'View rating',
    'match.button.viewTournament': 'View event',
    'match.button.registerNow': 'Register now',
    'match.button.viewDraw': 'View the draw',
    'match.button.viewResults': 'View results',
    'match.button.completeRegistration': 'Complete your registration',
    'match.button.checkIn': 'Check in',
    'match.button.bookCourt': 'Book a court',
    'match.button.reviewTime': 'Review the time',
    'match.button.reviewScore': 'Review the score',
    'match.button.viewCommunity': 'View community',
    'match.button.viewRequest': 'View request',
    'match.button.updateAvailability': 'Update your availability',
    'match.button.openRallia': 'Open Rallia',

    // Match status badges
    'match.status.cancelled': 'Cancelled',
    'match.status.updated': 'Updated',
    'match.status.startingSoon': 'Starting soon',
    'match.status.checkInOpen': 'Check-in open',

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
    'org.button.viewBooking': 'View booking',
    'org.button.viewMembers': 'View members',
    'org.button.viewPayments': 'View payments',
    'org.button.viewReport': 'View report',
    'org.button.viewAnnouncement': 'View announcement',
    'org.button.viewDetails': 'View details',
    'org.scanQrCode': 'Scan this QR code at the venue',
    'match.dateAt': 'at',
    'org.dateAt': 'at',

    // Welcome (post-onboarding)
    'welcome.subject': 'Welcome to Rallia, {firstName}: your first game starts now',
    'welcome.subjectDefault': 'Welcome to Rallia: your first game starts now',
    'welcome.preheader': 'One step to unlock your invitations to play this week.',
    'welcome.heading': 'Welcome to Rallia, {firstName}',
    'welcome.headingDefault': 'Welcome to Rallia',
    'welcome.intro': "You've just joined Montreal's {sport} community. Welcome.",
    'welcome.mission':
      "We have one mission: to turn every urge to play into a real game on the court. And we're starting now.",
    'welcome.hero.title': '🎯 Your next step: complete your profile',
    'welcome.hero.body':
      'Photo, bio, availability, and above all, proof of your level. A complete profile builds trust, makes you visible to the right partners, and brings you up to 2x more invitations to play. The video proof of your level is what really sets you apart from other profiles.',
    'welcome.hero.cta': 'Complete my profile',
    'welcome.stepsIntro': 'Once your profile is ready, the rest takes just a few clicks:',
    'welcome.steps.courts.title': '🏟️ Explore the courts near you',
    'welcome.steps.courts.body':
      "{courtCount} courts {area}, several of them showing real-time availability. Then book directly on the facility's website.",
    'welcome.steps.courts.cta': 'See the courts',
    'welcome.sportFallback': 'tennis and pickleball',
    'welcome.courts.countFallback': '1,200+',
    'welcome.area.nearYou': 'near you',
    'welcome.area.region': 'across Greater Montreal',
    'welcome.steps.games.title': '🤝 Join or create your first game',
    'welcome.steps.games.body':
      'Open games are waiting near you, or create your own and find a compatible partner.',
    'welcome.steps.games.cta': 'Find a game',
    'welcome.community':
      'Looking for more than games? Join our private groups and public communities in Montreal too.',
    'welcome.contact':
      'Questions? Running into something? Write to us at {email}, and Jean and Mathis will get back to you personally. We want your first Rallia experience to be a great one.',
    'welcome.signoff': 'See you on the courts soon,',
    'welcome.signoffTeam': 'The Rallia Team',
    'welcome.disclaimer':
      "You're receiving this email because you just finished creating your Rallia account.",
    'welcome.footerNote': 'Rallia — Find players, join games, play more',

    // Match Interest (public visitor conversion email)
    'matchInterest.subject': 'Join this {sportName} game on Rallia',
    'matchInterest.preheader': 'Download Rallia to join the {sportName} game on {matchDate}',
    'matchInterest.heading': 'Your spot is waiting',
    'matchInterest.greeting': 'Hi {name},',
    'matchInterest.greetingDefault': 'Hi there,',
    'matchInterest.body':
      "You're one step away from joining this game. Download the Rallia app and create your free account to secure your spot.",
    'matchInterest.ctaButton': 'Get Rallia & join the game',
    'matchInterest.gameInfoLabel': 'Game info',
    'matchInterest.sport': 'Sport',
    'matchInterest.date': 'Date',
    'matchInterest.time': 'Time',
    'matchInterest.location': 'Location',
    'matchInterest.valueProp':
      "Once you're signed up, you'll also be able to discover more games near you, connect with local players, and organize your own games.",
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
    'notification.nearby.title.host': '{hostName} wants to play near you',
    'notification.nearby.title.generic': 'New game near you',
    'notification.nearby.timeAt': ' at {time}',
    'notification.nearby.locationAt': ' at {location}',
    'notification.nearby.spotsCta': '{count} spots left, tap to join!',
    'notification.nearby.spotsCta_one': '{count} spot left, tap to join!',
    'notification.nearby.cta': 'Tap to join!',
    'notification.nearby.today': 'Today',
    'notification.nearby.tomorrow': 'Tomorrow',

    // Chat message push (localizes the generic title prefix for every new_message)
    'notification.chat.titleFrom': 'Message from {senderName}',

    // Court system chat messages (push localization for court_booking_prompt / court_booked)
    'notification.courtFallback': 'the court',
    'notification.courtPrompt.title': 'Your match is full!',
    'notification.courtPrompt.body':
      'No court booked yet at {facility}. Grab one to lock in your game.',
    'notification.courtPrompt.bodyNoFacility':
      'No court booked yet. Grab one to lock in your game.',
    'notification.courtBooked.title': '{court} is booked!',
    'notification.courtBooked.body': 'See you on the court at {facility}.',
    'notification.courtBooked.bodyNoFacility': 'The court is booked. See you there!',

    // Match organizer card push (body mirrors the conversation-list preview copy)
    'notification.matchOrganizer.body': 'I suggested some times to play',

    // Morning digest
    'digest.subject': 'Your morning game briefing',
    'digest.preheader': 'Upcoming games near you + players to challenge this week',
    'digest.heading': 'Good morning, {firstName}',
    'digest.headingDefault': 'Good morning',
    'digest.intro': "Here's what's coming up near you this week.",
    'digest.matchesSection': 'Games near you',
    'digest.suggestionsSection': 'Players to challenge',
    'digest.feedSection': "Today's games & suggestions",
    'digest.sportSection.tennis': 'Tennis — picked for you',
    'digest.sportSection.pickleball': 'Pickleball — picked for you',
    'digest.dateLabel.today': 'Today',
    'digest.dateLabel.tomorrow': 'Tomorrow',
    'digest.joinButton': 'Join',
    'digest.askToJoinButton': 'Ask to join',
    'digest.challengeButton': 'Challenge',
    'digest.suggestionInviteButton': 'Send invite',
    'digest.browseAllGames': 'Browse all games',
    'digest.discoverAllSuggestions': 'Discover all suggestions',
    'digest.disclaimer':
      "You're receiving this email because you have a Rallia account. To stop these emails, update your notification preferences in the app.",
    'digest.footerNote': 'Rallia — Find players, join games, play more',
    'digest.formatSingles': 'Singles',
    'digest.formatDoubles': 'Doubles',
    'digest.spotLeft': '1 spot left',
    'digest.spotsLeft': '{count} spots left',
    'digest.matchFull': 'Full',
    'digest.vibeLabel.casual': 'Casual',
    'digest.vibeLabel.competitive': 'Competitive',
    'digest.costFree': 'Free',
    'digest.courtBooked': 'Court booked',
    'digest.period.morning': 'Mornings',
    'digest.period.afternoon': 'Afternoons',
    'digest.period.evening': 'Evenings',
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
    'preheader.tournamentInvitation': 'Tu es invité au tournoi {tournamentName}',
    'preheader.matchInvitation': '{playerName} veut jouer au {sportName} avec toi',
    'preheader.matchJoinRequest': '{playerName} veut rejoindre ta partie',
    'preheader.matchJoinAccepted': "C'est confirmé, ta partie est réservée",
    'preheader.matchJoinRejected': "Ta demande n'a pas été retenue",
    'preheader.matchPlayerJoined': '{playerName} a rejoint ta partie',
    'preheader.matchCancelled': 'Une partie à laquelle tu participais a été annulée',
    'preheader.matchUpdated': 'Les détails de ta partie ont changé',
    'preheader.matchStartingSoon': "Ta partie commence bientôt, c'est l'heure de t'échauffer",
    'preheader.matchCheckInAvailable':
      "L'enregistrement est ouvert, confirme ta présence à l'arrivée",
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
    'match.button.viewTournamentInvitation': 'Voir le tournoi',
    'match.button.reviewRequest': 'Examiner la demande',
    'match.button.browseGames': 'Parcourir les parties',
    'match.button.rateGame': 'Évaluer ta partie',
    'match.button.viewGame': 'Voir la partie',
    'match.button.viewGameDetails': 'Voir les détails de la partie',
    'match.button.viewMessage': 'Voir le message',
    'match.button.viewProfile': 'Voir le profil',
    'match.button.viewRating': "Voir l'évaluation",
    'match.button.viewTournament': "Voir l'événement",
    'match.button.registerNow': "S'inscrire",
    'match.button.viewDraw': 'Voir le tableau',
    'match.button.viewResults': 'Voir les résultats',
    'match.button.completeRegistration': 'Compléter ton inscription',
    'match.button.checkIn': 'Confirmer ta présence',
    'match.button.bookCourt': 'Réserver un terrain',
    'match.button.reviewTime': "Voir l'heure proposée",
    'match.button.reviewScore': 'Voir le pointage',
    'match.button.viewCommunity': 'Voir la communauté',
    'match.button.viewRequest': 'Voir la demande',
    'match.button.updateAvailability': 'Mettre à jour tes disponibilités',
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
    'welcome.subject': 'Bienvenue sur Rallia, {firstName} : ta première partie commence maintenant',
    'welcome.subjectDefault': 'Bienvenue sur Rallia : ta première partie commence maintenant',
    'welcome.preheader': 'Une étape pour débloquer tes invitations à jouer cette semaine.',
    'welcome.heading': 'Bienvenue sur Rallia, {firstName}',
    'welcome.headingDefault': 'Bienvenue sur Rallia',
    'welcome.intro': 'Tu viens de rejoindre la communauté {sport} de Montréal.',
    'welcome.mission':
      'On a une seule mission : transformer chaque envie de jouer en une vraie partie sur le terrain. Et on commence maintenant.',
    'welcome.hero.title': '🎯 Ta prochaine étape : complète ton profil',
    'welcome.hero.body':
      "Photo, bio, disponibilités et surtout ta preuve de niveau. Un profil complet inspire confiance, te rend visible auprès des bons partenaires et t'apporte jusqu'à 2x plus d'invitations à jouer. La preuve vidéo de ton niveau, c'est ce qui te démarque vraiment des autres profils.",
    'welcome.hero.cta': 'Compléter mon profil',
    'welcome.stepsIntro': 'Une fois ton profil prêt, tout se fait en quelques clics :',
    'welcome.steps.courts.title': '🏟️ Explore les terrains près de chez toi',
    'welcome.steps.courts.body':
      "{courtCount} terrains {area}, dont plusieurs affichent leurs disponibilités en temps réel. Réserve ensuite directement sur le site de l'établissement.",
    'welcome.steps.courts.cta': 'Voir les terrains',
    'welcome.sportFallback': 'tennis et pickleball',
    'welcome.courts.countFallback': '1200+',
    'welcome.area.nearYou': 'près de chez toi',
    'welcome.area.region': 'dans le grand Montréal',
    'welcome.steps.games.title': '🤝 Rejoins ou crée ta première partie',
    'welcome.steps.games.body':
      "Des parties ouvertes t'attendent près de chez toi, ou crée la tienne et trouve un partenaire compatible.",
    'welcome.steps.games.cta': 'Trouver une partie',
    'welcome.community':
      'Tu cherches plus que des parties ? Rejoins aussi les groupes privés et les communautés publiques à Montréal.',
    'welcome.contact':
      "Une question ? Un problème ? Écris-nous à {email}, c'est Jean et Mathis qui te répondront personnellement. On tient à ce que ta première expérience sur Rallia soit parfaite.",
    'welcome.signoff': 'À très vite sur les terrains,',
    'welcome.signoffTeam': "L'équipe Rallia",
    'welcome.disclaimer':
      'Tu reçois ce courriel parce que tu viens de terminer la création de ton compte Rallia.',
    'welcome.footerNote': 'Rallia. Trouve des joueurs, rejoins des parties, joue plus',

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
      "Une fois inscrit, tu pourras aussi découvrir d'autres parties près de chez toi, rencontrer des joueurs locaux et organiser tes propres parties.",
    'matchInterest.disclaimer':
      "Tu reçois ce courriel parce que tu as manifesté de l'intérêt pour une partie sur Rallia. Si ce n'était pas toi, ignore simplement ce courriel.",
    'matchInterest.footerNote': 'Rallia. Trouve des joueurs, rejoins des parties, joue plus',

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
    'sms.separator': ' - ',

    // Push: nearby_match_available
    'notification.nearby.title.host': '{hostName} veut jouer pas loin de toi',
    'notification.nearby.title.generic': 'Nouvelle partie pas loin de toi',
    'notification.nearby.timeAt': ' à {time}',
    'notification.nearby.locationAt': ', {location}',
    'notification.nearby.spotsCta': '{count} places libres, clique pour embarquer!',
    'notification.nearby.spotsCta_one': '{count} place libre, clique pour embarquer!',
    'notification.nearby.cta': 'Clique pour embarquer!',
    'notification.nearby.today': "Aujourd'hui",
    'notification.nearby.tomorrow': 'Demain',

    // Chat message push (localizes the generic title prefix for every new_message)
    'notification.chat.titleFrom': 'Message de {senderName}',

    // Court system chat messages (push localization for court_booking_prompt / court_booked)
    'notification.courtFallback': 'le terrain',
    'notification.courtPrompt.title': 'Votre partie est complète!',
    'notification.courtPrompt.body':
      'Aucun terrain réservé à {facility}. Réservez-en un pour confirmer votre partie.',
    'notification.courtPrompt.bodyNoFacility':
      'Aucun terrain réservé. Réservez-en un pour confirmer votre partie.',
    'notification.courtBooked.title': '{court} est réservé!',
    'notification.courtBooked.body': 'Rendez-vous sur le terrain à {facility}.',
    'notification.courtBooked.bodyNoFacility': 'Le terrain est réservé. À bientôt!',

    // Match organizer card push (body mirrors the conversation-list preview copy)
    'notification.matchOrganizer.body': "J'ai proposé des moments pour jouer",

    // Morning digest
    'digest.subject': 'Ton briefing matinal',
    'digest.preheader': 'Parties à venir près de toi + joueurs à défier cette semaine',
    'digest.heading': 'Bonjour, {firstName}',
    'digest.headingDefault': 'Bonjour',
    'digest.intro': 'Voici ce qui se passe près de toi cette semaine.',
    'digest.matchesSection': 'Parties près de toi',
    'digest.suggestionsSection': 'Joueurs à défier',
    'digest.feedSection': 'Parties et suggestions du jour',
    'digest.sportSection.tennis': 'Tennis : sélectionné pour toi',
    'digest.sportSection.pickleball': 'Pickleball : sélectionné pour toi',
    'digest.dateLabel.today': "Aujourd'hui",
    'digest.dateLabel.tomorrow': 'Demain',
    'digest.joinButton': 'Rejoindre',
    'digest.askToJoinButton': 'Demander à rejoindre',
    'digest.challengeButton': 'Défier',
    'digest.suggestionInviteButton': 'Envoyer une invitation',
    'digest.browseAllGames': 'Voir toutes les parties',
    'digest.discoverAllSuggestions': 'Découvrir toutes les suggestions',
    'digest.disclaimer':
      "Tu reçois ce courriel parce que tu as un compte Rallia. Pour arrêter ces courriels, modifie tes préférences de notification dans l'application.",
    'digest.footerNote': 'Rallia. Trouve des joueurs, rejoins des parties, joue plus',
    'digest.formatSingles': 'Simple',
    'digest.formatDoubles': 'Double',
    'digest.spotLeft': '1 place libre',
    'digest.spotsLeft': '{count} places libres',
    'digest.matchFull': 'Complet',
    'digest.vibeLabel.casual': 'Loisir',
    'digest.vibeLabel.competitive': 'Compétitif',
    'digest.costFree': 'Gratuit',
    'digest.courtBooked': 'Terrain réservé',
    'digest.period.morning': 'Matins',
    'digest.period.afternoon': 'Après-midis',
    'digest.period.evening': 'Soirées',
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
