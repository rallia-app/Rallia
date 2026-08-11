import { SheetRegister, SheetDefinition } from 'react-native-actions-sheet';
import type {
  SharedContactList,
  SharedContact,
  MessageWithSender,
  ConversationPreview,
} from '@rallia/shared-services';

import { FeedbackReportActionSheet } from '#/components/BugReportSheet';
import { MatchSuggestionsActionSheet } from '#/components/MatchSuggestionsSheet';
import { MatchInviteConfirmActionSheet } from '#/components/MatchInviteConfirmSheet';
import { SuggestMatchTimeActionSheet } from '#/components/SuggestMatchTimeSheet';
import { CreateCommunityActionSheet } from '#/features/communities/components/CreateCommunityModal';
import { CreateListActionSheet } from '#/features/shared-lists/components/CreateListModal';
import { ShareMatchActionSheet } from '#/features/shared-lists/components/ShareMatchModal';
import { AddContactActionSheet } from '#/features/shared-lists/components/AddContactModal';
import { ImportContactsActionSheet } from '#/features/shared-lists/components/ImportContactsModal';
import { CreateGroupActionSheet } from '#/features/groups/components/CreateGroupModal';
import { GroupOptionsActionSheet } from '#/features/groups/components/GroupOptionsModal';
import { MemberOptionsActionSheet } from '#/features/groups/components/MemberOptionsModal';
import { InviteLinkActionSheet } from '#/features/groups/components/InviteLinkModal';
import { RecentGamesActionSheet } from '#/features/groups/components/RecentGamesModal';
import { ComparisonOverlay } from '#/features/matches/components/leaderboard/ComparisonOverlay';
import { AddGroupMemberActionSheet } from '#/features/groups/components/AddGroupMemberModal';
import { MemberListActionSheet } from '#/features/groups/components/MemberListModal';
import { EditGroupActionSheet } from '#/features/groups/components/EditGroupModal';
// Community components
import { AddCommunityMemberActionSheet } from '#/features/communities/components/AddCommunityMemberModal';
import { EditCommunityActionSheet } from '#/features/communities/components/EditCommunityModal';
import { PendingRequestsActionSheet } from '#/features/communities/components/PendingRequestsSheet';
// Matches components
import { MatchTypeActionSheet } from '#/features/matches/components/MatchTypeModal';
import { ShareToFacebookActionSheet } from '#/features/matches/components/ShareToFacebookSheet';
import { ScoreConfirmationActionSheet } from '#/features/matches/components/ScoreConfirmationModal';
import { RegisterMatchScoreActionSheet } from '#/features/matches/components/RegisterMatchScoreSheet';
import { CourtSelectionActionSheet } from '#/features/matches/components/CourtSelectionSheet';
import { ReportIssueActionSheet } from '#/features/matches/components/feedback-steps/ReportIssueSheet';
// Tournament components
import { TournamentRecordScoreActionSheet } from '#/features/tournaments/components/TournamentRecordScoreSheet';
import { TournamentLinkMatchActionSheet } from '#/features/tournaments/components/TournamentLinkMatchSheet';
import { TournamentPartnerPickerActionSheet } from '#/features/tournaments/components/TournamentPartnerPickerSheet';
import { TournamentEditActionSheet } from '#/features/tournaments/components/TournamentEditSheet';
import { TournamentInviteSheet } from '#/features/tournaments/components/TournamentInviteSheet';
import { TournamentInvitePlayersActionSheet } from '#/features/tournaments/components/TournamentInvitePlayersSheet';
import { TournamentCoOrganizerActionSheet } from '#/features/tournaments/components/TournamentCoOrganizerSheet';
import { LeagueInvitePlayersActionSheet } from '#/features/leagues/components/LeagueInvitePlayersSheet';
import { LeagueInviteSheet } from '#/features/leagues/components/LeagueInviteSheet';
import {
  LeagueEditActionSheet,
  LeagueCreateActionSheet,
} from '#/features/leagues/components/LeagueFormSheets';
import { CreateSeasonActionSheet } from '#/features/leagues/components/CreateSeasonSheet';
import { CreateSessionActionSheet } from '#/features/leagues/components/CreateSessionSheet';
import { SessionLinkMatchActionSheet } from '#/features/leagues/components/SessionLinkMatchSheet';
import { SessionSwapPlayerActionSheet } from '#/features/leagues/components/SessionSwapPlayerSheet';
import { SessionRecordScoreActionSheet } from '#/features/leagues/components/SessionRecordScoreSheet';
import type { TournamentEditData } from '#/features/tournaments';
import type { LeagueEditData } from '#/features/leagues';
// Facilities components
import { ExternalBookingActionSheet } from '#/features/facilities/components/ExternalBookingSheet';
import { CourtBookingActionSheet } from '#/features/facilities/components/CourtBookingSheet';
import { BookingConfirmationActionSheet } from '#/features/facilities/components/BookingConfirmationSheet';
import { MatchBookingConfirmationActionSheet } from '#/features/matches/components/MatchBookingConfirmationSheet';
import { ReportFacilityActionSheet } from '#/features/facilities/components/ReportFacilitySheet';
// Booking components
import { BookingDetailActionSheet } from '#/features/bookings/components/BookingDetailSheet';
// Shared components
import { ImagePickerActionSheet } from '#/components/ImagePickerSheet';
import { ImageCropperSheet } from '#/components/ImageCropperSheet';
import { PlayerInviteActionSheet } from '#/components/PlayerInviteSheet';
import { InviteToMatchActionSheet } from '#/components/InviteToMatchSheet';
// Sport profile components
import { PeerRatingRequestActionSheet } from '#/features/sport-profile/components/PeerRatingRequestOverlay';
import { SportSetupWizardActionSheet } from '#/features/sport-profile/components/SportSetupWizardSheet';
import { FavoriteFacilitiesActionSheet } from '#/features/sport-profile/components/FavoriteFacilitiesSheet';
// Chat components
import { MessageActionsActionSheet } from '#/features/chat/components/MessageActionsSheet';
import { ConversationActionsActionSheet } from '#/features/chat/components/ConversationActionsSheet';
import { EditMessageActionSheet } from '#/features/chat/components/EditMessageModal';
import { ReportUserActionSheet } from '#/features/chat/components/ReportUserModal';
import { ChatAgreementActionSheet } from '#/features/chat/components/ChatAgreementModal';
import { AddMembersToChatActionSheet } from '#/features/chat/components/AddMembersToChatModal';
import { CreateGroupChatActionSheet } from '#/features/chat/components/CreateGroupChatModal';
import { MatchOrganizerSetupActionSheet } from '#/features/chat/components/MatchOrganizerSetupSheet';
// Onboarding/Profile components
import { PersonalInformationActionSheet } from '#/features/onboarding/components/overlays/PersonalInformationOverlay';
import { PlayerInformationActionSheet } from '#/features/onboarding/components/overlays/PlayerInformationOverlay';
import { LocationActionSheet } from '#/features/onboarding/components/overlays/LocationOverlay';
import { PlayerAvailabilitiesActionSheet } from '#/features/onboarding/components/overlays/PlayerAvailabilitiesOverlay';
import { TennisRatingActionSheet } from '#/features/onboarding/components/overlays/TennisRatingOverlay';
import { PickleballRatingActionSheet } from '#/features/onboarding/components/overlays/PickleballRatingOverlay';
import { ReferenceRequestActionSheet } from '#/features/sport-profile/components/ReferenceRequestOverlay';
import { TennisPreferencesActionSheet } from '#/features/sport-profile/components/TennisPreferencesOverlay';
import { PickleballPreferencesActionSheet } from '#/features/sport-profile/components/PickleballPreferencesOverlay';
// Reference response
import { RespondToReferenceActionSheet } from '#/features/ratings/components/RespondToReferenceOverlay';
import { ReferencesListActionSheet } from '#/features/ratings/components/ReferencesListSheet';
// Rating proof components
import { AddRatingProofActionSheet } from '#/features/ratings/components/AddRatingProofOverlay';
import { ExternalLinkProofActionSheet } from '#/features/ratings/components/ExternalLinkProofOverlay';
import { ImageProofActionSheet } from '#/features/ratings/components/ImageProofOverlay';
import { VideoProofActionSheet } from '#/features/ratings/components/VideoProofOverlay';
import { DocumentProofActionSheet } from '#/features/ratings/components/DocumentProofOverlay';
import { EditProofActionSheet } from '#/features/ratings/components/EditProofOverlay';
import { ReportProofActionSheet } from '#/features/ratings/components/ReportProofSheet';
// Referral
import { ReferralInviteActionSheet } from '#/components/ReferralInviteSheet';
// Gorhom-migrated sheets
import { FeedbackActionSheet } from '#/components/FeedbackSheet';
import { MatchDetailSheet as MatchDetailActionSheet } from '#/components/MatchDetailSheet';
import { ActionsBottomSheet as ActionsActionSheet } from '#/components/ActionsBottomSheet';
// Explainer sheets
import {
  RatingExplainerActionSheet,
  ReputationExplainerActionSheet,
  CovetedPlayerExplainerActionSheet,
  FoundingMemberExplainerActionSheet,
  CircuitRankingExplainerActionSheet,
} from '#/components/explainers';
// Summer League announcement
import { Serie1AnnouncementActionSheet } from '#/features/tournaments/announcement/Serie1AnnouncementSheet';
// Availability grid payload type. Flat `Set<string>` of `${day}-${hour}`
// cell keys from the hourly 7×17 grid (hours 6..22). Defined inline to keep
// this declaration free of feature-folder imports.
type HourGrid = ReadonlySet<string>;

// We extend some of the types here to give us great intellisense
// across the app for all registered sheets.
declare module 'react-native-actions-sheet' {
  interface Sheets {
    'feedback-report': SheetDefinition<{
      payload: {
        trigger?: import('./BugReportSheetContext').FeedbackReportTrigger | null;
        initialView?: import('./BugReportSheetContext').FeedbackReportInitialView;
        initialCategory?: import('./BugReportSheetContext').FeedbackReportInitialCategory;
      };
    }>;
    'create-community': SheetDefinition<{
      payload: {
        playerId: string;
      };
    }>;
    'create-list': SheetDefinition<{
      payload: {
        editingList?: SharedContactList | null;
      };
    }>;
    'share-match': SheetDefinition<{
      payload: {
        playerId: string;
      };
    }>;
    'add-contact': SheetDefinition<{
      payload: {
        listId: string;
        editingContact?: SharedContact | null;
      };
    }>;
    'import-contacts': SheetDefinition<{
      payload: {
        listId: string;
        existingContacts: SharedContact[];
      };
    }>;
    'create-group': SheetDefinition<{
      payload: {
        playerId: string;
      };
    }>;
    // Chat sheets
    'message-actions': SheetDefinition<{
      payload: {
        message: MessageWithSender | null;
        isOwnMessage: boolean;
        messageY?: number;
        onReply?: () => void;
        onEdit?: () => void;
        onDelete?: () => void;
        onReact?: (emoji: string) => void;
      };
    }>;
    'conversation-actions': SheetDefinition<{
      payload: {
        conversation: ConversationPreview | null;
        onTogglePin?: () => void;
        onToggleMute?: () => void;
        onToggleArchive?: () => void;
        onLeave?: () => void;
      };
    }>;
    'edit-message': SheetDefinition<{
      payload: {
        message: MessageWithSender | null;
        onSave?: (newContent: string) => void;
        isSaving?: boolean;
      };
    }>;
    'report-user': SheetDefinition<{
      payload: {
        reporterId: string;
        reportedId: string;
        reportedName: string;
        conversationId?: string;
      };
    }>;
    'chat-agreement': SheetDefinition<{
      payload: {
        onAgree?: () => void;
        onDecline?: () => void;
      };
    }>;
    'add-members-to-chat': SheetDefinition<{
      payload: {
        existingMemberIds: string[];
        currentUserId?: string;
        onMembersSelected?: (memberIds: string[]) => void;
      };
    }>;
    'create-group-chat': SheetDefinition<{
      payload: {
        onSuccess?: (conversationId: string) => void;
      };
    }>;
    'match-organizer-setup': SheetDefinition<{
      payload: {
        conversationId: string;
        organizerId: string;
        participantIds: string[];
        defaultSportId?: string | null;
        /** Round chat's tournament_match_id — forces the flow onto the tournament sport. */
        tournamentMatchId?: string | null;
        /** Pairing chat's session_match_id — forces the flow onto the league sport. */
        sessionMatchId?: string | null;
        /** Analytics context, threaded from the chat for card_posted props. */
        conversationType?: string;
        isRoundChat?: boolean;
      };
    }>;
    // Group sheets
    'group-options': SheetDefinition<{
      payload: {
        options: Array<{
          id: string;
          label: string;
          icon: string;
          onPress: () => void;
          destructive?: boolean;
        }>;
        title?: string;
      };
    }>;
    'member-options': SheetDefinition<{
      payload: {
        member: {
          name: string;
          role: 'member' | 'moderator';
          isCreator: boolean;
          profilePictureUrl?: string | null;
          playerId?: string;
        } | null;
        options: Array<{
          id: string;
          label: string;
          icon: string;
          onPress: () => void;
          destructive?: boolean;
        }>;
        onAvatarPress?: (playerId: string) => void;
      };
    }>;
    'invite-link': SheetDefinition<{
      payload: {
        groupId: string;
        groupName: string;
        currentUserId: string;
        isModerator: boolean;
        type?: 'group' | 'community';
      };
    }>;
    'recent-games': SheetDefinition<{
      payload: {
        matches: unknown[];
        onMatchPress?: (match: unknown) => void;
        onPlayerPress?: (playerId: string) => void;
      };
    }>;
    'leaderboard-comparison': SheetDefinition<{
      payload: {
        pulse: unknown;
        callerId: string | undefined;
        peerId: string;
        onChallenge?: (peerId: string) => void;
        onPlayerPress?: (playerId: string) => void;
      };
    }>;
    'add-group-member': SheetDefinition<{
      payload: {
        groupId: string;
        currentMemberIds: string[];
        onSuccess?: () => void;
      };
    }>;
    'member-list': SheetDefinition<{
      payload: {
        group: unknown;
        currentUserId: string;
        isModerator: boolean;
        type?: 'group' | 'community';
        onMemberRemoved?: () => void;
        onPlayerPress?: (playerId: string) => void;
      };
    }>;
    'edit-group': SheetDefinition<{
      payload: {
        group: unknown;
        onSuccess?: () => void;
      };
    }>;
    'add-community-member': SheetDefinition<{
      payload: {
        communityId: string;
        currentMemberIds: string[];
        onSuccess?: () => void;
      };
    }>;
    'edit-community': SheetDefinition<{
      payload: {
        community: unknown;
        onSuccess?: () => void;
      };
    }>;
    'pending-requests': SheetDefinition<{
      payload: {
        communityId: string;
        sportId?: string;
        onMemberChanged?: () => void;
        onNavigateToPlayer?: (playerId: string) => void;
      };
    }>;
    'match-type': SheetDefinition<{
      payload: {
        onSelect?: (type: 'single' | 'double') => void;
      };
    }>;
    'share-to-facebook': SheetDefinition<{
      payload: {
        matchId: string;
      };
    }>;
    'score-confirmation': SheetDefinition<{
      payload: {
        confirmation: unknown;
        playerId: string;
      };
    }>;
    'register-match-score': SheetDefinition<{
      payload: {
        match: import('@rallia/shared-types').MatchWithDetails;
        onSuccess?: () => void;
        onDismiss?: () => void;
        isRebuttal?: boolean;
        matchResultId?: string;
      };
    }>;
    'tournament-record-score': SheetDefinition<{
      payload: {
        tournamentMatchId: string;
        tournamentId: string;
        player1RegId: string;
        player2RegId: string;
        player1Name: string;
        player2Name: string;
        isPickleball: boolean;
        matchFormat?: import('@rallia/shared-types').Enums<'match_format'>;
        pointsPerGame?: number | null;
        // The final decides the champion and releases ranking points, so the
        // sheet asks for confirmation before submitting.
        isFinal?: boolean;
        onSuccess?: () => void;
        onDismiss?: () => void;
      };
    }>;
    'tournament-link-match': SheetDefinition<{
      payload: {
        tournamentMatchId: string;
        tournamentId: string;
        sportId: string;
        entryFormat: import('@rallia/shared-types').Enums<'entry_format'>;
        team1UserIds: string[];
        team2UserIds: string[];
        onSuccess?: () => void;
        onDismiss?: () => void;
      };
    }>;
    'session-swap-player': SheetDefinition<{
      payload: {
        sessionId: string;
        /** The player leaving their pairing. */
        userOut: string;
        userOutName: string;
        /** Guards the swap against a stale copy of the sheet. */
        sessionVersion: number;
      };
    }>;
    'session-link-match': SheetDefinition<{
      payload: {
        sessionMatchId: string;
        sessionId: string;
        seasonId: string;
        sportId: string;
        entryFormat: import('@rallia/shared-types').Enums<'entry_format'>;
        team1UserIds: string[];
        team2UserIds: string[];
        onSuccess?: () => void;
        onDismiss?: () => void;
      };
    }>;
    'session-record-score': SheetDefinition<{
      payload: {
        sessionMatchId: string;
        sessionId: string;
        seasonId: string;
        versionWas: number;
        teamAName: string;
        teamBName: string;
        isPickleball: boolean;
        matchFormat?: import('@rallia/shared-types').Enums<'match_format'> | null;
        pointsPerGame?: number | null;
        isEdit?: boolean;
        // True when this result leaves no playable match behind, so it closes
        // the session: the sheet confirms before writing it.
        isDecider?: boolean;
        onSuccess?: () => void;
        onDismiss?: () => void;
      };
    }>;
    'tournament-partner-picker': SheetDefinition<{
      payload: {
        sportId: string;
        onPick: (player: { id: string; name: string }) => void;
        onDismiss?: () => void;
      };
    }>;
    'tournament-edit': SheetDefinition<{
      payload: {
        tournament: TournamentEditData;
      };
    }>;
    'league-edit': SheetDefinition<{
      payload: {
        league: LeagueEditData;
      };
    }>;
    'league-create': SheetDefinition<{
      payload: {
        onCreated?: (leagueId: string) => void;
      };
    }>;
    'tournament-invite': SheetDefinition<{
      payload: {
        tournamentId: string;
        tournamentName: string;
      };
    }>;
    'tournament-invite-players': SheetDefinition<{
      payload: {
        tournamentId: string;
        tournamentName: string;
        sportId: string;
        excludeUserIds: string[];
      };
    }>;
    'tournament-co-organizers': SheetDefinition<{
      payload: {
        tournamentId: string;
        sportId: string;
        organizerId: string;
      };
    }>;
    'league-invite': SheetDefinition<{
      payload: {
        leagueId: string;
        leagueName: string;
        /** Present when sharing a specific session — the link carries it. */
        sessionId?: string;
        /** Human-readable session date/name for the share message. */
        sessionLabel?: string;
      };
    }>;
    'league-invite-players': SheetDefinition<{
      payload: {
        leagueId: string;
        leagueName: string;
        sportId: string;
        excludeUserIds: string[];
      };
    }>;
    'create-season': SheetDefinition<{
      payload: {
        leagueId: string;
      };
    }>;
    'create-session': SheetDefinition<{
      payload: {
        seasonId: string;
        leagueId: string;
        /** The season's gamesPerPlayer rule, so the form opens on it. */
        defaultRounds?: number;
      };
    }>;
    'court-selection': SheetDefinition<{
      payload: {
        courts: unknown[];
        timeLabel: string;
        onSelect?: (court: unknown) => void;
        onCancel?: () => void;
      };
    }>;
    'report-issue': SheetDefinition<{
      payload: {
        opponentName: string;
        onSubmit?: (
          reason: import('@rallia/shared-types').MatchReportReasonEnum,
          details?: string
        ) => void;
        isSubmitting?: boolean;
      };
    }>;
    'external-booking': SheetDefinition<{
      payload: {
        facility: unknown;
        slot: unknown;
        /** Match to relink the booking to (skips the create-game prompt on return). */
        matchId?: string;
        /** Originating surface, for booking analytics. Defaults to external_sheet. */
        source?:
          | 'facility_directory'
          | 'facility_card'
          | 'match_courts'
          | 'map'
          | 'external_sheet'
          | 'home_favorite_availability';
      };
    }>;
    'booking-confirmation': SheetDefinition<{
      payload: {
        facilityName: string;
        slotTime?: string;
        slotDate?: string;
        onConfirm?: () => void;
        onDecline?: () => void;
      };
    }>;
    'match-booking-confirmation': SheetDefinition<{
      payload: {
        facilityName: string;
        courtLabel?: string;
        dateLabel?: string;
        timeLabel?: string;
        priceLabel?: string;
        /** True when confirming moves the match to a different facility (nearby booking). */
        isRelocation?: boolean;
        onConfirm?: () => void | Promise<void>;
        onDecline?: () => void;
        /** Always called when the sheet closes (incl. swipe / backdrop) so the
         *  provider can reset its pending-booking state. */
        onDismiss?: () => void;
      };
    }>;
    'court-booking': SheetDefinition<{
      payload: {
        facility: unknown;
        slot: unknown;
        courts: unknown[];
        /** Callback when booking is successfully completed (e.g. from wizard WhereStep) */
        onSuccess?: (data: {
          facilityId: string;
          courtId: string;
          courtNumber: number | null;
        }) => void;
        /** Callback when user taps "Create game" from success step (e.g. from facility screen) */
        onCreateGameFromBooking?: (data: {
          facility: unknown;
          slot: unknown;
          facilityId: string;
          courtId: string;
          courtNumber: number | null;
        }) => void;
      };
    }>;
    'report-facility': SheetDefinition<{
      payload: {
        reporterId: string;
        facilityId: string;
        facilityName: string;
      };
    }>;
    'image-picker': SheetDefinition<{
      payload: {
        onTakePhoto?: () => void;
        onChooseFromGallery?: () => void;
        title?: string;
        cameraLabel?: string;
        galleryLabel?: string;
        cameraDisabled?: boolean;
        galleryDisabled?: boolean;
      };
    }>;
    'image-cropper': SheetDefinition<{
      payload: {
        imageUri: string;
        aspectRatio?: [number, number];
        onConfirm: (uri: string) => void;
        onCancel?: () => void;
        title?: string;
      };
    }>;
    'player-invite': SheetDefinition<{
      payload: {
        matchId: string;
        sportId: string;
        hostId: string;
        excludePlayerIds: string[];
      };
    }>;
    'invite-to-match': SheetDefinition<{
      payload: {
        playerId: string;
        playerName: string;
      };
    }>;
    // Sport profile sheets
    'peer-rating-request': SheetDefinition<{
      payload: {
        currentUserId: string;
        sportId: string;
        onSendRequests?: (selectedPlayerIds: string[]) => Promise<void>;
      };
    }>;
    // Profile/Onboarding sheets
    'personal-information': SheetDefinition<{
      payload: {
        mode?: 'onboarding' | 'edit';
        initialData?: {
          firstName?: string;
          lastName?: string;
          email?: string;
          dateOfBirth?: string;
          gender?: string;
          phoneNumber?: string;
          phoneVerified?: boolean;
          profilePictureUrl?: string;
        };
        onSave?: () => void;
        onContinue?: () => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
      };
    }>;
    'player-information': SheetDefinition<{
      payload: {
        initialData?: {
          bio?: string;
          preferredPlayingHand?: string;
          maximumTravelDistance?: number;
        };
        onSave?: () => void;
      };
    }>;
    'player-location': SheetDefinition<{
      payload: {
        initialData?: {
          postalCode?: string;
          address?: string;
          city?: string;
          province?: string;
          latitude?: number | null;
          longitude?: number | null;
        };
        onSave?: () => void;
      };
    }>;
    'player-availabilities': SheetDefinition<{
      payload: {
        mode?: 'onboarding' | 'edit';
        initialData?: HourGrid;
        /**
         * Most-recent last_confirmed_at across the player's availability rows
         * (ISO 8601 string). When older than ~14 days or NULL, the overlay
         * renders a "confirm your week" staleness banner. Edit-mode only.
         */
        initialLastConfirmedAt?: string | null;
        onSave?: (availabilities: HourGrid) => void;
        onContinue?: (availabilities: HourGrid) => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
        selectedSportIds?: string[];
        /**
         * Pairing context. When present the grid renders these players' shared
         * free hours underneath the player's own selection, so mutual slots are
         * visible while painting, and the sheet persists the save itself (no
         * `onSave` needed) then regenerates the round chat's suggestion card.
         * Opened from a tournament round chat / league pairing.
         */
        opponentIds?: string[];
        /** First name(s) for the overlay legend, e.g. "Marc". */
        opponentName?: string | null;
        /** Bracket pairing whose organizer card should regenerate after save. */
        tournamentMatchId?: string | null;
      };
    }>;
    'tennis-rating': SheetDefinition<{
      payload: {
        mode?: 'onboarding' | 'edit';
        initialRating?: string;
        onSave?: (ratingId: string) => void;
        onDismiss?: () => void;
        onContinue?: (rating: string) => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
        stepName?: string;
      };
    }>;
    'pickleball-rating': SheetDefinition<{
      payload: {
        mode?: 'onboarding' | 'edit';
        initialRating?: string;
        onSave?: (ratingId: string) => void;
        onDismiss?: () => void;
        onContinue?: (rating: string) => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
        stepName?: string;
      };
    }>;
    'respond-to-reference': SheetDefinition<{
      payload: {
        request: {
          id: string;
          requester_id: string;
          player_rating_score_id: string;
          message: string | null;
          status: 'pending' | 'completed' | 'declined' | 'expired' | 'cancelled';
          expires_at: string;
          created_at: string;
          requester: {
            id: string;
            first_name: string;
            last_name: string;
            display_name: string | null;
            profile_picture_url: string | null;
          };
          rating_info: {
            label: string;
            value: number | null;
            sport_name: string;
            sport_display_name: string;
          };
        };
        onResponseComplete?: () => void;
      };
    }>;
    'reference-request': SheetDefinition<{
      payload: {
        currentUserId: string;
        sportId: string;
        currentUserRatingScore?: number;
        currentUserRatingScoreId?: string;
        ratingSystemCode?: string;
        onSendRequests?: (selectedPlayerIds: string[]) => Promise<void>;
      };
    }>;
    'references-list': SheetDefinition<{
      payload: {
        playerRatingScoreId: string;
        sportId?: string;
      };
    }>;
    'tennis-preferences': SheetDefinition<{
      payload: {
        onSave?: (preferences: {
          matchDuration?: string;
          matchType?: string;
          court?: string;
          playStyle?: string;
          playAttributes?: string[];
        }) => void;
        onDismiss?: () => void;
        requireAllFields?: boolean;
        initialPreferences?: {
          matchDuration?: string;
          matchType?: string;
          court?: string;
          playStyle?: string;
          playAttributes?: string[];
        };
        playStyleOptions?: Array<{ id: string; name: string; description: string | null }>;
        playAttributesByCategory?: {
          [category: string]: Array<{
            id: string;
            name: string;
            description: string | null;
            category: string | null;
          }>;
        };
        loadingPlayOptions?: boolean;
        currentStep?: number;
        totalSteps?: number;
        stepName?: string;
      };
    }>;
    'pickleball-preferences': SheetDefinition<{
      payload: {
        onSave?: (preferences: {
          matchDuration?: string;
          matchType?: string;
          court?: string;
          playStyle?: string;
          playAttributes?: string[];
        }) => void;
        onDismiss?: () => void;
        requireAllFields?: boolean;
        initialPreferences?: {
          matchDuration?: string;
          matchType?: string;
          court?: string;
          playStyle?: string;
          playAttributes?: string[];
        };
        playStyleOptions?: Array<{ id: string; name: string; description: string | null }>;
        playAttributesByCategory?: {
          [category: string]: Array<{
            id: string;
            name: string;
            description: string | null;
            category: string | null;
          }>;
        };
        loadingPlayOptions?: boolean;
        currentStep?: number;
        totalSteps?: number;
        stepName?: string;
      };
    }>;
    // Favorite facilities editor
    'favorite-facilities': SheetDefinition<{
      payload: {
        playerId?: string;
        sportId: string;
        latitude: number | null;
        longitude: number | null;
        /**
         * Pre-seeded favorites with id + display name. The sheet uses these
         * directly so far-away favorites that aren't in the first paginated
         * page of search results still render as selected.
         */
        initialFavorites: { id: string; name: string }[];
        minFavorites?: number;
        onSave?: (facilityIds: string[]) => void;
        onDismiss?: () => void;
      };
    }>;
    // Sport setup wizard
    'sport-setup-wizard': SheetDefinition<{
      payload: {
        sportName: 'tennis' | 'pickleball';
        sportId: string;
        playerSportId: string;
        userId: string;
        latitude: number | null;
        longitude: number | null;
        onComplete?: () => void;
        onCancel?: () => void;
      };
    }>;
    // Rating proof sheets
    'add-rating-proof': SheetDefinition<{
      payload: {
        playerRatingScoreId: string;
        onSuccess?: () => void;
      };
    }>;
    'external-link-proof': SheetDefinition<{
      payload: {
        onSuccess?: () => void;
        playerRatingScoreId: string;
      };
    }>;
    'image-proof': SheetDefinition<{
      payload: {
        onSuccess?: () => void;
        playerRatingScoreId: string;
      };
    }>;
    'video-proof': SheetDefinition<{
      payload: {
        onSuccess?: () => void;
        playerRatingScoreId: string;
      };
    }>;
    'document-proof': SheetDefinition<{
      payload: {
        onSuccess?: () => void;
        playerRatingScoreId: string;
      };
    }>;
    'edit-proof': SheetDefinition<{
      payload: {
        proof: import('@rallia/shared-types').RatingProofWithFile;
        onSuccess?: () => void;
      };
    }>;
    'booking-detail': SheetDefinition<{
      payload: {
        booking: import('@rallia/shared-services').BookingWithDetails;
      };
    }>;
    'referral-invite': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    'rating-explainer': SheetDefinition<{
      payload: {
        sportName: 'tennis' | 'pickleball';
      };
    }>;
    'reputation-explainer': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    'coveted-player-explainer': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    'founding-member-explainer': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    'circuit-ranking-explainer': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    'match-suggestions': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    'match-invite-confirm': SheetDefinition<{
      payload: {
        opponentId: string;
        facilityId: string;
        sportId: string;
        matchDate: string;
        startTime: string;
        endTime: string;
      };
    }>;
    'suggest-match-time': SheetDefinition<{
      payload: {
        matchId: string;
        matchDate: string;
        matchTimezone: string;
        currentStartTime: string; // HH:MM or HH:MM:SS in match.timezone
        currentEndTime: string;
        /** Set when the caller already has a pending suggestion (edit mode). */
        existingSuggestionId?: string;
        existingSuggestionTime?: string;
        existingNote?: string;
      };
    }>;
    'report-proof': SheetDefinition<{
      payload: {
        reporterId: string;
        proofId: string;
        proofTitle: string;
      };
    }>;
    'serie1-announcement': SheetDefinition<{
      payload?: Record<string, never>;
    }>;
    feedback: SheetDefinition;
    'match-detail': SheetDefinition;
    'main-actions': SheetDefinition;
  }
}

export const Sheets = () => {
  return (
    <SheetRegister
      sheets={{
        'feedback-report': FeedbackReportActionSheet,
        'create-community': CreateCommunityActionSheet,
        'create-list': CreateListActionSheet,
        'share-match': ShareMatchActionSheet,
        'add-contact': AddContactActionSheet,
        'import-contacts': ImportContactsActionSheet,
        'create-group': CreateGroupActionSheet,
        // Chat sheets
        'message-actions': MessageActionsActionSheet,
        'conversation-actions': ConversationActionsActionSheet,
        'edit-message': EditMessageActionSheet,
        'report-user': ReportUserActionSheet,
        'chat-agreement': ChatAgreementActionSheet,
        'add-members-to-chat': AddMembersToChatActionSheet,
        'create-group-chat': CreateGroupChatActionSheet,
        'match-organizer-setup': MatchOrganizerSetupActionSheet,
        // Group sheets
        'group-options': GroupOptionsActionSheet,
        'member-options': MemberOptionsActionSheet,
        'invite-link': InviteLinkActionSheet,
        'recent-games': RecentGamesActionSheet,
        'leaderboard-comparison': ComparisonOverlay,
        'add-group-member': AddGroupMemberActionSheet,
        'member-list': MemberListActionSheet,
        'edit-group': EditGroupActionSheet,
        'add-community-member': AddCommunityMemberActionSheet,
        'edit-community': EditCommunityActionSheet,
        'pending-requests': PendingRequestsActionSheet,
        'match-type': MatchTypeActionSheet,
        'share-to-facebook': ShareToFacebookActionSheet,
        'score-confirmation': ScoreConfirmationActionSheet,
        'register-match-score': RegisterMatchScoreActionSheet,
        'tournament-record-score': TournamentRecordScoreActionSheet,
        'tournament-link-match': TournamentLinkMatchActionSheet,
        'session-link-match': SessionLinkMatchActionSheet,
        'session-swap-player': SessionSwapPlayerActionSheet,
        'session-record-score': SessionRecordScoreActionSheet,
        'tournament-partner-picker': TournamentPartnerPickerActionSheet,
        'tournament-edit': TournamentEditActionSheet,
        'tournament-invite': TournamentInviteSheet,
        'tournament-invite-players': TournamentInvitePlayersActionSheet,
        'tournament-co-organizers': TournamentCoOrganizerActionSheet,
        'league-invite': LeagueInviteSheet,
        'league-invite-players': LeagueInvitePlayersActionSheet,
        'league-edit': LeagueEditActionSheet,
        'league-create': LeagueCreateActionSheet,
        'create-season': CreateSeasonActionSheet,
        'create-session': CreateSessionActionSheet,
        'court-selection': CourtSelectionActionSheet,
        'report-issue': ReportIssueActionSheet,
        'external-booking': ExternalBookingActionSheet,
        'booking-confirmation': BookingConfirmationActionSheet,
        'match-booking-confirmation': MatchBookingConfirmationActionSheet,
        'court-booking': CourtBookingActionSheet,
        'report-facility': ReportFacilityActionSheet,
        'image-picker': ImagePickerActionSheet,
        'image-cropper': ImageCropperSheet,
        'player-invite': PlayerInviteActionSheet,
        'invite-to-match': InviteToMatchActionSheet,
        // Sport profile sheets
        'peer-rating-request': PeerRatingRequestActionSheet,
        'sport-setup-wizard': SportSetupWizardActionSheet,
        'favorite-facilities': FavoriteFacilitiesActionSheet,
        // Profile/Onboarding sheets
        'personal-information': PersonalInformationActionSheet,
        'player-information': PlayerInformationActionSheet,
        'player-location': LocationActionSheet,
        'player-availabilities': PlayerAvailabilitiesActionSheet,
        'tennis-rating': TennisRatingActionSheet,
        'pickleball-rating': PickleballRatingActionSheet,
        'respond-to-reference': RespondToReferenceActionSheet,
        'reference-request': ReferenceRequestActionSheet,
        'references-list': ReferencesListActionSheet,
        'tennis-preferences': TennisPreferencesActionSheet,
        'pickleball-preferences': PickleballPreferencesActionSheet,
        // Rating proof sheets
        'add-rating-proof': AddRatingProofActionSheet,
        'external-link-proof': ExternalLinkProofActionSheet,
        'image-proof': ImageProofActionSheet,
        'video-proof': VideoProofActionSheet,
        'document-proof': DocumentProofActionSheet,
        'edit-proof': EditProofActionSheet,
        // Booking sheets
        'booking-detail': BookingDetailActionSheet,
        // Referral sheets
        'referral-invite': ReferralInviteActionSheet,
        // Migrated from gorhom
        feedback: FeedbackActionSheet,
        'match-detail': MatchDetailActionSheet,
        'main-actions': ActionsActionSheet,
        // Report proof sheet
        'report-proof': ReportProofActionSheet,
        // Explainer sheets
        'rating-explainer': RatingExplainerActionSheet,
        'reputation-explainer': ReputationExplainerActionSheet,
        'coveted-player-explainer': CovetedPlayerExplainerActionSheet,
        'founding-member-explainer': FoundingMemberExplainerActionSheet,
        'circuit-ranking-explainer': CircuitRankingExplainerActionSheet,
        'match-suggestions': MatchSuggestionsActionSheet,
        'match-invite-confirm': MatchInviteConfirmActionSheet,
        'suggest-match-time': SuggestMatchTimeActionSheet,
        // Série 1 tournaments announcement
        'serie1-announcement': Serie1AnnouncementActionSheet,
      }}
    />
  );
};
