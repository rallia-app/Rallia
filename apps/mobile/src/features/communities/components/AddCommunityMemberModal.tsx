/**
 * AddCommunityMemberModal
 * Modal for adding/referring members to a community
 *
 * FLOWS:
 * - Moderators: Can directly add members (instant) or add as moderator
 * - Regular members: Can refer other players (creates pending request that needs approval)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Switch } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text, Skeleton, useToast } from '@rallia/shared-components';
import { lightHaptic, successHaptic, getProfilePictureUrl } from '@rallia/shared-utils';
import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { useSport } from '../../../context';
import {
  usePlayerSearch,
  useAddCommunityMember,
  useReferPlayerToCommunity,
  useIsCommunityModerator,
} from '@rallia/shared-hooks';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';

export function AddCommunityMemberActionSheet({ payload }: SheetProps<'add-community-member'>) {
  const communityId = payload?.communityId ?? '';
  const currentMemberIds = payload?.currentMemberIds ?? [];
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const toast = useToast();
  const { selectedSport } = useSport();

  const [searchQuery, setSearchQuery] = useState('');
  const [addAsModerator, setAddAsModerator] = useState(false);
  const [addedMemberIds, setAddedMemberIds] = useState<string[]>([]);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);

  // Mutations
  const addMemberMutation = useAddCommunityMember(); // For moderators - direct add
  const referMemberMutation = useReferPlayerToCommunity(); // For regular members - creates pending request

  const { data: isModerator } = useIsCommunityModerator(communityId, playerId);

  // Only pass existing members through the query key; locally-added IDs are
  // filtered client-side to avoid refetching the whole list on every + tap.
  const excludePlayerIds = useMemo(() => currentMemberIds, [currentMemberIds]);

  // Use paginated player search hook
  const { players, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = usePlayerSearch({
    sportId: selectedSport?.id,
    currentUserId: playerId,
    searchQuery,
    excludePlayerIds,
    pageSize: 50,
    enabled: !!selectedSport?.id && !!playerId,
  });

  const visiblePlayers = useMemo(
    () => players.filter(p => !addedMemberIds.includes(p.id)),
    [players, addedMemberIds]
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleClose = useCallback(() => {
    lightHaptic();
    setSearchQuery('');
    setAddAsModerator(false);
    setAddedMemberIds([]);
    setAddingMemberId(null);
    SheetManager.hide('add-community-member');
  }, []);

  const handleAddOrReferMember = useCallback(
    async (memberPlayerId: string) => {
      if (!playerId) return;

      lightHaptic();
      setAddingMemberId(memberPlayerId);
      try {
        if (isModerator) {
          // Moderator: Direct add
          await addMemberMutation.mutateAsync({
            communityId,
            playerId: memberPlayerId,
            moderatorId: playerId,
            addAsModerator,
          });
          successHaptic();
          toast.success(
            addAsModerator
              ? t('community.moderatorAddedToCommunity')
              : t('community.memberAddedToCommunity')
          );
        } else {
          // Regular member: Refer (creates pending request)
          await referMemberMutation.mutateAsync({
            communityId,
            referredPlayerId: memberPlayerId,
            referrerId: playerId,
          });
          successHaptic();
          toast.success(t('community.membershipRequestSubmitted'));
        }
        // Immediately remove the player from the list
        setAddedMemberIds(prev => [...prev, memberPlayerId]);
        onSuccess?.();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t('community.failedToAddMember');
        console.error('[AddCommunityMemberModal] Error adding/referring member:', {
          error,
          errorMessage,
          communityId,
          memberPlayerId,
          isModerator,
          addAsModerator,
        });
        toast.error(errorMessage);
      } finally {
        setAddingMemberId(null);
      }
    },
    [
      communityId,
      playerId,
      isModerator,
      addMemberMutation,
      referMemberMutation,
      onSuccess,
      toast,
      addAsModerator,
      t,
    ]
  );

  // Theme-aware skeleton colors
  const skeletonBg = isDark ? '#2C2C2E' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#3C3C3E' : '#F2F8FC';

  // Render loading skeleton matching playerItem layout
  const renderPlayerSkeleton = () => (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map(i => (
        <View key={i} style={[styles.playerItem, { borderBottomColor: colors.border }]}>
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
            <Skeleton
              width="35%"
              height={14}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ marginTop: 4 }}
            />
          </View>
          <Skeleton
            width={36}
            height={36}
            circle
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
        </View>
      ))}
    </View>
  );

  // Render footer loading indicator for pagination
  const renderListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isFetchingNextPage, colors.primary]);

  const renderPlayerItem = useCallback(
    ({ item }: { item: PlayerSearchResult }) => {
      const isAddingThis = addingMemberId === item.id;
      const fullName = `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unknown';

      return (
        <View style={[styles.playerItem, { borderBottomColor: colors.border }]}>
          <View style={[styles.playerAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
            {item.profile_picture_url ? (
              <Image
                source={{ uri: getProfilePictureUrl(item.profile_picture_url) ?? '' }}
                style={styles.avatarImage}
              />
            ) : (
              <Ionicons name="person-outline" size={24} color={colors.textMuted} />
            )}
          </View>
          <View style={styles.playerInfo}>
            <Text weight="medium" style={{ color: colors.text }}>
              {fullName}
            </Text>
            {item.city && (
              <Text size="sm" style={{ color: colors.textSecondary }}>
                {item.city}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.primary }]}
            onPress={() => handleAddOrReferMember(item.id)}
            disabled={addingMemberId !== null}
          >
            {isAddingThis ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="add-outline" size={20} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      );
    },
    [colors, isDark, handleAddOrReferMember, addingMemberId]
  );

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerPlaceholder} />
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {isModerator ? t('community.addCommunityMember') : t('community.referAPlayer')}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Info text for non-moderators */}
        {!isModerator && (
          <View style={[styles.infoBox, { backgroundColor: colors.inputBackground }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
            <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 8, flex: 1 }}>
              {t('community.referralApprovalInfo')}
            </Text>
          </View>
        )}

        {/* Add as Moderator Toggle (only for moderators) */}
        {isModerator && (
          <View style={[styles.moderatorToggle, { borderBottomColor: colors.border }]}>
            <View style={styles.toggleInfo}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
              <Text size="sm" style={{ color: colors.text, marginLeft: 8 }}>
                {t('community.addAsModerator')}
              </Text>
            </View>
            <Switch
              value={addAsModerator}
              onValueChange={setAddAsModerator}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        )}

        {/* Search */}
        <View style={styles.searchContainer}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('community.searchPlayers')}
            colors={colors}
          />
        </View>

        {/* Results */}
        {isLoading ? (
          renderPlayerSkeleton()
        ) : visiblePlayers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
              {searchQuery ? t('community.noPlayersFound') : t('community.noPlayersAvailable')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={visiblePlayers}
            renderItem={renderPlayerItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderListFooter}
          />
        )}
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const AddCommunityMemberModal = AddCommunityMemberActionSheet;

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
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  headerPlaceholder: {
    width: 32,
  },
  closeButton: {
    padding: 4,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
  },
  moderatorToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchContainer: {
    padding: 16,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: spacingPixels[4],
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
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
    marginLeft: 12,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
