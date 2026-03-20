import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { selectionHaptic, mediumHaptic } from '../../../utils/haptics';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import { SearchBar } from '../../../components/SearchBar';
import RatingBadge from '../../../components/RatingBadge';

interface ReferenceRequestOverlayProps {
  visible: boolean;
  onClose: () => void;
  currentUserId: string;
  sportId: string;
  /** Current user's rating score for this sport */
  currentUserRatingScore?: number;
  /** Current user's player_rating_score_id for this sport */
  currentUserRatingScoreId?: string;
  /** The rating system code (e.g., 'NTRP', 'DUPR') */
  ratingSystemCode?: string;
  onSendRequests: (selectedPlayerIds: string[]) => Promise<void>;
}

interface Player {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  profile_picture_url: string | null;
  rating: string | null;
  ratingScore: number | null;
  isCertified: boolean;
  playerRatingScoreId: string | null;
}

// Interface for Supabase rating response
interface RatingResponse {
  id: string;
  player_id: string;
  source: string;
  is_certified: boolean;
  badge_status: string | null;
  rating_score: {
    id: string;
    label: string;
    value: number;
    rating_system: {
      id: string;
      sport_id: string;
      code: string;
    }[];
  }[];
}

export function ReferenceRequestActionSheet({ payload }: SheetProps<'reference-request'>) {
  const currentUserId = payload?.currentUserId || '';
  const sportId = payload?.sportId || '';
  const onClose = () => SheetManager.hide('reference-request');
  const currentUserRatingScore = payload?.currentUserRatingScore;
  const currentUserRatingScoreId = payload?.currentUserRatingScoreId;
  const ratingSystemCode = payload?.ratingSystemCode;
  const onSendRequests = payload?.onSendRequests;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const [players, setPlayers] = useState<Player[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<Player[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchEligiblePlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, sportId]);

  useEffect(() => {
    // Filter players based on search query
    if (searchQuery.trim() === '') {
      setFilteredPlayers(players);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = players.filter(
        player =>
          player.first_name.toLowerCase().includes(query) ||
          player.last_name.toLowerCase().includes(query) ||
          player.display_name?.toLowerCase().includes(query)
      );
      setFilteredPlayers(filtered);
    }
  }, [searchQuery, players]);

  const fetchEligiblePlayers = async () => {
    try {
      setLoading(true);

      // Step 1: Find ALL players with ratings for this sport at same/higher level
      // (both certified and uncertified - user can request from anyone,
      // but only certified references count toward certification requirement)
      const { data: allRatings, error: ratingsError } = await supabase
        .from('player_rating_score')
        .select(
          `
          id,
          player_id,
          source,
          is_certified,
          badge_status,
          rating_score:rating_score_id (
            id,
            label,
            value,
            rating_system:rating_system_id (
              id,
              sport_id,
              code
            )
          )
        `
        )
        .neq('player_id', currentUserId); // Exclude current user

      if (ratingsError) throw ratingsError;

      // Filter by sport, certified status, and level (same or higher than current user)
      const sportEligibleRatings = ((allRatings || []) as RatingResponse[]).filter(rating => {
        const ratingScore = Array.isArray(rating.rating_score)
          ? rating.rating_score[0]
          : rating.rating_score;
        const ratingSystem = Array.isArray(ratingScore?.rating_system)
          ? ratingScore?.rating_system[0]
          : ratingScore?.rating_system;

        // Must be same sport
        if (ratingSystem?.sport_id !== sportId) return false;

        // Must be certified
        const isCertified = rating.is_certified || rating.badge_status === 'certified';
        if (!isCertified) return false;

        // If current user has a rating, only show players at same or higher level
        if (currentUserRatingScore && ratingScore?.value) {
          return ratingScore.value >= currentUserRatingScore;
        }

        return true;
      });

      const uniquePlayerIds = [...new Set(sportEligibleRatings.map(r => r.player_id))];

      if (uniquePlayerIds.length === 0) {
        setPlayers([]);
        setFilteredPlayers([]);
        setLoading(false);
        return;
      }

      // Step 2: Fetch player profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profile')
        .select('id, first_name, last_name, display_name, profile_picture_url')
        .in('id', uniquePlayerIds);

      if (profilesError) throw profilesError;

      // Step 3: Map ratings by player_id
      // Note: Only references from certified players count toward certification requirement
      const ratingsMap = new Map<
        string,
        {
          display_label: string;
          ratingScore: number | null;
          isCertified: boolean;
          playerRatingScoreId: string;
        }
      >();

      sportEligibleRatings.forEach(rating => {
        const ratingScore = Array.isArray(rating.rating_score)
          ? rating.rating_score[0]
          : rating.rating_score;
        // Check both is_certified flag and badge_status for certification
        const isCertified = rating.is_certified || rating.badge_status === 'certified';

        // If player already in map, prefer the certified rating entry
        const existing = ratingsMap.get(rating.player_id);
        if (!existing || (!existing.isCertified && isCertified)) {
          ratingsMap.set(rating.player_id, {
            display_label: ratingScore?.label || '',
            ratingScore: ratingScore?.value || null,
            isCertified,
            playerRatingScoreId: rating.id,
          });
        }
      });

      // Step 4: Combine profiles with ratings
      const playersWithRatings: Player[] = (profiles || []).map(
        (profile: {
          id: string;
          first_name: string;
          last_name: string;
          display_name: string | null;
          profile_picture_url: string | null;
        }) => {
          const ratingInfo = ratingsMap.get(profile.id);
          return {
            id: profile.id,
            first_name: profile.first_name,
            last_name: profile.last_name,
            display_name: profile.display_name,
            profile_picture_url: profile.profile_picture_url,
            rating: ratingInfo?.display_label || null,
            ratingScore: ratingInfo?.ratingScore || null,
            isCertified: ratingInfo?.isCertified || false,
            playerRatingScoreId: ratingInfo?.playerRatingScoreId || null,
          };
        }
      );

      // Sort: certified players first, then by rating score (highest first)
      playersWithRatings.sort((a, b) => {
        // Certified players come first
        if (a.isCertified !== b.isCertified) {
          return a.isCertified ? -1 : 1;
        }
        // Then sort by rating score
        return (b.ratingScore || 0) - (a.ratingScore || 0);
      });

      setPlayers(playersWithRatings);
      setFilteredPlayers(playersWithRatings);
    } catch (error) {
      Logger.error('Failed to fetch eligible players', error as Error, { sportId });
    } finally {
      setLoading(false);
    }
  };

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
    if (selectedPlayers.size === 0 || sending) return;

    mediumHaptic();
    setSending(true);
    try {
      await onSendRequests?.(Array.from(selectedPlayers));
      setSelectedPlayers(new Set());
      setSearchQuery('');
      SheetManager.hide('reference-request');
    } catch (error) {
      Logger.error('Failed to send reference requests', error as Error, {
        count: selectedPlayers.size,
        sportId,
      });
    } finally {
      setSending(false);
    }
  };

  const isDark = useColorScheme() === 'dark';

  const renderPlayerCard = (player: Player) => {
    const isSelected = selectedPlayers.has(player.id);
    const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Unknown';

    return (
      <TouchableOpacity
        key={player.id}
        style={[
          styles.playerCard,
          {
            backgroundColor: colors.cardBackground,
            borderColor: isSelected ? colors.primary : colors.border,
          },
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
              style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}
            >
              <Ionicons name="person-outline" size={24} color={colors.textMuted} />
            </View>
          )}
        </View>

        {/* Player Info */}
        <View style={styles.playerInfo}>
          <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
            {displayName}
          </Text>
          {player.rating && (
            <View style={styles.badgesRow}>
              <RatingBadge
                ratingValue={player.ratingScore}
                ratingLabel={player.rating}
                certificationStatus={player.isCertified ? 'certified' : 'self_declared'}
                isDark={isDark}
                size="sm"
              />
            </View>
          )}
        </View>

        {/* Selection chevron */}
        <Ionicons
          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={isSelected ? colors.primary : colors.textMuted}
        />
      </TouchableOpacity>
    );
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text
              weight="semibold"
              size="lg"
              style={{ color: colors.text }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {t('profile.certification.referenceRequest.title')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {t('profile.certification.referenceRequest.description')}
          </Text>

          {/* Search Bar */}
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('profile.certification.referenceRequest.searchPlaceholder')}
            colors={colors}
            style={styles.searchContainer}
          />

          {/* Players List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                {t('common.loading')}
              </Text>
            </View>
          ) : filteredPlayers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={64} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {t('profile.certification.referenceRequest.noPlayersFound')}
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                {players.length === 0
                  ? t('profile.certification.referenceRequest.noEligiblePlayers')
                  : t('common.tryDifferentSearch')}
              </Text>
            </View>
          ) : (
            <View style={styles.playersGrid}>
              {filteredPlayers.map(player => renderPlayerCard(player))}
            </View>
          )}
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (selectedPlayers.size === 0 || sending) && { opacity: 0.6 },
            ]}
            onPress={handleSendRequests}
            disabled={selectedPlayers.size === 0 || sending}
            activeOpacity={0.8}
          >
            {sending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                {t('profile.certification.referenceRequest.sendRequest')}
                {selectedPlayers.size > 0
                  ? ` (${t('profile.certification.referenceRequest.selectedCount', { count: selectedPlayers.size })})`
                  : ''}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
const ReferenceRequestOverlay: React.FC<ReferenceRequestOverlayProps> = ({
  visible,
  onClose,
  currentUserId,
  sportId,
  currentUserRatingScore,
  currentUserRatingScoreId,
  ratingSystemCode,
  onSendRequests,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('reference-request', {
        payload: {
          currentUserId,
          sportId,
          currentUserRatingScore,
          currentUserRatingScoreId,
          ratingSystemCode,
          onSendRequests,
        },
      });
    }
  }, [
    visible,
    currentUserId,
    sportId,
    currentUserRatingScore,
    currentUserRatingScoreId,
    ratingSystemCode,
    onSendRequests,
  ]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('reference-request');
    }
  }, [visible]);

  return null;
};

export default ReferenceRequestOverlay;

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
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
    lineHeight: 20,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  warningText: {
    fontSize: 14,
    flex: 1,
  },
  searchContainer: {
    marginBottom: 16,
  },
  playersGrid: {
    gap: spacingPixels[2],
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: spacingPixels[3],
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
  playerInfo: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[0.5],
    flexWrap: 'wrap',
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radiusPixels.lg,
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
