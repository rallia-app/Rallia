/**
 * AddMembersToGroupModal
 * Modal to select and add new members to an existing group chat
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text, Button } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { supabase } from '../../../lib/supabase';
import { spacingPixels, fontSizePixels, primary, radiusPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';

interface PlayerItem {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
}

export function AddMembersToGroupActionSheet({ payload }: SheetProps<'add-members-to-group'>) {
  const existingMemberIds = payload?.existingMemberIds ?? [];
  const currentUserId = payload?.currentUserId;
  const onMembersSelected = payload?.onMembersSelected;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allPlayers, setAllPlayers] = useState<PlayerItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleClose = useCallback(() => {
    setSelectedIds([]);
    setSearchQuery('');
    setHasLoaded(false);
    setAllPlayers([]);
    SheetManager.hide('add-members-to-group');
  }, []);

  // Load all active players when modal opens
  const loadPlayers = useCallback(async () => {
    if (hasLoaded || isLoading) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
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
        .limit(200);

      if (error) throw error;

      const players: PlayerItem[] = (data || [])
        .filter((p: unknown) => {
          const player = p as { id: string; profile: { first_name?: string } | null };
          // Exclude current user and existing members
          if (player.id === currentUserId) return false;
          if (existingMemberIds.includes(player.id)) return false;
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
            lastName: player.profile.last_name || null,
            displayName: player.profile.display_name || null,
            profilePictureUrl: player.profile.profile_picture_url || null,
          };
        });

      setAllPlayers(players);
      setHasLoaded(true);
    } catch (err) {
      console.error('Error loading players:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId, existingMemberIds, hasLoaded, isLoading]);

  // Load players when component mounts
  useEffect(() => {
    if (!hasLoaded) {
      loadPlayers();
    }
  }, [hasLoaded, loadPlayers]);

  // Filter by search query
  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) return allPlayers;

    const query = searchQuery.toLowerCase();
    return allPlayers.filter(p => {
      const fullName = `${p.firstName} ${p.lastName || ''}`.toLowerCase();
      const displayName = (p.displayName || '').toLowerCase();
      return fullName.includes(query) || displayName.includes(query);
    });
  }, [allPlayers, searchQuery]);

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
    return allPlayers.filter(p => selectedIds.includes(p.id));
  }, [allPlayers, selectedIds]);

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
                {player.profilePictureUrl ? (
                  <Image
                    source={{ uri: player.profilePictureUrl }}
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
              {player.firstName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // Render player item
  const renderPlayerItem = useCallback(
    ({ item }: { item: PlayerItem }) => {
      const isSelected = selectedIds.includes(item.id);
      const displayName = `${item.firstName} ${item.lastName || ''}`.trim();

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
            {item.profilePictureUrl ? (
              <Image source={{ uri: item.profilePictureUrl }} style={styles.avatarImage} />
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
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={primary[500]} />
            </View>
          ) : filteredPlayers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {searchQuery ? t('chat.noPlayersFound') : t('chat.noMorePlayersToAdd')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredPlayers}
              keyExtractor={item => item.id}
              renderItem={renderPlayerItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
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
export const AddMembersToGroupModal = AddMembersToGroupActionSheet;

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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  emptyText: {
    fontSize: fontSizePixels.base,
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
