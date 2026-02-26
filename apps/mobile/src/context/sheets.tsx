import { SheetRegister, SheetDefinition } from 'react-native-actions-sheet';
import { CreateCommunityActionSheet } from '../features/communities/components/CreateCommunityModal';
import { CreateListActionSheet } from '../features/shared-lists/components/CreateListModal';
import { ShareMatchActionSheet } from '../features/shared-lists/components/ShareMatchModal';
import { AddContactActionSheet } from '../features/shared-lists/components/AddContactModal';
import { ImportContactsActionSheet } from '../features/shared-lists/components/ImportContactsModal';
import { CreateGroupActionSheet } from '../features/groups/components/CreateGroupModal';
import { GroupOptionsActionSheet } from '../features/groups/components/GroupOptionsModal';
import { MemberOptionsActionSheet } from '../features/groups/components/MemberOptionsModal';
import { InviteLinkActionSheet } from '../features/groups/components/InviteLinkModal';
import { RecentGamesActionSheet } from '../features/groups/components/RecentGamesModal';
import { AddMemberActionSheet } from '../features/groups/components/AddMemberModal';
import { MemberListActionSheet } from '../features/groups/components/MemberListModal';
import { EditGroupActionSheet } from '../features/groups/components/EditGroupModal';
// Community components
import { AddCommunityMemberActionSheet } from '../features/communities/components/AddCommunityMemberModal';
import { EditCommunityActionSheet } from '../features/communities/components/EditCommunityModal';
// Matches components
import { MatchTypeActionSheet } from '../features/matches/components/MatchTypeModal';
import { ScoreConfirmationActionSheet } from '../features/matches/components/ScoreConfirmationModal';
import { RegisterMatchScoreActionSheet } from '../features/matches/components/RegisterMatchScoreSheet';
import { CourtSelectionActionSheet } from '../features/matches/components/CourtSelectionSheet';
// Facilities components
import { ExternalBookingActionSheet } from '../features/facilities/components/ExternalBookingSheet';
import { CourtBookingActionSheet } from '../features/facilities/components/CourtBookingSheet';
// Booking components
import { BookingDetailActionSheet } from '../features/bookings/components/BookingDetailSheet';
// Shared components
import { ImagePickerActionSheet } from '../components/ImagePickerSheet';
import { PlayerInviteActionSheet } from '../components/PlayerInviteSheet';
// Sport profile components
import { PeerRatingRequestActionSheet } from '../features/sport-profile/components/PeerRatingRequestOverlay';
// Chat components
import { MessageActionsActionSheet } from '../features/chat/components/MessageActionsSheet';
import { ConversationActionsActionSheet } from '../features/chat/components/ConversationActionsSheet';
import { EditMessageActionSheet } from '../features/chat/components/EditMessageModal';
import { ReportUserActionSheet } from '../features/chat/components/ReportUserModal';
import { ChatAgreementActionSheet } from '../features/chat/components/ChatAgreementModal';
import { AddMembersToGroupActionSheet } from '../features/chat/components/AddMembersToGroupModal';
import { CreateGroupChatActionSheet } from '../features/chat/components/CreateGroupChatModal';
// Onboarding/Profile components
import { PersonalInformationActionSheet } from '../features/onboarding/components/overlays/PersonalInformationOverlay';
import { PlayerInformationActionSheet } from '../features/onboarding/components/overlays/PlayerInformationOverlay';
import { LocationActionSheet } from '../features/onboarding/components/overlays/LocationOverlay';
import { PlayerAvailabilitiesActionSheet } from '../features/onboarding/components/overlays/PlayerAvailabilitiesOverlay';
import { TennisRatingActionSheet } from '../features/onboarding/components/overlays/TennisRatingOverlay';
import { PickleballRatingActionSheet } from '../features/onboarding/components/overlays/PickleballRatingOverlay';
import { ReferenceRequestActionSheet } from '../features/sport-profile/components/ReferenceRequestOverlay';
import { TennisPreferencesActionSheet } from '../features/sport-profile/components/TennisPreferencesOverlay';
import { PickleballPreferencesActionSheet } from '../features/sport-profile/components/PickleballPreferencesOverlay';
// Rating proof components
import { AddRatingProofActionSheet } from '../features/ratings/components/AddRatingProofOverlay';
import { ExternalLinkProofActionSheet } from '../features/ratings/components/ExternalLinkProofOverlay';
import { ImageProofActionSheet } from '../features/ratings/components/ImageProofOverlay';
import { VideoProofActionSheet } from '../features/ratings/components/VideoProofOverlay';
import { DocumentProofActionSheet } from '../features/ratings/components/DocumentProofOverlay';

import type {
  SharedContactList,
  SharedContact,
  MessageWithSender,
  ConversationPreview,
} from '@rallia/shared-services';

// Define WeeklyAvailability inline to avoid circular dependencies
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
interface DayAvailability {
  AM: boolean;
  PM: boolean;
  EVE: boolean;
}
type WeeklyAvailability = Record<DayOfWeek, DayAvailability>;

// We extend some of the types here to give us great intellisense
// across the app for all registered sheets.
declare module 'react-native-actions-sheet' {
  interface Sheets {
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
        chatName?: string;
        chatImageUrl?: string | null;
        isDirectChat?: boolean;
        onAgree?: () => void;
      };
    }>;
    'add-members-to-group': SheetDefinition<{
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
    'add-member': SheetDefinition<{
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
    'match-type': SheetDefinition<{
      payload: {
        onSelect?: (type: 'single' | 'double') => void;
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
    'external-booking': SheetDefinition<{
      payload: {
        facility: unknown;
        slot: unknown;
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
    'player-invite': SheetDefinition<{
      payload: {
        matchId: string;
        sportId: string;
        hostId: string;
        excludePlayerIds: string[];
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
          username?: string;
          email?: string;
          dateOfBirth?: string;
          gender?: string;
          phoneNumber?: string;
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
          username?: string;
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
        initialData?: WeeklyAvailability;
        onSave?: (availabilities: WeeklyAvailability) => void;
        onContinue?: (availabilities: WeeklyAvailability) => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
        selectedSportIds?: string[];
      };
    }>;
    'tennis-rating': SheetDefinition<{
      payload: {
        mode?: 'onboarding' | 'edit';
        initialRating?: string;
        onSave?: (ratingId: string) => void;
        onContinue?: (rating: string) => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
      };
    }>;
    'pickleball-rating': SheetDefinition<{
      payload: {
        mode?: 'onboarding' | 'edit';
        initialRating?: string;
        onSave?: (ratingId: string) => void;
        onContinue?: (rating: string) => void;
        onBack?: () => void;
        currentStep?: number;
        totalSteps?: number;
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
    'tennis-preferences': SheetDefinition<{
      payload: {
        onSave?: (preferences: {
          matchDuration?: string;
          matchType?: string;
          court?: string;
          playStyle?: string;
          playAttributes?: string[];
        }) => void;
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
        playerId?: string;
        sportId?: string;
        latitude?: number | null;
        longitude?: number | null;
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
        playerId?: string;
        sportId?: string;
        latitude?: number | null;
        longitude?: number | null;
      };
    }>;
    // Rating proof sheets
    'add-rating-proof': SheetDefinition<{
      payload: {
        onSelectProofType?: (type: 'external_link' | 'video' | 'image' | 'document') => void;
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
    'booking-detail': SheetDefinition<{
      payload: {
        booking: import('@rallia/shared-services').BookingWithDetails;
      };
    }>;
  }
}

export const Sheets = () => {
  return (
    <SheetRegister
      sheets={{
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
        'add-members-to-group': AddMembersToGroupActionSheet,
        'create-group-chat': CreateGroupChatActionSheet,
        // Group sheets
        'group-options': GroupOptionsActionSheet,
        'member-options': MemberOptionsActionSheet,
        'invite-link': InviteLinkActionSheet,
        'recent-games': RecentGamesActionSheet,
        'add-member': AddMemberActionSheet,
        'member-list': MemberListActionSheet,
        'edit-group': EditGroupActionSheet,
        'add-community-member': AddCommunityMemberActionSheet,
        'edit-community': EditCommunityActionSheet,
        'match-type': MatchTypeActionSheet,
        'score-confirmation': ScoreConfirmationActionSheet,
        'register-match-score': RegisterMatchScoreActionSheet,
        'court-selection': CourtSelectionActionSheet,
        'external-booking': ExternalBookingActionSheet,
        'court-booking': CourtBookingActionSheet,
        'image-picker': ImagePickerActionSheet,
        'player-invite': PlayerInviteActionSheet,
        // Sport profile sheets
        'peer-rating-request': PeerRatingRequestActionSheet,
        // Profile/Onboarding sheets
        'personal-information': PersonalInformationActionSheet,
        'player-information': PlayerInformationActionSheet,
        'player-location': LocationActionSheet,
        'player-availabilities': PlayerAvailabilitiesActionSheet,
        'tennis-rating': TennisRatingActionSheet,
        'pickleball-rating': PickleballRatingActionSheet,
        'reference-request': ReferenceRequestActionSheet,
        'tennis-preferences': TennisPreferencesActionSheet,
        'pickleball-preferences': PickleballPreferencesActionSheet,
        // Rating proof sheets
        'add-rating-proof': AddRatingProofActionSheet,
        'external-link-proof': ExternalLinkProofActionSheet,
        'image-proof': ImageProofActionSheet,
        'video-proof': VideoProofActionSheet,
        'document-proof': DocumentProofActionSheet,
        // Booking sheets
        'booking-detail': BookingDetailActionSheet,
      }}
    />
  );
};
