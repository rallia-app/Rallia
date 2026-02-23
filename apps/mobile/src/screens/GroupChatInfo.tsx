/**
 * GroupChatInfo Screen
 * Shows group chat details - profile picture, name, description, members
 * Allows editing group info and managing members
 *
 * Refactored to use extracted hooks:
 * - useGroupChatInfo: Data fetching and admin checks
 * - useGroupMemberManagement: Member CRUD operations
 * - useGroupEditActions: Name/image/description editing
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import { Text, Skeleton, SkeletonAvatar } from '@rallia/shared-components';
import {
  useThemeStyles,
  useAuth,
  useGroupChatInfo,
  useGroupMemberManagement,
  useGroupEditActions,
  useTranslation,
  type TranslationKey,
} from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { spacingPixels, fontSizePixels, primary, status, neutral } from '@rallia/design-system';
import { ChatMemberOptionsModal } from '../features/chat';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { SheetManager } from 'react-native-actions-sheet';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type GroupChatInfoRouteProp = RouteProp<RootStackParamList, 'GroupChatInfo'>;

interface ParticipantInfo {
  id: string;
  player_id: string;
  player: {
    id: string;
    profile: {
      first_name: string;
      last_name: string | null;
      profile_picture_url: string | null;
    } | null;
  } | null;
  is_admin?: boolean;
}

export default function GroupChatInfoScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<GroupChatInfoRouteProp>();
  const { conversationId } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const playerId = session?.user?.id;

  // Network info state (needed for useGroupEditActions callback)
  const [networkInfoState, setNetworkInfoState] = useState<{
    id: string;
    name: string;
    cover_image_url: string | null;
    description: string | null;
    member_count: number;
    type: 'community' | 'player_group' | string | null;
  } | null>(null);

  // Use extracted hooks
  const {
    conversation,
    networkInfo,
    participants,
    groupImageUrl,
    memberCount,
    isLoading,
    refetch,
    refetchNetworkInfo,
    isAdmin,
    isParticipantAdmin,
  } = useGroupChatInfo(conversationId, playerId);

  // Sync networkInfo to local state for edit actions callback
  React.useEffect(() => {
    setNetworkInfoState(networkInfo);
  }, [networkInfo]);

  const {
    isUpdating: isMemberUpdating,
    handleMembersAdded,
    // Modal-based member management
    showMemberOptionsModal,
    selectedMember,
    closeMemberOptionsModal,
    showConfirmationModal,
    confirmationConfig,
    closeConfirmationModal,
    handleMemberPress,
    handleLeaveGroup,
    getMemberOptions,
  } = useGroupMemberManagement({
    conversationId,
    playerId,
    networkInfo,
    isAdmin,
    onRefetch: refetch,
    onRefetchNetworkInfo: refetchNetworkInfo,
    onLeaveGroup: () => {
      navigation.goBack();
      navigation.goBack(); // Go back twice to exit chat
    },
  });

  const {
    isEditingName,
    editedName,
    setEditedName,
    isUpdating: isEditUpdating,
    handleStartEditName,
    handleSaveName,
    handleCancelEditName,
    handleChangeImage,
    handleEditDescription,
  } = useGroupEditActions({
    conversationId,
    conversationTitle: conversation?.title ?? undefined,
    playerId,
    networkInfo: networkInfoState,
    onRefetch: refetch,
    onNetworkInfoUpdate: setNetworkInfoState,
  });

  const isUpdating = isMemberUpdating || isEditUpdating;

  // Handle back navigation
  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Handle invite via QR code / link
  const handleInviteViaQR = useCallback(() => {
    if (!networkInfo?.id) return;
    
    SheetManager.show('invite-link', {
      payload: {
        groupId: networkInfo.id,
        groupName: networkInfo.name ?? '',
        currentUserId: playerId ?? '',
        isModerator: isAdmin ?? false,
        type: networkInfo.type === 'community' ? 'community' : undefined,
      },
    });
  }, [networkInfo, playerId, isAdmin]);

  // Handle add member - show action sheet
  const handleAddMember = useCallback(() => {
    SheetManager.show('add-members-to-group', {
      payload: {
        existingMemberIds: participants.map(p => p.player_id),
        currentUserId: playerId,
        onMembersSelected: handleMembersAdded,
      },
    });
  }, [participants, playerId, handleMembersAdded]);

  // Navigate to member profile from member options modal
  const handleNavigateToProfile = useCallback(() => {
    if (selectedMember?.playerId) {
      closeMemberOptionsModal();
      navigation.navigate('PlayerProfile', { playerId: selectedMember.playerId });
    }
  }, [selectedMember, closeMemberOptionsModal, navigation]);

  // Handle member item tap - show options modal
  const handleMemberItemPress = useCallback((item: ParticipantInfo) => {
    const profile = item.player?.profile;
    const displayName = profile
      ? `${profile.first_name}${profile.last_name ? ` ${profile.last_name}` : ''}`
      : 'Unknown User';

    handleMemberPress({
      playerId: item.player_id,
      name: displayName,
      profilePictureUrl: profile?.profile_picture_url || null,
      isAdmin: isParticipantAdmin(item.player_id),
    });
  }, [handleMemberPress, isParticipantAdmin]);

  // Render member item
  const renderMemberItem = useCallback(({ item }: { item: ParticipantInfo }) => {
    const profile = item.player?.profile;
    const isMemberAdmin = isParticipantAdmin(item.player_id);
    const isCurrentUser = item.player_id === playerId;
    const displayName = profile
      ? `${profile.first_name}${profile.last_name ? ` ${profile.last_name}` : ''}`
      : 'Unknown User';

    return (
      <TouchableOpacity
        style={[styles.memberItem, { borderBottomColor: colors.border }]}
        onPress={() => handleMemberItemPress(item)}
      >
        {/* Avatar */}
        {profile?.profile_picture_url ? (
          <Image source={{ uri: profile.profile_picture_url }} style={styles.memberAvatar} />
        ) : (
          <View style={[styles.memberAvatarPlaceholder, { backgroundColor: primary[100] }]}>
            <Ionicons name="person" size={20} color={primary[500]} />
          </View>
        )}

        {/* Name and role */}
        <View style={styles.memberInfo}>
          <Text style={[styles.memberName, { color: colors.text }]}>
            {displayName}
            {isCurrentUser && <Text style={{ color: primary[500] }}> (You)</Text>}
          </Text>
          {isMemberAdmin && (
            <View style={[styles.adminBadge, { backgroundColor: primary[500] }]}>
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          )}
        </View>

        {/* More options icon */}
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    );
  }, [colors, playerId, isParticipantAdmin, handleMemberItemPress]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          {/* Group Chat Info Skeleton */}
          <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <SkeletonAvatar
              size={100}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
            />
            <Skeleton
              width={150}
              height={18}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
              style={{ marginTop: 16 }}
            />
            <Skeleton
              width={100}
              height={14}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
              style={{ marginTop: 8 }}
            />
          </View>
          <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
            <Skeleton
              width={100}
              height={16}
              borderRadius={4}
              backgroundColor={colors.cardBackground}
              highlightColor={colors.border}
            />
            <View style={{ marginTop: 12, gap: 12 }}>
              {[...Array(4)].map((_, index) => (
                <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <SkeletonAvatar
                    size={48}
                    backgroundColor={colors.cardBackground}
                    highlightColor={colors.border}
                  />
                  <View style={{ flex: 1 }}>
                    <Skeleton
                      width={120}
                      height={16}
                      borderRadius={4}
                      backgroundColor={colors.cardBackground}
                      highlightColor={colors.border}
                    />
                    <Skeleton
                      width={80}
                      height={14}
                      borderRadius={4}
                      backgroundColor={colors.cardBackground}
                      highlightColor={colors.border}
                      style={{ marginTop: 4 }}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!conversation) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          <Text style={{ color: colors.text }}>Conversation not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Group Info</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Group Image */}
        <TouchableOpacity style={styles.imageSection} onPress={handleChangeImage}>
          {groupImageUrl ? (
            <Image source={{ uri: groupImageUrl }} style={styles.groupImage} />
          ) : (
            <View style={[styles.groupImagePlaceholder, { backgroundColor: primary[100] }]}>
              <Ionicons name="people-outline" size={60} color={primary[500]} />
            </View>
          )}
          <View style={[styles.editImageBadge, { backgroundColor: primary[500] }]}>
            <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* Group Name */}
        <View style={styles.infoSection}>
          {isEditingName ? (
            <View style={styles.editRow}>
              <TextInput
                style={[
                  styles.editInput,
                  {
                    color: colors.text,
                    borderColor: primary[500],
                    backgroundColor: isDark ? neutral[800] : neutral[50],
                  },
                ]}
                value={editedName}
                onChangeText={setEditedName}
                autoFocus
                maxLength={50}
              />
              <TouchableOpacity style={styles.saveButton} onPress={handleSaveName}>
                <Ionicons name="checkmark-outline" size={24} color={primary[500]} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancelEditName}>
                <Ionicons name="close-outline" size={24} color={status.error.DEFAULT} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.infoRow} onPress={handleStartEditName}>
              <Text style={[styles.groupName, { color: colors.text }]}>{conversation.title}</Text>
              <Ionicons name="pencil" size={18} color={primary[500]} />
            </TouchableOpacity>
          )}
          <Text style={[styles.memberCount, { color: colors.textMuted }]}>
            {t('groupChat.groupMemberCount', { count: memberCount })}
          </Text>
        </View>

        {/* Description - only for network-linked groups (Groups section) */}
        {networkInfo && (
          <View style={[styles.section, { backgroundColor: isDark ? colors.card : '#FFFFFF' }]}>
            <TouchableOpacity style={styles.sectionRow} onPress={handleEditDescription}>
              <View style={styles.sectionIcon}>
                <Ionicons name="document-text-outline" size={22} color={primary[500]} />
              </View>
              <View style={styles.sectionContent}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>
                  {networkInfo.description || t('groupChat.addGroupDescription')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Actions */}
        <View style={[styles.section, { backgroundColor: isDark ? colors.card : '#FFFFFF' }]}>
          {/* Add Members */}
          <TouchableOpacity style={styles.sectionRow} onPress={handleAddMember}>
            <View style={[styles.sectionIcon, { backgroundColor: primary[100] }]}>
              <Ionicons name="person-add" size={20} color={primary[500]} />
            </View>
            <View style={styles.sectionContent}>
              <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('chat.groupChat.addMembers' as TranslationKey)}</Text>
            </View>
          </TouchableOpacity>

          {/* Invite via QR */}
          <TouchableOpacity
            style={[styles.sectionRow, { borderBottomWidth: 0 }]}
            onPress={handleInviteViaQR}
          >
            <View style={[styles.sectionIcon, { backgroundColor: primary[100] }]}>
              <Ionicons name="qr-code" size={20} color={primary[500]} />
            </View>
            <View style={styles.sectionContent}>
              <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('chat.groupChat.inviteViaLinkOrQR' as TranslationKey)}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Members List Header */}
        <View style={styles.membersHeader}>
          <Text style={[styles.membersHeaderText, { color: colors.textMuted }]}>
            {t('common.memberCount', { count: memberCount })}
          </Text>
          <TouchableOpacity>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Members List */}
        <View style={[styles.section, { backgroundColor: isDark ? colors.card : '#FFFFFF' }]}>
          {participants.map(participant => (
            <View key={participant.id}>{renderMemberItem({ item: participant })}</View>
          ))}
        </View>

        {/* Leave Group */}
        {playerId && (
          <View
            style={[
              styles.section,
              { backgroundColor: isDark ? colors.card : '#FFFFFF', marginTop: spacingPixels[4] },
            ]}
          >
            <TouchableOpacity
              style={[styles.sectionRow, { borderBottomWidth: 0 }]}
              onPress={handleLeaveGroup}
            >
              <View style={[styles.sectionIcon, { backgroundColor: status.error.light }]}>
                <Ionicons name="exit-outline" size={20} color={status.error.DEFAULT} />
              </View>
              <View style={styles.sectionContent}>
                <Text style={[styles.sectionLabel, { color: status.error.DEFAULT }]}>
                  Leave group
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom spacing */}
        <View style={{ height: spacingPixels[8] }} />
      </ScrollView>

      {/* Loading overlay */}
      {isUpdating && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={primary[500]} />
        </View>
      )}

      {/* Member Options Modal */}
      <ChatMemberOptionsModal
        visible={showMemberOptionsModal}
        onClose={closeMemberOptionsModal}
        member={selectedMember}
        options={getMemberOptions().map(opt => ({
          ...opt,
          icon: opt.icon as keyof typeof Ionicons.glyphMap,
          onPress: opt.id === 'view-profile' ? handleNavigateToProfile : opt.onPress,
        }))}
        onAvatarPress={handleNavigateToProfile}
        isLoading={isMemberUpdating}
      />

      {/* Confirmation Modal */}
      {confirmationConfig && (
        <ConfirmationModal
          visible={showConfirmationModal}
          onClose={closeConfirmationModal}
          onConfirm={confirmationConfig.onConfirm}
          title={confirmationConfig.title}
          message={confirmationConfig.message}
          confirmLabel={confirmationConfig.confirmLabel}
          cancelLabel={t('common.cancel')}
          destructive={confirmationConfig.destructive}
          isLoading={isMemberUpdating}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: spacingPixels[2],
    marginLeft: -spacingPixels[2],
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  imageSection: {
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
  },
  groupImage: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  groupImagePlaceholder: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editImageBadge: {
    position: 'absolute',
    bottom: spacingPixels[6] + 10,
    right: '50%',
    marginRight: -60,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoSection: {
    alignItems: 'center',
    paddingBottom: spacingPixels[4],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  groupName: {
    fontSize: fontSizePixels.xl,
    fontWeight: '700',
  },
  memberCount: {
    fontSize: fontSizePixels.sm,
    marginTop: spacingPixels[1],
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
  },
  editInput: {
    flex: 1,
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
  },
  saveButton: {
    padding: spacingPixels[2],
  },
  cancelButton: {
    padding: spacingPixels[2],
  },
  section: {
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacingPixels[3],
  },
  sectionContent: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: fontSizePixels.base,
  },
  membersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[6],
    marginBottom: spacingPixels[2],
  },
  membersHeaderText: {
    fontSize: fontSizePixels.sm,
    fontWeight: '500',
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: spacingPixels[3],
  },
  memberAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacingPixels[3],
  },
  memberInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  memberName: {
    fontSize: fontSizePixels.base,
    fontWeight: '500',
  },
  adminBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: 4,
  },
  adminBadgeText: {
    color: '#FFFFFF',
    fontSize: fontSizePixels.xs,
    fontWeight: '600',
  },
  removeButton: {
    padding: spacingPixels[2],
  },
  moreButton: {
    padding: spacingPixels[2],
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
