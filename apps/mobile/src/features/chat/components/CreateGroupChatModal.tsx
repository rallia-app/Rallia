/**
 * CreateGroupChatModal
 * Multi-step modal for creating a group chat (friends network).
 * Step 1: Select members from all active players
 * Step 2: Set group name and picture
 *
 * Creates a network with type 'friends' which automatically creates
 * a linked conversation and adds members to both.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import ActionSheet, {
  SheetManager,
  SheetProps,
  FlatList,
  ScrollView,
} from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton } from '@rallia/shared-components';
import { useGetOrCreateDirectConversation, usePlayerSearch } from '@rallia/shared-hooks';
import { primary, spacingPixels, fontSizePixels, radiusPixels } from '@rallia/design-system';
import type { PlayerSearchResult } from '@rallia/shared-services';

import { SearchBar } from '../../../components/SearchBar';
import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { useSport } from '../../../context';
import { supabase } from '../../../lib/supabase';
import { uploadImage } from '../../../services/imageUpload';
import { pickImageWithCropper } from '../../../utils/imagePicker';

const BASE_WHITE = '#ffffff';

interface SelectedMember {
  id: string;
  firstName: string;
  lastName?: string | null;
  profilePictureUrl?: string | null;
}

type Step = 'select-members' | 'group-details';

export function CreateGroupChatActionSheet({ payload }: SheetProps<'create-group-chat'>) {
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const currentUserId = session?.user?.id;

  // Step state
  const [step, setStep] = useState<Step>('select-members');

  // Reset modal state
  const resetModal = useCallback(() => {
    setStep('select-members');
    setSearchQuery('');
    setSelectedMembers([]);
    setGroupName('');
    setGroupImage(null);
    setError(null);
  }, []);

  const handleClose = useCallback(async () => {
    resetModal();
    await SheetManager.hide('create-group-chat');
  }, [resetModal]);

  // Step 1: Member selection
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);

  // Step 2: Group details
  const [groupName, setGroupName] = useState('');
  const [groupImage, setGroupImage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use paginated player search hook
  const {
    players,
    isLoading: isLoadingPlayers,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = usePlayerSearch({
    sportId: selectedSport?.id,
    currentUserId,
    searchQuery,
    pageSize: 50,
    enabled: !!selectedSport?.id && !!currentUserId,
  });

  // Map PlayerSearchResult to SelectedMember for display
  const toSelectedMember = useCallback(
    (player: PlayerSearchResult): SelectedMember => ({
      id: player.id,
      firstName: player.first_name,
      lastName: player.last_name,
      profilePictureUrl: player.profile_picture_url,
    }),
    []
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Member selection handlers — accepts either type
  const handleSelectMember = useCallback(
    (player: SelectedMember | PlayerSearchResult) => {
      const member: SelectedMember =
        'firstName' in player
          ? (player as SelectedMember)
          : toSelectedMember(player as PlayerSearchResult);

      setSelectedMembers(prev => {
        if (prev.some(p => p.id === member.id)) {
          return prev.filter(p => p.id !== member.id);
        }
        return [...prev, member];
      });
    },
    [toSelectedMember]
  );

  // Hook for creating direct conversations
  const getOrCreateDirectConversation = useGetOrCreateDirectConversation();

  const handleContinueToDetails = useCallback(async () => {
    if (selectedMembers.length === 0) {
      Alert.alert(t('chat.selectMembers'), t('chat.pleaseSelectMember'));
      return;
    }

    // If only 1 member selected, create a direct chat instead of a group
    if (selectedMembers.length === 1 && currentUserId) {
      setIsCreating(true);
      try {
        const conversation = await getOrCreateDirectConversation.mutateAsync({
          playerId1: currentUserId,
          playerId2: selectedMembers[0].id,
        });
        await handleClose();
        onSuccess?.(conversation.id);
      } catch (err) {
        console.error('Error creating direct conversation:', err);
        Alert.alert(t('common.error'), t('chat.failedToCreateConversation'));
      } finally {
        setIsCreating(false);
      }
      return;
    }

    // 2+ members: continue to group details
    setStep('group-details');
  }, [selectedMembers, currentUserId, t, getOrCreateDirectConversation, handleClose, onSuccess]);

  const handleBackToMembers = useCallback(() => {
    setStep('select-members');
  }, []);

  // Image picker
  const handlePickImage = useCallback(async () => {
    try {
      const { uri, error } = await pickImageWithCropper({
        aspectRatio: [1, 1],
        quality: 0.8,
        source: 'gallery',
      });

      if (error) {
        Alert.alert(t('common.permissionRequired'), t('chat.photoAccessRequired'));
        return;
      }

      if (uri) {
        setGroupImage(uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert(t('common.error'), t('chat.failedToPickImage'));
    }
  }, [t]);

  const _handleRemoveImage = useCallback(() => {
    setGroupImage(null);
  }, []);

  // Create group chat (simple group conversation without network)
  const handleCreateGroup = useCallback(async () => {
    if (!groupName.trim()) {
      setError(t('chat.groupNameRequired'));
      return;
    }

    if (groupName.trim().length < 2) {
      setError(t('chat.groupNameTooShort'));
      return;
    }

    if (!currentUserId) {
      Alert.alert(t('common.error'), t('chat.mustBeLoggedIn'));
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      let pictureUrl: string | undefined;

      // Upload image if selected
      if (groupImage) {
        const { url, error: uploadError } = await uploadImage(groupImage, 'group-images');
        if (uploadError) {
          console.error('Error uploading image:', uploadError);
          // Continue without image
        } else if (url) {
          pictureUrl = url;
        }
      }

      // 1. Create the conversation with picture_url
      const { data: conversation, error: convError } = await supabase
        .from('conversation')
        .insert({
          conversation_type: 'group',
          title: groupName.trim(),
          created_by: currentUserId,
          picture_url: pictureUrl || null,
        })
        .select('id')
        .single();

      if (convError || !conversation) {
        throw new Error('Failed to create conversation');
      }

      const conversationId = conversation.id as string;

      // 2. Add creator as conversation participant
      await supabase
        .from('conversation_participant')
        .insert({ conversation_id: conversationId, player_id: currentUserId });

      // 3. Add selected members to conversation
      for (const member of selectedMembers) {
        await supabase
          .from('conversation_participant')
          .insert({ conversation_id: conversationId, player_id: member.id });
      }

      // Success - close modal first, then return the conversation ID
      await handleClose();
      onSuccess?.(conversationId);
    } catch (err) {
      console.error('Error creating group:', err);
      Alert.alert(t('common.error'), t('chat.failedToCreateGroup'));
    } finally {
      setIsCreating(false);
    }
  }, [groupName, groupImage, selectedMembers, currentUserId, handleClose, onSuccess, t]);

  // Render player item
  const renderPlayerItem = useCallback(
    ({ item }: { item: PlayerSearchResult }) => {
      const isSelected = selectedMembers.some(p => p.id === item.id);
      const displayName = `${item.first_name} ${item.last_name || ''}`.trim();

      return (
        <TouchableOpacity
          style={[
            styles.playerItem,
            {
              backgroundColor: isSelected ? `${colors.buttonActive}15` : colors.buttonInactive,
              borderColor: isSelected ? colors.buttonActive : colors.border,
            },
          ]}
          onPress={() => handleSelectMember(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.playerAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
            {item.profile_picture_url ? (
              <Image source={{ uri: item.profile_picture_url }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={24} color={colors.textMuted} />
            )}
          </View>
          <View style={styles.playerInfo}>
            <Text weight="medium" style={{ color: colors.text }}>
              {displayName}
            </Text>
          </View>
          {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />}
        </TouchableOpacity>
      );
    },
    [colors, isDark, handleSelectMember, selectedMembers]
  );

  // Render selected member chips
  const renderSelectedChips = () => {
    if (selectedMembers.length === 0) return null;

    return (
      <View style={styles.selectedChipsRow}>
        {selectedMembers.map(member => (
          <TouchableOpacity
            key={member.id}
            style={styles.selectedChip}
            onPress={() => handleSelectMember(member)}
          >
            <View style={styles.selectedChipAvatarContainer}>
              <View
                style={[
                  styles.selectedChipAvatar,
                  { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                ]}
              >
                {member.profilePictureUrl ? (
                  <Image
                    source={{ uri: member.profilePictureUrl }}
                    style={styles.selectedChipAvatarImage}
                  />
                ) : (
                  <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                )}
              </View>
              <View style={[styles.removeChipBadge, { backgroundColor: primary[500] }]}>
                <Ionicons name="close-outline" size={10} color="#fff" />
              </View>
            </View>
            <Text
              size="xs"
              style={[styles.selectedChipName, { color: colors.text }]}
              numberOfLines={1}
            >
              {member.firstName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // Theme-aware skeleton colors
  const skeletonBg = isDark ? '#2C2C2E' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#3C3C3E' : '#F2F8FC';

  // Render loading skeleton matching playerItem layout
  const renderPlayerSkeleton = () => (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map(i => (
        <View
          key={i}
          style={[
            styles.playerItem,
            {
              backgroundColor: colors.buttonInactive,
              borderColor: colors.border,
            },
          ]}
        >
          <Skeleton
            width={48}
            height={48}
            circle
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
          <View style={styles.playerInfo}>
            <Skeleton
              width="55%"
              height={16}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
        </View>
      ))}
    </View>
  );

  // Render footer loading indicator for pagination
  const renderListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={primary[500]} />
      </View>
    );
  }, [isFetchingNextPage]);

  // Render Step 1: Select Members
  const renderSelectMembersStep = () => (
    <View style={styles.stepContainer}>
      {/* Search input */}
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={t('chat.searchPlayers')}
        colors={colors}
        style={styles.searchContainer}
      />

      {/* Selected members chips */}
      {renderSelectedChips()}

      {/* Player list */}
      <View style={styles.listContainer}>
        {isLoadingPlayers ? (
          renderPlayerSkeleton()
        ) : players.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: 12, textAlign: 'center' }}>
              {searchQuery
                ? t('chat.noPlayersFoundMatching', { query: searchQuery })
                : t('chat.noPlayersAvailable')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={players}
            keyExtractor={item => item.id}
            renderItem={renderPlayerItem}
            style={styles.flatList}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderListFooter}
          />
        )}
      </View>
    </View>
  );

  // Navigation button colors (match MatchCreationWizard)
  const buttonActive = isDark ? primary[500] : primary[600];
  const buttonTextActive = BASE_WHITE;

  // Render Step 1 Footer
  const renderSelectMembersFooter = () => {
    const isDisabled = selectedMembers.length === 0 || isCreating;
    const isSingleMember = selectedMembers.length === 1;

    return (
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.navButton,
            { backgroundColor: buttonActive },
            isDisabled && styles.navButtonDisabled,
          ]}
          onPress={() => void handleContinueToDetails()}
          disabled={isDisabled}
          activeOpacity={0.8}
        >
          {isCreating ? (
            <ActivityIndicator color={buttonTextActive} />
          ) : (
            <>
              <Text size="lg" weight="semibold" color={buttonTextActive}>
                {isSingleMember
                  ? t('chat.startChat')
                  : t('chat.continueSelected', { count: selectedMembers.length })}
              </Text>
              <Ionicons
                name={isSingleMember ? 'chatbubble-outline' : 'arrow-forward-outline'}
                size={20}
                color={buttonTextActive}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Render Step 2: Group Details
  const renderGroupDetailsStep = () => (
    <ScrollView
      style={styles.stepContainer}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {/* Group Image & Name Section */}
      <View style={styles.groupInfoSection}>
        {/* Group Image */}
        <View style={styles.imageContainer}>
          {groupImage ? (
            <TouchableOpacity onPress={() => void handlePickImage()} activeOpacity={0.8}>
              <Image source={{ uri: groupImage }} style={styles.groupImagePreview} />
              <View style={[styles.editImageBadge, { backgroundColor: primary[500] }]}>
                <Ionicons name="camera-outline" size={14} color="#fff" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.imagePicker, { backgroundColor: isDark ? colors.card : '#F5F5F5' }]}
              onPress={() => void handlePickImage()}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={28} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Group Name Input */}
        <View style={styles.nameInputContainer}>
          <TextInput
            style={[
              styles.nameInput,
              {
                backgroundColor: isDark ? colors.card : '#F5F5F5',
                color: colors.text,
                borderColor: error ? '#EF4444' : 'transparent',
              },
            ]}
            placeholder={t('chat.enterGroupName')}
            placeholderTextColor={colors.textMuted}
            value={groupName}
            onChangeText={text => {
              setGroupName(text);
              setError(null);
            }}
            maxLength={50}
          />
          {error && (
            <Text size="xs" style={{ color: '#EF4444', marginTop: 4 }}>
              {error}
            </Text>
          )}
        </View>
      </View>

      {/* Members Section */}
      <View style={styles.membersSection}>
        <Text
          size="sm"
          weight="semibold"
          style={{ color: colors.textMuted, marginBottom: spacingPixels[3] }}
        >
          {t('chat.members').toUpperCase()} ({selectedMembers.length + 1})
        </Text>
        <View style={[styles.membersCard, { backgroundColor: isDark ? colors.card : '#F5F5F5' }]}>
          {/* Current user (You) */}
          <View style={styles.memberRow}>
            <View style={[styles.memberAvatarLarge, { backgroundColor: primary[500] }]}>
              <Ionicons name="person-outline" size={20} color="#fff" />
            </View>
            <View style={styles.memberInfo}>
              <Text weight="medium" style={{ color: colors.text }}>
                {t('chat.you')}
              </Text>
              <Text size="xs" style={{ color: colors.textMuted }}>
                {t('chat.admin')}
              </Text>
            </View>
          </View>

          {/* Selected members */}
          {selectedMembers.map(member => {
            const displayName = `${member.firstName} ${member.lastName || ''}`.trim();
            return (
              <View key={member.id} style={styles.memberRow}>
                <View
                  style={[
                    styles.memberAvatarLarge,
                    { backgroundColor: isDark ? '#3A3A3C' : '#E5E5EA' },
                  ]}
                >
                  {member.profilePictureUrl ? (
                    <Image
                      source={{ uri: member.profilePictureUrl }}
                      style={styles.memberAvatarImage}
                    />
                  ) : (
                    <Ionicons name="person-outline" size={20} color={colors.textMuted} />
                  )}
                </View>
                <View style={styles.memberInfo}>
                  <Text weight="medium" style={{ color: colors.text }}>
                    {displayName}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );

  // Render Step 2 Footer
  const renderGroupDetailsFooter = () => (
    <View style={[styles.footer, { borderTopColor: colors.border }]}>
      <TouchableOpacity
        style={[
          styles.navButton,
          { backgroundColor: buttonActive },
          (isCreating || !groupName.trim()) && styles.navButtonDisabled,
        ]}
        onPress={() => void handleCreateGroup()}
        disabled={isCreating || !groupName.trim()}
        activeOpacity={0.8}
      >
        {isCreating ? (
          <ActivityIndicator color={buttonTextActive} />
        ) : (
          <>
            <Text size="lg" weight="semibold" color={buttonTextActive}>
              {t('chat.createGroup')}
            </Text>
            <Ionicons name="checkmark-outline" size={20} color={buttonTextActive} />
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          {step === 'group-details' ? (
            <TouchableOpacity onPress={handleBackToMembers} style={styles.backButton}>
              <Ionicons name="chevron-back-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerPlaceholder} />
          )}
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {step === 'select-members' ? t('chat.selectMembers') : t('chat.groupDetails')}
          </Text>
          <TouchableOpacity onPress={() => void handleClose()} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        {step === 'select-members' ? renderSelectMembersStep() : renderGroupDetailsStep()}

        {/* Sticky Footer */}
        {step === 'select-members' ? renderSelectMembersFooter() : renderGroupDetailsFooter()}
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const CreateGroupChatModal = CreateGroupChatActionSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  modalContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  backButton: {
    padding: spacingPixels[1],
  },
  headerPlaceholder: {
    width: 32,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
  },
  scrollContent: {
    paddingBottom: spacingPixels[4],
  },
  listContainer: {
    flex: 1,
  },
  flatList: {
    flex: 1,
  },
  searchContainer: {
    marginBottom: spacingPixels[3],
  },
  selectedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacingPixels[3],
    gap: spacingPixels[2],
  },
  selectedChip: {
    alignItems: 'center',
    width: 56,
  },
  selectedChipAvatarContainer: {
    position: 'relative',
  },
  selectedChipAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  selectedChipAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  removeChipBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedChipName: {
    marginTop: 4,
    textAlign: 'center',
    width: '100%',
  },
  skeletonContainer: {
    flex: 1,
    paddingTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  listContent: {
    paddingBottom: spacingPixels[4],
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  playerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  playerInfo: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  navButtonDisabled: {
    opacity: 0.6,
  },
  // Step 2 styles
  groupInfoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[6],
    gap: spacingPixels[4],
  },
  imageContainer: {
    position: 'relative',
  },
  imagePicker: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupImagePreview: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  editImageBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameInputContainer: {
    flex: 1,
  },
  nameInput: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: 12,
    borderWidth: 1,
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
  },
  membersSection: {
    flex: 1,
  },
  membersCard: {
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  memberAvatarLarge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  memberInfo: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
});

export default CreateGroupChatActionSheet;
