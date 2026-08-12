/**
 * Participants pane: the registered roster, plus the organizer's queues for
 * approval requests and outstanding invites.
 */

import React from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { PlayerSearchResult, Tournament } from '@rallia/shared-services';

import type { TranslationKey } from '../../../hooks';
import UnderlineTabBar, { type UnderlineTabItem } from '../../../components/UnderlineTabBar';
import {
  InvitedSection,
  ParticipantsSection,
  PendingRequestsSection,
  type PendingRequestRow,
  type PlayersSegment,
  type ScreenColors,
} from './components';
import { styles } from './detailStyles';

interface PlayersTabProps {
  tournament: Tournament;
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  userId: string | undefined;
  formatDate: (iso: string) => string;
  playersSegmentTabs: UnderlineTabItem<PlayersSegment>[];
  activePlayersSegment: PlayersSegment;
  registeredParticipantPlayers: PlayerSearchResult[];
  pendingRequestRows: PendingRequestRow[];
  invitedPendingRows: PendingRequestRow[];
  /** Organizer capability flags for the current lifecycle stage. */
  adminActions: { canInvite: boolean };
  canRemoveRegistrants: boolean;
  canForfeitRegistrants: boolean;
  setPlayersSegment: (segment: PlayersSegment) => void;
  handlePlayerPress: (player: PlayerSearchResult) => void;
  handleInvitePlayers: () => void;
  handleApprovePress: (registrationId: string, version: number) => void;
  handleRemovePress: (player: PlayerSearchResult) => void;
  handleRevokeInvite: (row: PendingRequestRow) => void;
}

export const PlayersTab: React.FC<PlayersTabProps> = ({
  tournament,
  colors,
  t,
  userId,
  formatDate,
  playersSegmentTabs,
  activePlayersSegment,
  registeredParticipantPlayers,
  pendingRequestRows,
  invitedPendingRows,
  adminActions,
  canRemoveRegistrants,
  canForfeitRegistrants,
  setPlayersSegment,
  handlePlayerPress,
  handleInvitePlayers,
  handleApprovePress,
  handleRemovePress,
  handleRevokeInvite,
}) => (
  <View style={styles.playersTabContent}>
    {adminActions.canInvite && (
      <Pressable
        onPress={handleInvitePlayers}
        style={({ pressed }) => [
          styles.playersInviteBtn,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
        testID="players-invite-cta"
      >
        <Ionicons name="share-social-outline" size={18} color="#ffffff" />
        <Text size="sm" weight="semibold" color="#ffffff">
          {t('tournamentDetail.actions.invitePlayers')}
        </Text>
      </Pressable>
    )}
    {playersSegmentTabs.length > 1 && (
      <UnderlineTabBar
        tabs={playersSegmentTabs}
        activeKey={activePlayersSegment}
        onChange={setPlayersSegment}
        style={styles.segmentBar}
      />
    )}
    {activePlayersSegment === 'requests' ? (
      <PendingRequestsSection
        rows={pendingRequestRows}
        onPlayerPress={handlePlayerPress}
        onApprove={handleApprovePress}
        onDecline={handleRemovePress}
        colors={colors}
        t={t}
      />
    ) : activePlayersSegment === 'invited' ? (
      <InvitedSection
        rows={invitedPendingRows}
        onPlayerPress={handlePlayerPress}
        onRevoke={handleRevokeInvite}
        colors={colors}
        t={t}
      />
    ) : (
      <ParticipantsSection
        players={registeredParticipantPlayers}
        onPlayerPress={handlePlayerPress}
        onRemovePress={
          canRemoveRegistrants || canForfeitRegistrants ? handleRemovePress : undefined
        }
        currentUserId={userId}
        maxParticipants={tournament.max_participants}
        deadlineLabel={
          tournament.registration_closes_at && tournament.status === 'registration_open'
            ? formatDate(tournament.registration_closes_at)
            : null
        }
        colors={colors}
        t={t}
      />
    )}
  </View>
);

export default PlayersTab;
