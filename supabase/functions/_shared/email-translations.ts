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
    'preheader.matchCompleted': 'Your game is complete — share your feedback',
    'preheader.playerKicked': "You've been removed from a game",
    'preheader.playerLeft': 'A player left your game',
    'preheader.reminder': "Don't forget your upcoming game",
    'preheader.feedbackRequest': 'Submit your score and rate your match',
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
    'invitation.disclaimer': "If you didn't expect this invitation, you can safely ignore this email.",
    'invitation.footerNote': "You're receiving this email because you were invited to join Rallia.",
    'invitation.messageOrg': '{inviter} has invited you to join {org} on Rallia as a {role}.',
    'invitation.messagePlatform': '{inviter} has invited you to join Rallia as a {role}.',
    'invitation.ctaDescription': 'Click the button below to accept your invitation and create your account.',

    // Notification (send-email)
    'notification.disclaimer': "If you didn't expect this notification, you can safely ignore this email.",
    'notification.footerNote': "You're receiving this email because of your notification preferences on Rallia.",
    'notification.supportText': "If you're having trouble, please contact our support team.",

    // Notification subject prefixes
    'notification.prefix.match_invitation': 'Match Invitation',
    'notification.prefix.reminder': 'Reminder',
    'notification.prefix.payment': 'Payment',
    'notification.prefix.support': 'Support',
    'notification.prefix.chat': 'New Message',
    'notification.prefix.system': 'System Notification',

    // Match email (send-notification)
    'match.sport': 'Sport',
    'match.when': 'When',
    'match.where': 'Where',
    'match.with': 'With',
    'match.address': 'Address',
    'match.duration': 'Duration',
    'match.disclaimer': "If you didn't expect this notification, you can safely ignore this email.",
    'match.footerNote': "You're receiving this email because of your notification preferences on Rallia.",
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
    'preheader.confirmation': 'Votre code de vérification Rallia est à l\'intérieur',
    'preheader.magicLink': 'Votre code de connexion à usage unique pour Rallia',
    'preheader.invitation': 'Vous avez été invité(e) à rejoindre {networkName} sur Rallia',
    'preheader.matchInvitation': '{playerName} veut jouer au {sportName} avec vous',
    'preheader.matchJoinRequest': '{playerName} veut rejoindre votre match',
    'preheader.matchJoinAccepted': 'Confirmé ! Votre match est réservé',
    'preheader.matchJoinRejected': "Votre demande n'a pas été acceptée",
    'preheader.matchPlayerJoined': '{playerName} a rejoint votre match',
    'preheader.matchCancelled': 'Un match auquel vous participiez a été annulé',
    'preheader.matchUpdated': 'Les détails de votre match ont été mis à jour',
    'preheader.matchStartingSoon': 'Votre match commence bientôt — échauffez-vous !',
    'preheader.matchCompleted': 'Votre match est terminé — partagez vos commentaires',
    'preheader.playerKicked': 'Vous avez été retiré(e) d\'un match',
    'preheader.playerLeft': 'Un joueur a quitté votre match',
    'preheader.reminder': "N'oubliez pas votre prochain match",
    'preheader.feedbackRequest': 'Soumettez votre score et évaluez votre match',
    'preheader.feedbackReminder': 'Votre score et votre évaluation sont toujours en attente',
    'preheader.notification': '{body}',
    'preheader.orgBooking': 'Mise à jour de réservation de {orgName}',
    'preheader.orgMember': 'Mise à jour de membre de {orgName}',
    'preheader.orgPayment': 'Mise à jour de paiement de {orgName}',
    'preheader.orgGeneral': 'Mise à jour de {orgName}',

    // Invitation
    'invitation.subject': 'Vous êtes invité(e) à rejoindre Rallia',
    'invitation.heading': 'Vous êtes invité(e) !',
    'invitation.ctaButton': "Accepter l'invitation",
    'invitation.expiresAt': 'Cette invitation expire le',
    'invitation.disclaimer': "Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce courriel.",
    'invitation.footerNote': 'Vous recevez ce courriel car vous avez été invité(e) à rejoindre Rallia.',
    'invitation.messageOrg': '{inviter} vous a invité(e) à rejoindre {org} sur Rallia en tant que {role}.',
    'invitation.messagePlatform': '{inviter} vous a invité(e) à rejoindre Rallia en tant que {role}.',
    'invitation.ctaDescription': "Cliquez sur le bouton ci-dessous pour accepter votre invitation et créer votre compte.",

    // Notification (send-email)
    'notification.disclaimer': "Si vous n'attendiez pas cette notification, vous pouvez ignorer ce courriel.",
    'notification.footerNote': 'Vous recevez ce courriel en raison de vos préférences de notification sur Rallia.',
    'notification.supportText': 'En cas de problème, contactez notre équipe de soutien.',

    // Notification subject prefixes
    'notification.prefix.match_invitation': 'Invitation de match',
    'notification.prefix.reminder': 'Rappel',
    'notification.prefix.payment': 'Paiement',
    'notification.prefix.support': 'Soutien',
    'notification.prefix.chat': 'Nouveau message',
    'notification.prefix.system': 'Notification système',

    // Match email (send-notification)
    'match.sport': 'Sport',
    'match.when': 'Quand',
    'match.where': 'Où',
    'match.with': 'Avec',
    'match.address': 'Adresse',
    'match.duration': 'Durée',
    'match.disclaimer': "Si vous n'attendiez pas cette notification, vous pouvez ignorer ce courriel.",
    'match.footerNote': 'Vous recevez ce courriel en raison de vos préférences de notification sur Rallia.',
    'match.managePreferences': 'Gérer les préférences',
    'match.viewOnMap': 'Voir sur la carte',

    // Calendar
    'match.addToGoogleCalendar': 'Ajouter à Google Agenda',
    'match.downloadIcs': 'Télécharger le fichier .ics',

    // Match action buttons
    'match.button.viewInvitation': "Voir l'invitation",
    'match.button.reviewRequest': 'Examiner la demande',
    'match.button.browseGames': 'Parcourir les matchs',
    'match.button.rateGame': 'Évaluer votre match',
    'match.button.viewGame': 'Voir le match',
    'match.button.viewGameDetails': 'Voir les détails du match',
    'match.button.viewMessage': 'Voir le message',
    'match.button.viewProfile': 'Voir le profil',
    'match.button.viewRating': "Voir l'évaluation",
    'match.button.openRallia': 'Ouvrir Rallia',

    // Match status badges
    'match.status.cancelled': 'Annulé',
    'match.status.updated': 'Mis à jour',
    'match.status.startingSoon': 'Commence bientôt',

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
