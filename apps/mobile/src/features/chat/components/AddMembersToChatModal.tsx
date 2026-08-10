/**
 * AddMembersToChatModal
 * Modal to select and add new members to an existing group chat
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, Skeleton, EmptyState } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { usePlayerSearch } from '@rallia/shared-hooks';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { spacingPixels, fontSizePixels, primary, radiusPixels } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useSport } from '#/context';
import { SearchBar } from '#/components/SearchBar';

export function AddMembersToChatActionSheet({ payload }: SheetProps<'add-members-to-chat'>) {
  const existingMemberIds = payload?.existingMemberIds ?? [];
  const currentUserId = payload?.currentUserId;
  const onMembersSelected = payload?.onMembersSelected;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Exclude existing members and current user from search
  const excludePlayerIds = useMemo(
    () => [...existingMemberIds, ...(currentUserId ? [currentUserId] : [])],
    [existingMemberIds, currentUserId]
  );

  // Use paginated player search hook
  const { players, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = usePlayerSearch({
    sportId: selectedSport?.id,
    currentUserId,
    searchQuery,
    excludePlayerIds,
    pageSize: 50,
    enabled: !!selectedSport?.id && !!currentUserId,
  });

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleClose = useCallback(() => {
    setSelectedIds([]);
    setSearchQuery('');
    SheetManager.hide('add-members-to-chat');
  }, []);

  // Toggle selection
  const handleToggleSelect = useCallback((playerId: string) => {
    setSelectedIds(prev => {
      if (prev.includes(playerId)) {
        return prev.filter(id => id !== playerId);
      }
      return [...prev, playerId];
    });
  }, []);

  // Handle done
  const handleDone = useCallback(() => {
    if (selectedIds.length > 0) {
      onMembersSelected?.(selectedIds);
    }
    handleClose();
  }, [selectedIds, onMembersSelected, handleClose]);

  // Get selected players for chips display
  const selectedPlayers = useMemo(() => {
    return players.filter(p => selectedIds.includes(p.id));
  }, [players, selectedIds]);

  // Render selected member chips
  const renderSelectedChips = () => {
    if (selectedPlayers.length === 0) return null;

    return (
      <View style={styles.selectedChipsRow}>
        {selectedPlayers.map(player => (
          <TouchableOpacity
            key={player.id}
            style={styles.selectedChip}
            onPress={() => handleToggleSelect(player.id)}
          >
            <View style={styles.selectedChipAvatarContainer}>
              <View
                style={[
                  styles.selectedChipAvatar,
                  { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                ]}
              >
                {player.profile_picture_url ? (
                  <Image
                    source={{ uri: getProfilePictureUrl(player.profile_picture_url) ?? '' }}
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
            <Text style={[styles.selectedChipName, { color: colors.text }]} numberOfLines={1}>
              {player.first_name}
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

  // Render player item
  const renderPlayerItem = useCallback(
    ({ item }: { item: PlayerSearchResult }) => {
      const isSelected = selectedIds.includes(item.id);
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
          onPress={() => handleToggleSelect(item.id)}
          activeOpacity={0.7}
        >
          {/* Avatar */}
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

          {/* Name */}
          <View style={styles.playerInfo}>
            <Text style={[styles.playerName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
          </View>

          {/* Selection indicator */}
          {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />}
        </TouchableOpacity>
      );
    },
    [colors, isDark, selectedIds, handleToggleSelect]
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('chat.addMembers')}</Text>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Content Viewport */}
        <View style={styles.contentViewport}>
          {/* Search Bar */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('chat.searchPlayers')}
            colors={colors}
            style={styles.searchContainer}
          />

          {/* Selected Members Chips */}
          {renderSelectedChips()}

          {/* Player List */}
          {isLoading ? (
            renderPlayerSkeleton()
          ) : players.length === 0 ? (
            <EmptyState
              variant="sheet"
              icon={<Ionicons name="people-outline" size={36} color={colors.primary} />}
              title={searchQuery ? t('chat.noPlayersFound') : t('chat.noMorePlayersToAdd')}
            />
          ) : (
            <FlatList
              data={players}
              keyExtractor={item => item.id}
              renderItem={renderPlayerItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.3}
              ListFooterComponent={renderListFooter}
            />
          )}
        </View>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Button
            variant="primary"
            onPress={handleDone}
            disabled={selectedIds.length === 0}
            style={[selectedIds.length === 0 && styles.disabledButton]}
          >
            {t('chat.addCount', { count: selectedIds.length })}
          </Button>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const AddMembersToChatModal = AddMembersToChatActionSheet;

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
    flexDirection: 'column',
  },
  contentViewport: {
    flex: 1,
    overflow: 'hidden',
    paddingTop: spacingPixels[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerPlaceholder: {
    width: 32,
  },
  headerTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  searchContainer: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  selectedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: spacingPixels[4],
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
    fontSize: fontSizePixels.xs,
  },
  skeletonContainer: {
    flex: 1,
    paddingTop: spacingPixels[2],
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: spacingPixels[2],
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: 12,
    borderWidth: 1,
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
  playerName: {
    fontSize: fontSizePixels.base,
    fontWeight: '500',
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  disabledButton: {
    opacity: 0.5,
  },
});
