/**
 * Player Invite Step
 *
 * Component for inviting players to a match after creation.
 * Shows a searchable list of players active in the same sport.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  lightHaptic,
  selectionHaptic,
  successHaptic,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import { usePlayerSearch, useInviteToMatch } from '@rallia/shared-hooks';
import type { PlayerSearchResult } from '@rallia/shared-services';
import type { MatchParticipantWithPlayer } from '@rallia/shared-types';
import type { TranslationKey, TranslationOptions } from '../../../hooks/useTranslation';
import { SearchBar } from '../../../components/SearchBar';
import RatingBadge from '../../../components/RatingBadge';
import { InviteFromListsStep } from '../../shared-lists/components/InviteFromListsStep';

// =============================================================================
// TYPES
// =============================================================================

interface PlayerInviteStepProps {
  /** Match ID to invite players to */
  matchId: string;
  /** Sport ID to filter players by */
  sportId: string;
  /** Current user ID (host) */
  hostId: string;
  /** Callback when invitations are sent or skipped */
  onComplete: () => void;
  /** Theme colors */
  colors: {
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    cardBackground: string;
    background: string;
  };
  /** Translation function */
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  /** Whether dark mode is active */
  isDark: boolean;
  /** Player IDs to exclude from search (e.g., existing participants) */
  excludePlayerIds?: string[];
  /** Callback with optimistic participant data after successful invitation */
  onInviteSuccess?: (participants: MatchParticipantWithPlayer[]) => void;
  /** When true, show a close (X) icon in the top right that calls onComplete (e.g. in wizard; sheet has its own X) */
  showCloseButton?: boolean;
}

type InviteTab = 'players' | 'lists';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get initials from a name for avatar fallback
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// =============================================================================
// PLAYER CARD COMPONENT
// =============================================================================

interface PlayerCardProps {
  player: PlayerSearchResult;
  isSelected: boolean;
  onToggle: (player: PlayerSearchResult) => void;
  colors: PlayerInviteStepProps['colors'];
  isDark: boolean;
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  isSelected,
  onToggle,
  colors,
  isDark,
}) => {
  const handlePress = () => {
    selectionHaptic();
    onToggle(player);
  };

  return (
    <TouchableOpacity
      style={[
        styles.playerCard,
        {
          backgroundColor: isSelected ? `${colors.buttonActive}15` : colors.buttonInactive,
          borderColor: isSelected ? colors.buttonActive : colors.border,
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {player.profile_picture_url ? (
          <Image
            source={{ uri: getProfilePictureUrl(player.profile_picture_url) || '' }}
            style={styles.avatar}
          />
        ) : (
          <View
            style={[
              styles.avatarFallback,
              { backgroundColor: isSelected ? colors.buttonActive : colors.border },
            ]}
          >
            <Text
              size="sm"
              weight="semibold"
              color={isSelected ? colors.buttonTextActive : colors.textMuted}
            >
              {getInitials(`${player.first_name} ${player.last_name}`)}
            </Text>
          </View>
        )}
      </View>

      {/* Player info */}
      <View style={styles.playerInfo}>
        <Text
          size="base"
          weight={isSelected ? 'semibold' : 'regular'}
          color={isSelected ? colors.buttonActive : colors.text}
          numberOfLines={1}
        >
          {player.first_name} {player.last_name}
        </Text>
        {player.rating && (
          <RatingBadge
            ratingValue={player.rating.value}
            ratingLabel={player.rating.label}
            certificationStatus={player.rating.is_certified ? 'certified' : 'self_declared'}
            isDark={isDark}
            size="sm"
          />
        )}
      </View>

      {/* Selection indicator */}
      <View
        style={[
          styles.checkCircle,
          {
            backgroundColor: isSelected ? colors.buttonActive : 'transparent',
            borderColor: isSelected ? colors.buttonActive : colors.border,
          },
        ]}
      >
        {isSelected && (
          <Ionicons name="checkmark-outline" size={14} color={colors.buttonTextActive} />
        )}
      </View>
    </TouchableOpacity>
  );
};

// =============================================================================
// SELECTED PLAYERS STRIP
// =============================================================================

interface SelectedPlayersStripProps {
  players: PlayerSearchResult[];
  onRemove: (player: PlayerSearchResult) => void;
  colors: PlayerInviteStepProps['colors'];
}

const SelectedPlayersStrip: React.FC<SelectedPlayersStripProps> = ({
  players,
  onRemove,
  colors,
}) => {
  if (players.length === 0) return null;

  return (
    <View style={styles.selectedStrip}>
      <FlatList
        horizontal
        data={players}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.selectedStripContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.selectedAvatarContainer}
            onPress={() => {
              lightHaptic();
              onRemove(item);
            }}
            activeOpacity={0.7}
          >
            {item.profile_picture_url ? (
              <Image
                source={{ uri: getProfilePictureUrl(item.profile_picture_url) || '' }}
                style={styles.selectedAvatar}
              />
            ) : (
              <View
                style={[styles.selectedAvatarFallback, { backgroundColor: colors.buttonActive }]}
              >
                <Text size="xs" weight="semibold" color={colors.buttonTextActive}>
                  {getInitials(`${item.first_name} ${item.last_name}`)}
                </Text>
              </View>
            )}
            <View style={[styles.removeButton, { backgroundColor: colors.textMuted }]}>
              <Ionicons name="close-outline" size={10} color={colors.buttonTextActive} />
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const PlayerInviteStep: React.FC<PlayerInviteStepProps> = ({
  matchId,
  sportId,
  hostId,
  onComplete,
  colors,
  t,
  isDark,
  excludePlayerIds,
  onInviteSuccess,
  showCloseButton = false,
}) => {
  const toast = useToast();

  // Tab state: Players (app users) or From lists (shared-list contacts)
  const [activeTab, setActiveTab] = useState<InviteTab>('players');

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerSearchResult[]>([]);
  /** Player IDs we invited this session — exclude them from search so they don't show again */
  const [invitedPlayerIds, setInvitedPlayerIds] = useState<string[]>([]);

  // Merge prop exclude (existing participants) with players we just invited
  const effectiveExcludePlayerIds = useMemo(
    () => [...(excludePlayerIds ?? []), ...invitedPlayerIds],
    [excludePlayerIds, invitedPlayerIds]
  );

  // Selected player IDs for quick lookup
  const selectedPlayerIds = useMemo(
    () => new Set(selectedPlayers.map(p => p.id)),
    [selectedPlayers]
  );

  // Refreshing state for pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Player search hook
  const {
    players,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error: searchError,
  } = usePlayerSearch({
    sportId,
    currentUserId: hostId,
    searchQuery,
    excludePlayerIds: effectiveExcludePlayerIds,
    enabled: true,
  });

  // Invite mutation - do not close sheet on success so user can also share with contacts
  const { invitePlayers, isInviting } = useInviteToMatch({
    matchId,
    hostId,
    onSuccess: result => {
      successHaptic();
      const invited = result?.invited ?? [];
      const count = invited.length;
      const newInvitedIds = invited.map((p: { player_id: string }) => p.player_id);
      if (newInvitedIds.length > 0) {
        setInvitedPlayerIds(prev => [...prev, ...newInvitedIds]);
      }
      toast.success(t('matchCreation.invite.invitationsSentCount', { count }));
      // Optimistic update: build participant entries with player data for parent UI
      if (onInviteSuccess && invited.length > 0) {
        const playerMap = new Map(selectedPlayers.map(p => [p.id, p]));
        const optimisticParticipants = invited.map(participant => {
          const searchData = playerMap.get(participant.player_id);
          return {
            ...participant,
            player: {
              id: participant.player_id,
              profile: {
                first_name: searchData?.first_name ?? '',
                last_name: searchData?.last_name ?? '',
                display_name: searchData?.display_name ?? null,
                profile_picture_url: searchData?.profile_picture_url ?? null,
              },
            },
          } as MatchParticipantWithPlayer;
        });
        onInviteSuccess(optimisticParticipants);
      }
      setSelectedPlayers([]);
    },
    onError: error => {
      console.error('Failed to invite players:', error);
      toast.error(t('common.tryAgain'));
    },
  });

  // Handle player selection toggle
  const handleTogglePlayer = useCallback((player: PlayerSearchResult) => {
    setSelectedPlayers(prev => {
      const exists = prev.some(p => p.id === player.id);
      if (exists) {
        return prev.filter(p => p.id !== player.id);
      }
      return [...prev, player];
    });
  }, []);

  // Handle remove from selected
  const handleRemovePlayer = useCallback((player: PlayerSearchResult) => {
    setSelectedPlayers(prev => prev.filter(p => p.id !== player.id));
  }, []);

  // Handle send invitations
  const handleSendInvitations = useCallback(() => {
    if (selectedPlayers.length === 0) return;
    const playerIds = selectedPlayers.map(p => p.id);
    invitePlayers(playerIds);
  }, [selectedPlayers, invitePlayers]);

  // Handle close (X) - dismiss step/sheet
  const handleClose = useCallback(() => {
    lightHaptic();
    onComplete();
  }, [onComplete]);

  // Handle load more (infinite scroll)
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Render player item
  const renderPlayer = useCallback(
    ({ item }: { item: PlayerSearchResult }) => (
      <PlayerCard
        player={item}
        isSelected={selectedPlayerIds.has(item.id)}
        onToggle={handleTogglePlayer}
        colors={colors}
        isDark={isDark}
      />
    ),
    [selectedPlayerIds, handleTogglePlayer, colors, isDark]
  );

  // Render footer (loading indicator for infinite scroll)
  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.buttonActive} />
      </View>
    );
  }, [isFetchingNextPage, colors.buttonActive]);

  // Render empty state
  const renderEmptyState = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.buttonActive} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.invite.searching')}
          </Text>
        </View>
      );
    }

    if (searchError) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('matchCreation.invite.searchError')}
          </Text>
        </View>
      );
    }

    if (searchQuery && players.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('matchCreation.invite.noPlayersFound')}
          </Text>
        </View>
      );
    }

    if (!searchQuery && players.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('matchCreation.invite.noPlayersAvailable')}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {t('matchCreation.invite.noPlayersAvailableDescription')}
          </Text>
        </View>
      );
    }

    return null;
  }, [isLoading, searchError, searchQuery, players.length, colors, t]);

  const handleTabChange = useCallback((tab: InviteTab) => {
    selectionHaptic();
    setActiveTab(tab);
  }, []);

  // Colors for InviteFromListsStep (uses buttonActive as primary for consistency)
  const listStepColors = useMemo(
    () => ({
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      border: colors.border,
      primary: colors.buttonActive,
      cardBackground: colors.cardBackground,
      background: colors.background,
      buttonActive: colors.buttonActive,
      buttonInactive: colors.buttonInactive,
      buttonTextActive: colors.buttonTextActive,
    }),
    [colors]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with optional close (X) */}
      <View style={styles.header}>
        <View style={styles.headerTextBlock}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('matchCreation.invite.title')}
          </Text>
          <Text size="sm" color={colors.textMuted}>
            {t('matchCreation.invite.description')}
          </Text>
        </View>
        {showCloseButton && (
          <TouchableOpacity
            onPress={handleClose}
            style={styles.headerCloseButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Tab bar: Players | From lists */}
      <View style={[styles.tabContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'players' && [
              styles.activeTab,
              { backgroundColor: colors.cardBackground },
            ],
          ]}
          onPress={() => handleTabChange('players')}
        >
          <Ionicons
            name="people-outline"
            size={18}
            color={activeTab === 'players' ? colors.buttonActive : colors.textMuted}
          />
          <Text
            size="sm"
            weight={activeTab === 'players' ? 'semibold' : 'medium'}
            style={{
              color: activeTab === 'players' ? colors.buttonActive : colors.textMuted,
              marginLeft: 6,
            }}
          >
            {t('matchCreation.invite.tabPlayers')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'lists' && [styles.activeTab, { backgroundColor: colors.cardBackground }],
          ]}
          onPress={() => handleTabChange('lists')}
        >
          <Ionicons
            name="list-outline"
            size={18}
            color={activeTab === 'lists' ? colors.buttonActive : colors.textMuted}
          />
          <Text
            size="sm"
            weight={activeTab === 'lists' ? 'semibold' : 'medium'}
            style={{
              color: activeTab === 'lists' ? colors.buttonActive : colors.textMuted,
              marginLeft: 6,
            }}
          >
            {t('matchCreation.invite.tabFromLists')}
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'players' && (
        <>
          {/* Selected players strip */}
          <SelectedPlayersStrip
            players={selectedPlayers}
            onRemove={handleRemovePlayer}
            colors={colors}
          />

          {/* Search input */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('matchCreation.invite.searchPlaceholder')}
            colors={colors}
            style={styles.searchBarWrapper}
          />

          {/* Player list */}
          <FlatList
            data={players}
            keyExtractor={item => item.id}
            renderItem={renderPlayer}
            ListEmptyComponent={renderEmptyState}
            ListFooterComponent={renderFooter}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={isDark ? '#FFFFFF' : colors.buttonActive}
                colors={[isDark ? '#FFFFFF' : colors.buttonActive]}
              />
            }
          />

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {/* Send invitations button */}
            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    selectedPlayers.length > 0 ? colors.buttonActive : colors.buttonInactive,
                },
              ]}
              onPress={handleSendInvitations}
              disabled={selectedPlayers.length === 0 || isInviting}
              activeOpacity={0.8}
            >
              {isInviting ? (
                <ActivityIndicator size="small" color={colors.buttonTextActive} />
              ) : (
                <Text
                  size="base"
                  weight="semibold"
                  color={selectedPlayers.length > 0 ? colors.buttonTextActive : colors.textMuted}
                >
                  {selectedPlayers.length > 0
                    ? t('matchCreation.invite.sendInvitations', {
                        count: selectedPlayers.length,
                      })
                    : t('matchCreation.invite.selectPlayers')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {activeTab === 'lists' && (
        <InviteFromListsStep
          matchId={matchId}
          colors={listStepColors}
          t={t}
          isDark={isDark}
          onShareSuccess={onComplete}
        />
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  headerTextBlock: {
    flex: 1,
  },
  headerCloseButton: {
    padding: spacingPixels[1],
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radiusPixels.md,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedStrip: {
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
  selectedStripContent: {
    gap: spacingPixels[3],
  },
  selectedAvatarContainer: {
    position: 'relative',
    // Add padding to create space for the remove button
    paddingTop: 4,
    paddingRight: 4,
  },
  selectedAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  selectedAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBarWrapper: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    flexGrow: 1,
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
    gap: spacingPixels[3],
  },
  avatarContainer: {
    width: 40,
    height: 40,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerInfo: {
    flex: 1,
    gap: spacingPixels[1],
  },
  ratingBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.sm,
    borderWidth: 1,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
  },
  emptyStateText: {
    marginTop: spacingPixels[2],
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacingPixels[3],
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    borderTopWidth: 1,
  },
  sendButton: {
    flex: 1,
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PlayerInviteStep;
