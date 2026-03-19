import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { selectionHaptic, mediumHaptic } from '../../../utils/haptics';
import { useThemeStyles } from '../../../hooks';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';

interface Player {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  profile_picture_url: string | null;
  rating: string | null;
}

function PeerRatingRequestOverlayComponent({ payload }: SheetProps<'peer-rating-request'>) {
  const currentUserId = payload?.currentUserId ?? '';
  const sportId = payload?.sportId ?? '';
  const onSendRequests = payload?.onSendRequests;

  const { colors } = useThemeStyles();
  const [players, setPlayers] = useState<Player[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleClose = useCallback(() => {
    SheetManager.hide('peer-rating-request');
  }, []);

  const fetchMatchedPlayers = useCallback(async () => {
    if (!currentUserId || !sportId) return;

    try {
      setLoading(true);

      // Step 1: Find all matches where current user participated
      const { data: userMatches, error: matchError } = await supabase
        .from('match_participant')
        .select('match_id, match!inner(sport_id, status)')
        .eq('player_id', currentUserId);

      if (matchError) throw matchError;

      // Filter matches by sport and completed status
      const relevantMatchIds =
        userMatches
          ?.filter(
            (m: { match_id: string; match: Array<{ sport_id: string; status: string }> }) => {
              const matchData = m.match?.[0];
              return matchData?.sport_id === sportId && matchData?.status === 'completed';
            }
          )
          .map((m: { match_id: string }) => m.match_id) || [];

      if (relevantMatchIds.length === 0) {
        setPlayers([]);
        setFilteredPlayers([]);
        setLoading(false);
        return;
      }

      // Step 2: Find all OTHER participants in those matches
      const { data: opponents, error: opponentsError } = await supabase
        .from('match_participant')
        .select('player_id')
        .in('match_id', relevantMatchIds)
        .neq('player_id', currentUserId);

      if (opponentsError) throw opponentsError;

      // Get unique opponent IDs
      const uniqueOpponentIds = [
        ...new Set(opponents?.map((o: { player_id: string }) => o.player_id) || []),
      ];

      if (uniqueOpponentIds.length === 0) {
        setPlayers([]);
        setFilteredPlayers([]);
        setLoading(false);
        return;
      }

      // Step 3: Fetch opponent profiles
      const { data: opponentProfiles, error: profilesError } = await supabase
        .from('profile')
        .select('id, first_name, last_name, display_name, profile_picture_url')
        .in('id', uniqueOpponentIds);

      if (profilesError) throw profilesError;

      // Step 4: Fetch ratings for each opponent for this sport
      const { data: ratingsData, error: ratingsError } = await supabase
        .from('player_rating_score')
        .select(
          `
          player_id,
          is_certified,
          rating_score!player_rating_scores_rating_score_id_fkey (
            label,
            rating_system (
              sport_id
            )
          )
        `
        )
        .in('player_id', uniqueOpponentIds)
        .order('is_certified', { ascending: false });

      if (ratingsError) throw ratingsError;

      // Map ratings by player_id for this sport
      const ratingsMap = new Map<string, string>();
      ratingsData?.forEach(
        (rating: { player_id: string; is_certified: boolean; rating_score: unknown }) => {
          const ratingScore = rating.rating_score as {
            label?: string;
            rating_system?: { sport_id?: string };
          };
          const sportIdFromRating = ratingScore?.rating_system?.sport_id;

          // Only set if not already set (certified ratings come first due to ordering)
          if (sportIdFromRating === sportId && !ratingsMap.has(rating.player_id)) {
            ratingsMap.set(rating.player_id, ratingScore?.label || '');
          }
        }
      );

      // Combine profiles with ratings
      const playersWithRatings: Player[] = (opponentProfiles || []).map(
        (profile: {
          id: string;
          first_name: string;
          last_name: string;
          display_name: string | null;
          profile_picture_url: string | null;
        }) => ({
          id: profile.id,
          first_name: profile.first_name,
          last_name: profile.last_name,
          display_name: profile.display_name,
          profile_picture_url: profile.profile_picture_url,
          rating: ratingsMap.get(profile.id) || null,
        })
      );

      setPlayers(playersWithRatings);
      setFilteredPlayers(playersWithRatings);
    } catch (error) {
      Logger.error('Failed to fetch matched players', error as Error, { sportId, currentUserId });
    } finally {
      setLoading(false);
    }
  }, [currentUserId, sportId]);

  // Load data when sheet opens
  const handleSheetOpen = useCallback(() => {
    if (!hasLoaded && currentUserId && sportId) {
      setHasLoaded(true);
      fetchMatchedPlayers();
    }
  }, [hasLoaded, currentUserId, sportId, fetchMatchedPlayers]);

  // Reset state when sheet closes
  const handleSheetClose = useCallback(() => {
    setHasLoaded(false);
    setSelectedPlayers(new Set());
    setSearchQuery('');
    setPlayers([]);
    setFilteredPlayers([]);
  }, []);

  useEffect(() => {
    // Filter players based on search query
    if (searchQuery.trim() === '') {
      setFilteredPlayers(players);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = players.filter(
        player =>
          `${player.first_name} ${player.last_name}`.toLowerCase().includes(query) ||
          player.display_name?.toLowerCase().includes(query)
      );
      setFilteredPlayers(filtered);
    }
  }, [searchQuery, players]);

  const togglePlayerSelection = (playerId: string) => {
    selectionHaptic();
    setSelectedPlayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(playerId)) {
        newSet.delete(playerId);
      } else {
        newSet.add(playerId);
      }
      return newSet;
    });
  };

  const handleSendRequests = async () => {
    if (selectedPlayers.size === 0 || !onSendRequests) return;

    mediumHaptic();
    setSending(true);
    try {
      await onSendRequests(Array.from(selectedPlayers));
      setSelectedPlayers(new Set());
      setSearchQuery('');
      handleClose();
    } catch (error) {
      Logger.error('Failed to send peer rating requests', error as Error, {
        selectedCount: selectedPlayers.size,
      });
    } finally {
      setSending(false);
    }
  };

  const renderPlayerCard = (player: Player) => {
    const isSelected = selectedPlayers.has(player.id);

    return (
      <TouchableOpacity
        key={player.id}
        style={[
          styles.playerCard,
          { backgroundColor: colors.inputBackground },
          isSelected && [
            styles.playerCardSelected,
            { borderColor: colors.primary, backgroundColor: colors.inputBackground },
          ],
        ]}
        onPress={() => togglePlayerSelection(player.id)}
        activeOpacity={0.8}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          {player.profile_picture_url ? (
            <Image source={{ uri: player.profile_picture_url }} style={styles.avatar} />
          ) : (
            <View
              style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.divider }]}
            >
              <Ionicons name="person-outline" size={24} color={colors.textMuted} />
            </View>
          )}
          {isSelected && (
            <View style={[styles.checkmarkContainer, { backgroundColor: colors.card }]}>
              <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
            </View>
          )}
        </View>

        {/* Player Info */}
        <View style={styles.playerInfo}>
          <Text style={[styles.playerName, { color: colors.text }]}>
            {`${player.first_name} ${player.last_name}`.trim()}
          </Text>
          {player.display_name && (
            <Text style={[styles.playerUsername, { color: colors.textMuted }]}>
              @{player.display_name}
            </Text>
          )}
        </View>

        {/* Rating Badge */}
        {player.rating && (
          <View style={[styles.ratingBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.ratingText, { color: colors.primaryForeground }]}>
              {player.rating}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onBeforeShow={handleSheetOpen}
      onClose={handleSheetClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerPlaceholder} />
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            Request peer ratings
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Request ratings from players you've competed with to validate your skill level
          </Text>

          {/* Search Bar */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search players..."
            colors={colors}
            style={styles.searchContainer}
          />

          {/* Players List */}
          <ScrollView style={styles.playersList} showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                  Loading players...
                </Text>
              </View>
            ) : filteredPlayers.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={64} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  No players found
                </Text>
                <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                  {players.length === 0
                    ? 'Complete matches to request peer ratings'
                    : 'Try a different search term'}
                </Text>
              </View>
            ) : (
              <View style={styles.playersGrid}>
                {filteredPlayers.map(player => renderPlayerCard(player))}
              </View>
            )}
          </ScrollView>
        </View>

        {/* Send Requests Button */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: colors.primary },
              (selectedPlayers.size === 0 || sending) && [
                styles.sendButtonDisabled,
                { backgroundColor: colors.buttonInactive },
              ],
            ]}
            onPress={handleSendRequests}
            disabled={selectedPlayers.size === 0 || sending}
            activeOpacity={0.8}
          >
            {sending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Ionicons
                  name="paper-plane"
                  size={18}
                  color={colors.primaryForeground}
                  style={styles.sendIcon}
                />
                <Text style={[styles.sendButtonText, { color: colors.primaryForeground }]}>
                  Send {selectedPlayers.size > 0 ? `(${selectedPlayers.size})` : 'Requests'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

export const PeerRatingRequestActionSheet = PeerRatingRequestOverlayComponent;

// Keep old export for backwards compatibility during migration
const PeerRatingRequestOverlay = PeerRatingRequestActionSheet;
export default PeerRatingRequestOverlay;

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
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerPlaceholder: {
    width: 32,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  content: {
    flex: 1,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  searchContainer: {
    marginBottom: 16,
  },
  playersList: {
    flex: 1,
    marginBottom: 16,
  },
  playersGrid: {
    gap: 12,
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  playerCardSelected: {
    // borderColor and backgroundColor applied inline
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkContainer: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    borderRadius: 12,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  playerUsername: {
    fontSize: 13,
  },
  ratingBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderTopWidth: 1,
  },
  sendButton: {
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  sendButtonDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  sendIcon: {
    marginRight: 8,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
