/**
 * CreateGroupChatModal
 * Multi-step modal for creating a group chat (friends network).
 * Step 1: Select members from all active players
 * Step 2: Set group name and picture
 *
 * Creates a network with type 'friends' which automatically creates
 * a linked conversation and adds members to both.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  ScrollView as RNScrollView,
} from 'react-native';
import { SearchBar } from '../../../components/SearchBar';
import ActionSheet, {
  SheetManager,
  SheetProps,
  FlatList,
  ScrollView,
} from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { Text } from '@rallia/shared-components';
import { useGetOrCreateDirectConversation } from '@rallia/shared-hooks';
import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { uploadImage } from '../../../services/imageUpload';
import {
  primary,
  darkTheme,
  lightTheme,
  spacingPixels,
  fontSizePixels,
  radiusPixels,
} from '@rallia/design-system';
import {
  selectionHaptic,
  lightHaptic,
  mediumHaptic,
  successHaptic,
  errorHaptic,
} from '../../../utils/haptics';

const BASE_WHITE = '#ffffff';
import { supabase } from '../../../lib/supabase';

interface SelectedMember {
  id: string;
  firstName: string;
  lastName?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
}

type Step = 'select-members' | 'group-details';

export function CreateGroupChatActionSheet({ payload }: SheetProps<'create-group-chat'>) {
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const currentUserId = session?.user?.id;

  // Theme colors (match MatchCreationWizard)
  const themeColors = isDark ? darkTheme : lightTheme;
  const buttonActive = isDark ? primary[500] : primary[600];
  const buttonTextActive = BASE_WHITE;
  const buttonInactive = themeColors.muted;

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
    setHasLoadedPlayers(false);
    setAllPlayers([]);
  }, []);

  const handleClose = useCallback(async () => {
    resetModal();
    await SheetManager.hide('create-group-chat');
  }, [resetModal]);

  // Step 1: Member selection
  const [searchQuery, setSearchQuery] = useState('');
  const [allPlayers, setAllPlayers] = useState<SelectedMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [hasLoadedPlayers, setHasLoadedPlayers] = useState(false);

  // Step 2: Group details
  const [groupName, setGroupName] = useState('');
  const [groupImage, setGroupImage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaPermissionStatus, setMediaPermissionStatus] =
    useState<ImagePicker.PermissionStatus | null>(null);

  // Load all active players when modal opens
  const loadPlayers = useCallback(async () => {
    if (hasLoadedPlayers || isLoadingPlayers || !currentUserId) return;

    setIsLoadingPlayers(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('player')
        .select(
          `
          id,
          profile:profile!player_id_fkey (
            first_name,
            last_name,
            display_name,
            profile_picture_url
          )
        `
        )
        .neq('id', currentUserId)
        .limit(200);

      if (fetchError) throw fetchError;

      const players: SelectedMember[] = (data || [])
        .filter((p: unknown) => {
          const player = p as { profile: { first_name?: string } | null };
          return player.profile?.first_name;
        })
        .map((p: unknown) => {
          const player = p as {
            id: string;
            profile: {
              first_name: string;
              last_name?: string | null;
              display_name?: string | null;
              profile_picture_url?: string | null;
            };
          };
          return {
            id: player.id,
            firstName: player.profile.first_name,
            lastName: player.profile.last_name,
            displayName: player.profile.display_name,
            profilePictureUrl: player.profile.profile_picture_url,
          };
        });

      setAllPlayers(players);
      setHasLoadedPlayers(true);
    } catch (err) {
      console.error('Error loading players:', err);
    } finally {
      setIsLoadingPlayers(false);
    }
  }, [currentUserId, hasLoadedPlayers, isLoadingPlayers]);

  // Load players when component mounts and user is authenticated
  useEffect(() => {
    if (!hasLoadedPlayers && currentUserId) {
      loadPlayers();
    }
  }, [hasLoadedPlayers, loadPlayers, currentUserId]);

  // Pre-check media library permissions when component mounts
  useEffect(() => {
    ImagePicker.getMediaLibraryPermissionsAsync().then(({ status }) => {
      setMediaPermissionStatus(status);
    });
  }, []);

  // Filter players based on search
  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) return allPlayers;

    const query = searchQuery.toLowerCase().trim();
    return allPlayers.filter(player => {
      const firstName = (player.firstName || '').toLowerCase();
      const lastName = (player.lastName || '').toLowerCase();
      const displayName = (player.displayName || '').toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();

      return (
        firstName.includes(query) ||
        lastName.includes(query) ||
        displayName.includes(query) ||
        fullName.includes(query)
      );
    });
  }, [allPlayers, searchQuery]);

  // Member selection handlers
  const handleSelectMember = useCallback((player: SelectedMember) => {
    selectionHaptic();
    setSelectedMembers(prev => {
      if (prev.some(p => p.id === player.id)) {
        return prev.filter(p => p.id !== player.id);
      }
      return [...prev, player];
    });
  }, []);

  // Hook for creating direct conversations
  const getOrCreateDirectConversation = useGetOrCreateDirectConversation();

  const handleContinueToDetails = useCallback(async () => {
    if (selectedMembers.length === 0) {
      errorHaptic();
      Alert.alert(t('chat.newConversation'), t('chat.pleaseSelectMember'));
      return;
    }

    // If only 1 member selected, create a direct chat instead of a group
    if (selectedMembers.length === 1 && currentUserId) {
      lightHaptic();
      setIsCreating(true);
      try {
        const conversation = await getOrCreateDirectConversation.mutateAsync({
          playerId1: currentUserId,
          playerId2: selectedMembers[0].id,
        });
        successHaptic();
        await handleClose();
        onSuccess?.(conversation.id);
      } catch (err) {
        errorHaptic();
        console.error('Error creating direct conversation:', err);
        Alert.alert(t('common.error'), t('chat.failedToCreateConversation'));
      } finally {
        setIsCreating(false);
      }
      return;
    }

    // 2+ members: continue to group details
    lightHaptic();
    setStep('group-details');
  }, [selectedMembers, currentUserId, t, getOrCreateDirectConversation, handleClose, onSuccess]);

  const handleBackToMembers = useCallback(() => {
    lightHaptic();
    setStep('select-members');
  }, []);

  // Image picker
  const handlePickImage = useCallback(async () => {
    try {
      // Use cached permission status if available, otherwise check
      let hasPermission = mediaPermissionStatus === 'granted';

      if (!hasPermission) {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        setMediaPermissionStatus(status);
        if (status !== 'granted') {
          Alert.alert(t('common.permissionRequired'), t('chat.photoAccessRequired'));
          return;
        }
        hasPermission = true;
      }

      mediumHaptic();
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setGroupImage(result.assets[0].uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert(t('common.error'), t('chat.failedToPickImage'));
    }
  }, [t, mediaPermissionStatus]);

  const handleRemoveImage = useCallback(() => {
    setGroupImage(null);
  }, []);

  // Create group chat (simple group conversation without network)
  const handleCreateGroup = useCallback(async () => {
    if (!groupName.trim()) {
      errorHaptic();
      setError(t('chat.groupNameRequired'));
      return;
    }

    if (groupName.trim().length < 2) {
      errorHaptic();
      setError(t('chat.groupNameTooShort'));
      return;
    }

    if (!currentUserId) {
      errorHaptic();
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
          conversation_type: 'group_chat',
          title: groupName.trim(),
          created_by: currentUserId,
          picture_url: pictureUrl || null,
        })
        .select('id')
        .single();

      if (convError || !conversation) {
        throw new Error('Failed to create conversation');
      }

      // 2. Add creator as conversation participant
      await supabase
        .from('conversation_participant')
        .insert({ conversation_id: conversation.id, player_id: currentUserId });

      // 3. Add selected members to conversation
      for (const member of selectedMembers) {
        await supabase
          .from('conversation_participant')
          .insert({ conversation_id: conversation.id, player_id: member.id });
      }

      // Success - close modal first, then return the conversation ID
      successHaptic();
      await handleClose();
      onSuccess?.(conversation.id);
    } catch (err) {
      errorHaptic();
      console.error('Error creating group:', err);
      Alert.alert(t('common.error'), t('chat.failedToCreateGroup'));
    } finally {
      setIsCreating(false);
    }
  }, [groupName, groupImage, selectedMembers, currentUserId, handleClose, onSuccess, t]);

  // Render player item
  const renderPlayerItem = useCallback(
    ({ item }: { item: SelectedMember }) => {
      const isSelected = selectedMembers.some(p => p.id === item.id);
      const displayName = `${item.firstName} ${item.lastName || ''}`.trim();

      return (
        <TouchableOpacity
          style={[
            styles.playerItem,
            {
              backgroundColor: isSelected ? `${buttonActive}15` : buttonInactive,
              borderColor: isSelected ? buttonActive : colors.border,
            },
          ]}
          onPress={() => handleSelectMember(item)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.playerAvatar,
              { backgroundColor: isSelected ? buttonActive : colors.border },
            ]}
          >
            {item.profilePictureUrl ? (
              <Image source={{ uri: item.profilePictureUrl }} style={styles.avatarImage} />
            ) : (
              <Ionicons
                name="person-outline"
                size={22}
                color={isSelected ? buttonTextActive : colors.textMuted}
              />
            )}
          </View>
          <View style={styles.playerInfo}>
            <Text
              weight={isSelected ? 'semibold' : 'regular'}
              style={{ color: isSelected ? buttonActive : colors.text }}
            >
              {displayName}
            </Text>
          </View>
          {isSelected && <Ionicons name="checkmark-circle" size={22} color={buttonActive} />}
        </TouchableOpacity>
      );
    },
    [colors, handleSelectMember, selectedMembers, buttonActive, buttonTextActive, buttonInactive]
  );

  // Render selected member chips
  const renderSelectedChips = () => {
    if (selectedMembers.length === 0) return null;

    return (
      <RNScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.selectedChipsScroll}
        contentContainerStyle={styles.selectedChipsRow}
      >
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
      </RNScrollView>
    );
  };

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
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primary[500]} />
            <Text style={{ color: colors.textMuted, marginTop: 12 }}>
              {t('chat.loadingPlayers')}
            </Text>
          </View>
        ) : filteredPlayers.length === 0 ? (
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
            data={filteredPlayers}
            keyExtractor={item => item.id}
            renderItem={renderPlayerItem}
            style={styles.flatList}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );

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
          onPress={handleContinueToDetails}
          disabled={isDisabled}
          activeOpacity={0.8}
        >
          {isCreating ? (
            <ActivityIndicator color={buttonTextActive} />
          ) : (
            <Text size="lg" weight="semibold" color={buttonTextActive}>
              {selectedMembers.length === 0
                ? t('chat.selectAPlayer')
                : isSingleMember
                  ? t('chat.startChat')
                  : t('common.continue')}
            </Text>
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
            <TouchableOpacity onPress={handlePickImage} activeOpacity={0.8}>
              <Image source={{ uri: groupImage }} style={styles.groupImagePreview} />
              <View style={[styles.editImageBadge, { backgroundColor: primary[500] }]}>
                <Ionicons name="camera-outline" size={14} color="#fff" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.imagePicker, { backgroundColor: isDark ? colors.card : '#F5F5F5' }]}
              onPress={handlePickImage}
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
        onPress={handleCreateGroup}
        disabled={isCreating || !groupName.trim()}
        activeOpacity={0.8}
      >
        {isCreating ? (
          <ActivityIndicator color={buttonTextActive} />
        ) : (
          <>
            <Ionicons name="checkmark-outline" size={20} color={buttonTextActive} />
            <Text size="lg" weight="semibold" color={buttonTextActive}>
              {t('chat.createGroup')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  // Handler for when sheet opens - ensure players are loaded
  const handleSheetOpen = useCallback(() => {
    if (!hasLoadedPlayers && currentUserId) {
      loadPlayers();
    }
  }, [hasLoadedPlayers, currentUserId, loadPlayers]);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            {step === 'group-details' && (
              <TouchableOpacity onPress={handleBackToMembers} style={styles.headerButton}>
                <Ionicons name="chevron-back-outline" size={24} color={buttonActive} />
              </TouchableOpacity>
            )}
          </View>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {step === 'select-members' ? t('chat.newConversation') : t('chat.groupDetails')}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
              <Ionicons name="close-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
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
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
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
  selectedChipsScroll: {
    flexGrow: 0,
    paddingTop: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  selectedChipsRow: {
    flexDirection: 'row',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
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
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
    gap: spacingPixels[3],
  },
  playerAvatar: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  playerInfo: {
    flex: 1,
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[8],
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
