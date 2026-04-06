/**
 * AddGroupMemberModal
 * Modal for adding a new member to a group (network)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text, Skeleton, useToast } from '@rallia/shared-components';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { useSport } from '../../../context';
import { useAddGroupMember, usePlayerSearch } from '@rallia/shared-hooks';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';

export function AddGroupMemberActionSheet({ payload }: SheetProps<'add-group-member'>) {
  const groupId = payload?.groupId ?? '';
  const currentMemberIds = payload?.currentMemberIds ?? [];
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const toast = useToast();
  const { t } = useTranslation();
  const { selectedSport } = useSport();

  const [searchQuery, setSearchQuery] = useState('');
  const [addedMemberIds, setAddedMemberIds] = useState<string[]>([]);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);

  const addMemberMutation = useAddGroupMember();

  // Exclude current members, recently added, and current user
  const excludePlayerIds = useMemo(
    () => [...currentMemberIds, ...addedMemberIds],
    [currentMemberIds, addedMemberIds]
  );

  // Use paginated player search hook
  const { players, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = usePlayerSearch({
    sportId: selectedSport?.id,
    currentUserId: playerId,
    searchQuery,
    excludePlayerIds,
    pageSize: 50,
    enabled: !!selectedSport?.id && !!playerId,
  });

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setAddedMemberIds([]);
    setAddingMemberId(null);
    SheetManager.hide('add-group-member');
  }, []);

  const handleAddMember = useCallback(
    async (memberPlayerId: string) => {
      if (!playerId) return;

      lightHaptic();
      setAddingMemberId(memberPlayerId);
      try {
        await addMemberMutation.mutateAsync({
          groupId,
          inviterId: playerId,
          playerIdToAdd: memberPlayerId,
        });
        successHaptic();
        toast.success(t('groups.memberAddedToGroup'));
        // Immediately remove the player from the list
        setAddedMemberIds(prev => [...prev, memberPlayerId]);
        onSuccess?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('groups.failedToAddMember'));
      } finally {
        setAddingMemberId(null);
      }
    },
    [groupId, playerId, addMemberMutation, onSuccess, toast, t]
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
            style={{ marginRight: 12 }}
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
              <Image source={{ uri: item.profile_picture_url }} style={styles.avatarImage} />
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
            onPress={() => handleAddMember(item.id)}
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
    [colors, isDark, handleAddMember, addingMemberId]
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
            {t('groups.addMember')}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('groups.searchPlayers')}
            colors={colors}
            autoFocus={false}
          />
        </View>

        {/* Results */}
        {isLoading ? (
          renderPlayerSkeleton()
        ) : players.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="person-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textSecondary, marginTop: 12 }}>
              {searchQuery ? t('groups.noPlayersFound') : t('groups.noPlayersAvailable')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={players}
            renderItem={renderPlayerItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
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
export const AddGroupMemberModal = AddGroupMemberActionSheet;

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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerPlaceholder: {
    width: 32,
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    padding: 16,
  },
  listContent: {
    paddingBottom: spacingPixels[4],
  },
  skeletonContainer: {
    flex: 1,
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
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
    marginRight: 12,
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  playerInfo: {
    flex: 1,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
