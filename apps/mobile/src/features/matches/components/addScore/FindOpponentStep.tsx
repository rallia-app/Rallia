/**
 * Find Opponent Step
 *
 * Search for opponents within the app or add from phone contacts.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, Skeleton } from '@rallia/shared-components';
import { usePlayerSearch } from '@rallia/shared-hooks';
import type { PlayerSearchResult } from '@rallia/shared-services';
import { getHumanName, getProfilePictureUrl } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../../hooks';
import { useAuth } from '../../../../hooks';
import { useSport } from '../../../../context';
import { useAddScore } from './AddScoreContext';
import { ContactPickerModal } from './ContactPickerModal';
import { SearchBar } from '../../../../components/SearchBar';
import type { SelectedPlayer } from './types';

interface FindOpponentStepProps {
  onContinue: () => void;
}

export function FindOpponentStep({ onContinue }: FindOpponentStepProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const currentUserId = session?.user?.id;
  const { formData, updateFormData, matchType } = useAddScore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState<SelectedPlayer[]>(
    formData.opponents || []
  );
  const [showContactPicker, setShowContactPicker] = useState(false);

  // Use paginated player search — only enabled when there's a search query
  const {
    players,
    isLoading: isSearching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = usePlayerSearch({
    sportId: selectedSport?.id,
    currentUserId,
    searchQuery,
    pageSize: 20,
    enabled: !!selectedSport?.id && !!currentUserId && searchQuery.length >= 2,
  });

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Map PlayerSearchResult to SelectedPlayer for the AddScore flow
  const toSelectedPlayer = useCallback(
    (player: PlayerSearchResult): SelectedPlayer => ({
      id: player.id,
      firstName: player.first_name,
      lastName: player.last_name,
      profilePictureUrl: player.profile_picture_url ?? undefined,
    }),
    []
  );

  const handleSelectPlayer = useCallback(
    (player: SelectedPlayer | PlayerSearchResult) => {
      const member: SelectedPlayer =
        'firstName' in player
          ? (player as SelectedPlayer)
          : toSelectedPlayer(player as PlayerSearchResult);

      setSelectedPlayers(prev => {
        // Check if already selected
        if (prev.some(p => p.id === member.id)) {
          return prev.filter(p => p.id !== member.id);
        }
        // For singles, only allow 1 opponent
        if (matchType === 'single') {
          return [member];
        }
        // For doubles, allow up to 3 opponents (you + 3 others = 4 players total)
        if (prev.length < 3) {
          return [...prev, member];
        }
        return prev;
      });
    },
    [matchType, toSelectedPlayer]
  );

  const handleAddFromContacts = useCallback(() => {
    setShowContactPicker(true);
  }, []);

  const handleContactSelected = useCallback(
    (player: SelectedPlayer) => {
      handleSelectPlayer(player);
    },
    [handleSelectPlayer]
  );

  const handleContinue = useCallback(() => {
    updateFormData({ opponents: selectedPlayers });
    onContinue();
  }, [selectedPlayers, updateFormData, onContinue]);

  const isPlayerSelected = (playerId: string) => selectedPlayers.some(p => p.id === playerId);

  const canContinue =
    matchType === 'single' ? selectedPlayers.length >= 1 : selectedPlayers.length >= 3; // For doubles, need exactly 3 players (you + 3 others = 4 total)

  // Theme-aware skeleton colors
  const skeletonBg = isDark ? '#2C2C2E' : '#E1E9EE';
  const skeletonHighlight = isDark ? '#3C3C3E' : '#F2F8FC';

  const renderPlayerSkeleton = () => (
    <View>
      {[1, 2, 3, 4].map(i => (
        <View
          key={i}
          style={[
            styles.playerItem,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
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

  const renderListFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isFetchingNextPage, colors.primary]);

  const renderPlayerItem = ({ item }: { item: PlayerSearchResult }) => {
    const isSelected = isPlayerSelected(item.id);
    return (
      <TouchableOpacity
        style={[
          styles.playerItem,
          {
            backgroundColor: isSelected ? 'rgba(64, 156, 255, 0.1)' : colors.cardBackground,
            borderColor: isSelected ? colors.primary : colors.border,
          },
        ]}
        onPress={() => handleSelectPlayer(item)}
        activeOpacity={0.7}
      >
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
            {getHumanName(item)}
          </Text>
        </View>
        {isSelected && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Title */}
      <Text weight="bold" size="xl" style={[styles.title, { color: colors.text }]}>
        {matchType === 'double'
          ? t('addScore.findOpponent.titleDouble')
          : t('addScore.findOpponent.title')}
      </Text>
      {matchType === 'double' && (
        <Text size="sm" style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('addScore.findOpponent.subtitle')}
        </Text>
      )}

      {/* Search input */}
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={t('addScore.findOpponent.searchPlaceholder')}
        colors={colors}
        style={styles.searchBarWrapper}
      />

      {/* Selected players - shown below search bar */}
      {selectedPlayers.length > 0 && (
        <View style={styles.selectedPlayersRow}>
          {selectedPlayers.map(player => (
            <TouchableOpacity
              key={player.id}
              style={styles.selectedPlayerChip}
              onPress={() => handleSelectPlayer(player)}
            >
              <View style={styles.selectedPlayerAvatarContainer}>
                <View
                  style={[
                    styles.selectedPlayerAvatar,
                    { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                  ]}
                >
                  {player.profilePictureUrl ? (
                    <Image
                      source={{ uri: getProfilePictureUrl(player.profilePictureUrl) ?? '' }}
                      style={styles.selectedAvatarImage}
                    />
                  ) : (
                    <Ionicons name="person-outline" size={20} color={colors.textMuted} />
                  )}
                </View>
                <View style={[styles.removePlayerBadge, { backgroundColor: colors.primary }]}>
                  <Ionicons name="close-outline" size={10} color="#fff" />
                </View>
              </View>
              <Text
                size="sm"
                style={[styles.selectedPlayerName, { color: colors.text }]}
                numberOfLines={1}
              >
                {player.firstName} {player.lastName || ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Add from contacts button - hidden when searching */}
      {searchQuery.length < 2 && (
        <TouchableOpacity
          style={[styles.addFromContactsButton, { borderColor: colors.border }]}
          onPress={handleAddFromContacts}
        >
          <View style={[styles.contactsIcon, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
            <Ionicons name="person-add" size={20} color={colors.primary} />
          </View>
          <View style={styles.contactsTextContainer}>
            <Text weight="medium" style={{ color: colors.primary }}>
              {t('addScore.findOpponent.addPlayer')}
            </Text>
            <Text size="sm" style={{ color: colors.textSecondary }}>
              {t('addScore.findOpponent.fromPhoneContacts')}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Search results or empty state */}
      {searchQuery.length < 2 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="search-outline" size={64} color={colors.textMuted} />
          </View>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
            {t('addScore.findOpponent.searchHint')}
          </Text>
        </View>
      ) : isSearching ? (
        renderPlayerSkeleton()
      ) : players.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
            {t('addScore.findOpponent.noPlayersFound', { query: searchQuery })}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <Text
            size="xs"
            weight="medium"
            style={[styles.sectionHeader, { color: colors.textMuted }]}
          >
            {t('addScore.findOpponent.players')}
          </Text>
          <FlatList
            data={players}
            keyExtractor={item => item.id}
            renderItem={renderPlayerItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderListFooter}
          />
        </View>
      )}

      {/* Continue button */}
      <View style={styles.bottomButton}>
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!canContinue}
          style={[!canContinue && styles.disabledButton]}
        >
          Continue
        </Button>
      </View>

      {/* Contact Picker Modal */}
      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => setShowContactPicker(false)}
        onSelectContact={handleContactSelected}
        excludeIds={selectedPlayers.map(p => p.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    marginBottom: 16,
  },
  searchBarWrapper: {
    marginBottom: 16,
  },
  addFromContactsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 24,
  },
  contactsIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactsTextContainer: {
    marginLeft: 12,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    marginBottom: 16,
    opacity: 0.5,
  },
  listContent: {
    paddingBottom: 100,
  },
  playerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
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
  selectedPlayersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
    gap: 12,
  },
  selectedPlayerChip: {
    alignItems: 'center',
    width: 60,
  },
  selectedPlayerAvatarContainer: {
    position: 'relative',
  },
  selectedPlayerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  selectedAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  removePlayerBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedPlayerName: {
    marginTop: 4,
    textAlign: 'center',
    width: '100%',
  },
  sectionHeader: {
    marginBottom: 12,
    letterSpacing: 1,
  },
  bottomButton: {
    paddingVertical: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
