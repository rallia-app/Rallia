/**
 * Members pane: the active roster and the organizer's queues for approvals, invites and suspensions.
 */

import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { League, PlayerSearchResult } from '@rallia/shared-services';

import UnderlineTabBar, { type UnderlineTabItem } from '../../../components/UnderlineTabBar';
import {
  InvitedMembersSection,
  MembersSection,
  PendingMembersSection,
  SuspendedMembersSection,
  type ManageMemberRow,
  type MembersSegment,
  type PendingMemberRow,
  type ScreenColors,
} from './components';
import type { TranslationKey } from '../../../hooks';
import { styles } from './detailStyles';

interface MembersTabProps {
  league: League;
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  isOrganizer: boolean;
  membersSegmentTabs: UnderlineTabItem<MembersSegment>[];
  activeMembersSegment: MembersSegment;
  setMembersSegment: (segment: MembersSegment) => void;
  activeMemberRows: ManageMemberRow[];
  pendingMemberRows: PendingMemberRow[];
  invitedMemberRows: PendingMemberRow[];
  suspendedMemberRows: ManageMemberRow[];
  handlePlayerPress: (player: PlayerSearchResult) => void;
  handleInvitePress: () => void;
  handleApprovePress: (memberId: string, version: number) => void;
  handleRejectPress: (memberId: string, version: number, name: string) => void;
  handleRevokePress: (memberId: string, version: number) => void;
  handleSuspendMemberPress: (memberId: string, version: number, name: string) => void;
  handleRemoveMemberPress: (memberId: string, version: number, name: string) => void;
  handleReinstateMemberPress: (memberId: string, version: number, name: string) => void;
}

export const MembersTab: React.FC<MembersTabProps> = ({
  league,
  colors,
  t,
  isOrganizer,
  membersSegmentTabs,
  activeMembersSegment,
  setMembersSegment,
  activeMemberRows,
  pendingMemberRows,
  invitedMemberRows,
  suspendedMemberRows,
  handlePlayerPress,
  handleInvitePress,
  handleApprovePress,
  handleRejectPress,
  handleRevokePress,
  handleSuspendMemberPress,
  handleRemoveMemberPress,
  handleReinstateMemberPress,
}) => (
  <View style={styles.playersTabContent}>
    {isOrganizer && (
      <TouchableOpacity
        onPress={handleInvitePress}
        style={[styles.primaryButton, styles.inviteButton, { backgroundColor: colors.primary }]}
        testID="cta-invite-players"
      >
        <Ionicons name="person-add-outline" size={20} color="#ffffff" />
        <Text size="base" weight="semibold" color="#ffffff">
          {t('leagueDetail.invitePlayers.button')}
        </Text>
      </TouchableOpacity>
    )}
    {/* Edit and lifecycle controls live in the Overview's Manage list. */}
    {membersSegmentTabs.length > 1 && (
      <UnderlineTabBar
        tabs={membersSegmentTabs}
        activeKey={activeMembersSegment}
        onChange={setMembersSegment}
        style={styles.segmentBar}
      />
    )}
    {activeMembersSegment === 'requests' ? (
      <PendingMembersSection
        rows={pendingMemberRows}
        onPlayerPress={handlePlayerPress}
        onApprove={handleApprovePress}
        onReject={handleRejectPress}
        colors={colors}
        t={t}
      />
    ) : activeMembersSegment === 'invited' ? (
      <InvitedMembersSection
        rows={invitedMemberRows}
        onPlayerPress={handlePlayerPress}
        onRevoke={handleRevokePress}
        colors={colors}
        t={t}
      />
    ) : activeMembersSegment === 'suspended' && isOrganizer ? (
      <SuspendedMembersSection
        rows={suspendedMemberRows}
        onPlayerPress={handlePlayerPress}
        onReinstate={handleReinstateMemberPress}
        onRemove={handleRemoveMemberPress}
        colors={colors}
        t={t}
      />
    ) : (
      <MembersSection
        rows={activeMemberRows}
        ownerId={league.organizer_id}
        onPlayerPress={handlePlayerPress}
        organizerActions={
          isOrganizer
            ? { onSuspend: handleSuspendMemberPress, onRemove: handleRemoveMemberPress }
            : undefined
        }
        colors={colors}
        t={t}
      />
    )}
  </View>
);

export default MembersTab;
