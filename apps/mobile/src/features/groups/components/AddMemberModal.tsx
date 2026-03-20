/**
 * AddMemberModal
 * Modal for adding a new member to a group
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text, useToast } from '@rallia/shared-components';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useAuth, useTranslation } from '../../../hooks';
import { useDebounce, useAddGroupMember } from '@rallia/shared-hooks';
import { supabase } from '@rallia/shared-services';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';

interface PlayerProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  city: string | null;
  profile_picture_url: string | null;
}

export function AddMemberActionSheet({ payload }: SheetProps<'add-member'>) {
  const groupId = payload?.groupId ?? '';
  const currentMemberIds = payload?.currentMemberIds ?? [];
  const onSuccess = payload?.onSuccess;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const toast = useToast();
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestedPlayers, setSuggestedPlayers] = useState<PlayerProfile[]>([]);
  const [searchResults, setSearchResults] = useState<PlayerProfile[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [addedMemberIds, setAddedMemberIds] = useState<string[]>([]);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const debouncedSearch = useDebounce(searchQuery, 300);

  const addMemberMutation = useAddGroupMember();

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setAddedMemberIds([]);
    setAddingMemberId(null);
    SheetManager.hide('add-member');
  }, []);

  // Load suggested players when modal opens
  useEffect(() => {
    const loadSuggestedPlayers = async () => {
      if (!playerId) return;

      setIsLoadingSuggestions(true);
      try {
        // Get profiles of players (users who have a player record), excluding current user
        const { data, error } = await supabase
          .from('profile')
          .select(
            `
            id,
            first_name,
            last_name,
            display_name,
            profile_picture_url,
            player!inner(id, city)
          `
          )
          .neq('id', playerId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        // Map to flatten structure (profile data only, player join ensures they are players)
        const players = (data || []).map(p => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          display_name: p.display_name,
          city: (p.player as { city?: string | null })?.city ?? null,
          profile_picture_url: p.profile_picture_url,
        }));
        setSuggestedPlayers(players);
      } catch (error) {
        console.error('Error loading suggested players:', error);
        setSuggestedPlayers([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };

    loadSuggestedPlayers();
  }, [playerId]);

  // Search players when query changes
  useEffect(() => {
    const searchPlayers = async () => {
      if (debouncedSearch.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const searchTerm = `%${debouncedSearch}%`;
        const { data, error } = await supabase
          .from('profile')
          .select(
            `
            id,
            first_name,
            last_name,
            display_name,
            profile_picture_url,
            player!inner(id, city)
          `
          )
          .neq('id', playerId || '')
          .or(
            `first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},display_name.ilike.${searchTerm}`
          )
          .limit(20);

        if (error) throw error;
        // Map to flatten structure
        const players = (data || []).map(p => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          display_name: p.display_name,
          city: (p.player as { city?: string | null })?.city ?? null,
          profile_picture_url: p.profile_picture_url,
        }));
        setSearchResults(players);
      } catch (error) {
        console.error('Error searching players:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    searchPlayers();
  }, [debouncedSearch, playerId]);

  // Filter out current members and recently added members from results
  const filteredResults = useMemo(() => {
    const sourceList = searchQuery.length >= 2 ? searchResults : suggestedPlayers;
    const excludedIds = [...currentMemberIds, ...addedMemberIds];
    return sourceList.filter(player => !excludedIds.includes(player.id));
  }, [searchResults, suggestedPlayers, currentMemberIds, addedMemberIds, searchQuery]);

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

  const renderPlayerItem = useCallback(
    ({ item }: { item: PlayerProfile }) => {
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
        {isLoadingSuggestions || isSearching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : filteredResults.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="person-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textSecondary, marginTop: 12 }}>
              {searchQuery.length >= 2
                ? t('groups.noPlayersFound')
                : t('groups.noPlayersAvailable')}
            </Text>
          </View>
        ) : (
          <>
            {searchQuery.length < 2 && (
              <View style={styles.suggestedHeader}>
                <Text
                  size="sm"
                  style={{
                    color: colors.textSecondary,
                    paddingHorizontal: spacingPixels[4],
                    paddingVertical: spacingPixels[2],
                  }}
                >
                  {t('groups.suggestedPlayers')}
                </Text>
              </View>
            )}
            <FlatList
              data={filteredResults}
              renderItem={renderPlayerItem}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
            />
          </>
        )}
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const AddMemberModal = AddMemberActionSheet;

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
  suggestedHeader: {
    paddingTop: spacingPixels[2],
  },
  listContent: {
    paddingBottom: spacingPixels[4],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
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
