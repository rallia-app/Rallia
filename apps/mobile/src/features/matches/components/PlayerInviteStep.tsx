/**
 * Player Invite Step
 *
 * Component for inviting players to a match after creation.
 * Shows a searchable list of players active in the same sport.
 */

import React, { useState, useCallback, useMemo, useEffect, type ComponentProps } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
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
import { usePlayerSearch, useInviteToMatch, useMatchInviteCandidates } from '@rallia/shared-hooks';
import type { InviteCandidate } from '@rallia/shared-hooks';
import type {
  PlayerSearchResult,
  ReputationTier,
  ReputationDisplay,
  DayFilter,
} from '@rallia/shared-services';
import { getTierConfig, supabase, Logger } from '@rallia/shared-services';
import type { MatchParticipantWithPlayer } from '@rallia/shared-types';

import type { TranslationKey, TranslationOptions } from '#/hooks/useTranslation';
import { SearchBar } from '#/components/SearchBar';
import RatingBadge from '#/components/RatingBadge';
import ReputationBadge from '#/components/ReputationBadge';
import ReasonBadge, { type ReasonKey } from '#/components/ReasonBadge';
import * as Analytics from '#/services/analytics';

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
  /** Confirmation line shown above the header (e.g. "Game created!" when this step is the post-creation default) */
  successNote?: string;
  /** Secondary actions rendered as a chip row under the header (share, view game, ...) */
  secondaryActions?: {
    key: string;
    label: string;
    icon: ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    /** Optional brand tint (e.g. Facebook blue); defaults to the theme accent */
    tint?: string;
    loading?: boolean;
  }[];
  /** Optional callback to navigate back (e.g. to the previous step in a wizard). When provided, a back chevron is rendered in the header. */
  onBack?: () => void;
}

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
// PLAYER ROW COMPONENT
// =============================================================================
// Mirrors ParticipantRow (tournament/league rosters): flat surface, hairline
// dividers, 40pt avatar, badges under the name — no card chrome. The invite
// additions are the trailing distance + selection checkbox and reason badges.

interface PlayerRowProps {
  player: PlayerSearchResult;
  isSelected: boolean;
  onToggle: (player: PlayerSearchResult) => void;
  colors: PlayerInviteStepProps['colors'];
  isDark: boolean;
  reputationDisplay?: ReputationDisplay;
  /** Why this player is suggested — rendered as badges in the same family */
  reasons?: { key: ReasonKey; label: string }[];
  /** Pre-formatted distance from the game (e.g. "12 km") */
  distanceLabel?: string;
  /** Hairline separator above the row; set on every row after the first. */
  showDivider?: boolean;
}

const PlayerRow: React.FC<PlayerRowProps> = ({
  player,
  isSelected,
  onToggle,
  colors,
  isDark,
  reputationDisplay,
  reasons,
  distanceLabel,
  showDivider,
}) => {
  const handlePress = () => {
    selectionHaptic();
    onToggle(player);
  };

  const fullName = `${player.first_name} ${player.last_name}`.trim();

  return (
    <TouchableOpacity
      style={[
        styles.playerRow,
        showDivider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        isSelected && { backgroundColor: `${colors.buttonActive}0D` },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={fullName}
    >
      {player.profile_picture_url ? (
        <Image
          source={{ uri: getProfilePictureUrl(player.profile_picture_url) || '' }}
          style={styles.avatar}
        />
      ) : (
        <View
          style={[
            styles.avatar,
            styles.avatarFallback,
            { backgroundColor: `${colors.buttonActive}1A` },
          ]}
        >
          <Text size="sm" weight="semibold" color={colors.buttonActive}>
            {getInitials(fullName)}
          </Text>
        </View>
      )}

      <View style={styles.playerInfo}>
        <Text size="base" weight="medium" color={colors.text} numberOfLines={1}>
          {fullName}
        </Text>
        {(player.rating || reputationDisplay || (reasons && reasons.length > 0)) && (
          <View style={styles.badgesRow}>
            {player.rating && (
              <RatingBadge
                ratingValue={player.rating.value}
                ratingLabel={player.rating.label}
                certificationStatus={player.rating.badge_status}
                isDark={isDark}
                size="sm"
              />
            )}
            {reputationDisplay && (
              <ReputationBadge reputationDisplay={reputationDisplay} isDark={isDark} size="sm" />
            )}
            {reasons?.map(reason => (
              <ReasonBadge
                key={reason.key}
                reason={reason.key}
                label={reason.label}
                isDark={isDark}
                size="sm"
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.trailing}>
        {distanceLabel && (
          <Text size="xs" color={colors.textMuted}>
            {distanceLabel}
          </Text>
        )}
        <View
          style={[
            styles.checkCircle,
            {
              backgroundColor: isSelected ? colors.buttonActive : 'transparent',
              borderColor: isSelected ? colors.buttonActive : colors.border,
            },
          ]}
        >
          {isSelected && <Ionicons name="checkmark" size={14} color={colors.buttonTextActive} />}
        </View>
      </View>
    </TouchableOpacity>
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
  successNote,
  secondaryActions,
  onBack,
}) => {
  const toast = useToast();

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

  // Match context (location + slot) so candidates can be ranked by proximity
  // and availability at game time instead of arriving in id order.
  const [matchContext, setMatchContext] = useState<{
    latitude?: number;
    longitude?: number;
    day?: DayFilter;
    hour?: number;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('match')
        .select(
          'match_date, start_time, custom_latitude, custom_longitude, facility:facility_id(latitude, longitude)'
        )
        .eq('id', matchId)
        .single();
      if (!alive) return;
      if (error || !data) {
        Logger.error('PlayerInviteStep: match context fetch failed', error);
        setMatchContext({});
        return;
      }
      // supabase-js types to-one embeds as arrays in some schema versions; handle both.
      const facilityRaw = data.facility as unknown;
      const facility = (Array.isArray(facilityRaw) ? facilityRaw[0] : facilityRaw) as {
        latitude: number | null;
        longitude: number | null;
      } | null;
      const lat = facility?.latitude ?? data.custom_latitude;
      const lng = facility?.longitude ?? data.custom_longitude;
      const days: DayFilter[] = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      // match_date is the match's own local calendar date; UTC parse keeps the weekday exact.
      const day = data.match_date
        ? days[new Date(`${data.match_date}T00:00:00Z`).getUTCDay()]
        : undefined;
      const hour = data.start_time
        ? Number.parseInt(String(data.start_time).slice(0, 2), 10)
        : undefined;
      setMatchContext({
        latitude: lat != null ? Number(lat) : undefined,
        longitude: lng != null ? Number(lng) : undefined,
        day,
        hour: Number.isFinite(hour) ? hour : undefined,
      });
    })();
    return () => {
      alive = false;
    };
  }, [matchId]);

  // Browse mode: one compatibility-ranked list from get_match_invite_candidates
  // (availability at game time, responsiveness, skill fit, pair history, ...).
  // Typing a search switches to the plain name search below.
  const usingRankedList = searchQuery.length === 0;

  const {
    candidates: rankedCandidates,
    isLoading: isLoadingRanked,
    isFetchingNextPage: isFetchingNextRanked,
    hasNextPage: hasNextRanked,
    fetchNextPage: fetchNextRanked,
    refetch: refetchRanked,
    error: rankedError,
  } = useMatchInviteCandidates({
    matchId,
    excludePlayerIds: effectiveExcludePlayerIds,
    enabled: usingRankedList,
  });

  // Name search (query typed) — distance-ranked once match coordinates are known.
  const {
    players: searchPlayers,
    isLoading: isLoadingSearch,
    isFetchingNextPage: isFetchingNextSearch,
    hasNextPage: hasNextSearch,
    fetchNextPage: fetchNextSearch,
    refetch: refetchSearch,
    error: searchError,
  } = usePlayerSearch({
    sportId,
    currentUserId: hostId,
    searchQuery,
    excludePlayerIds: effectiveExcludePlayerIds,
    latitude: matchContext?.latitude,
    longitude: matchContext?.longitude,
    enabled: !usingRankedList && matchContext !== null,
  });

  // Unified view of whichever source is live.
  const players = usingRankedList ? rankedCandidates : searchPlayers;
  const isLoading = usingRankedList ? isLoadingRanked : isLoadingSearch;
  const isFetchingNextPage = usingRankedList ? isFetchingNextRanked : isFetchingNextSearch;
  const hasNextPage = usingRankedList ? hasNextRanked : hasNextSearch;
  const fetchNextPage = usingRankedList ? fetchNextRanked : fetchNextSearch;
  const refetch = usingRankedList ? refetchRanked : refetchSearch;
  const listError = usingRankedList ? rankedError : searchError;

  // Invite mutation - do not close sheet on success so user can also share with contacts
  const { invitePlayers, isInviting } = useInviteToMatch({
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
    Analytics.inviteToMatchSent({ invite_count: selectedPlayers.length, match_id: matchId });
    const playerIds = selectedPlayers.map(p => p.id);
    invitePlayers({ matchId, playerIds });
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

  // Derive reputation display from search results (no extra API calls)
  const getReputationDisplay = useCallback(
    (player: PlayerSearchResult): ReputationDisplay | undefined => {
      if (!player.reputation_tier || !player.reputation_is_public) return undefined;
      const tier = player.reputation_tier as ReputationTier;
      const tierConfig = getTierConfig(tier);
      return {
        tier,
        score: player.reputation_score ?? 100,
        isVisible: player.reputation_is_public,
        tierLabel: tierConfig.label,
        tierColor: tierConfig.color,
        tierIcon: tierConfig.icon,
      };
    },
    []
  );

  // Top-2 ranking reasons as chip labels (priority: strongest signals first).
  const getReasons = useCallback(
    (item: PlayerSearchResult): { key: ReasonKey; label: string }[] | undefined => {
      const reasons = (item as InviteCandidate).reasons;
      if (!reasons) return undefined;
      const out: { key: ReasonKey; label: string }[] = [];
      if (reasons.playedTogether)
        out.push({ key: 'playedTogether', label: t('matchCreation.invite.chips.playedTogether') });
      if (reasons.availableAtSlot)
        out.push({ key: 'availableAtSlot', label: t('matchCreation.invite.freeAtGameTime') });
      if (reasons.respondsFast)
        out.push({ key: 'responsive', label: t('matchCreation.invite.chips.responsive') });
      if (reasons.sameRating)
        out.push({ key: 'sameRating', label: t('matchCreation.invite.chips.sameRating') });
      if (reasons.activeRecently)
        out.push({ key: 'activeRecently', label: t('matchCreation.invite.chips.activeRecently') });
      if (reasons.favoriteFacility)
        out.push({ key: 'favoriteFacility', label: t('matchCreation.invite.chips.playsHere') });
      // Two strongest reasons only: more than that wraps into a third row and
      // makes every card tall without adding decision value.
      return out.slice(0, 2);
    },
    [t]
  );

  // Distance from the game, rounded for glanceability.
  const getDistanceLabel = useCallback((item: PlayerSearchResult): string | undefined => {
    const meters = item.distance_meters;
    if (meters == null) return undefined;
    const km = meters / 1000;
    return km < 1 ? '<1 km' : `${Math.round(km)} km`;
  }, []);

  // Render player item
  const renderPlayer = useCallback(
    ({ item, index }: { item: PlayerSearchResult; index: number }) => (
      <PlayerRow
        player={item}
        isSelected={selectedPlayerIds.has(item.id)}
        onToggle={handleTogglePlayer}
        colors={colors}
        isDark={isDark}
        reputationDisplay={getReputationDisplay(item)}
        reasons={getReasons(item)}
        distanceLabel={getDistanceLabel(item)}
        showDivider={index > 0}
      />
    ),
    [
      selectedPlayerIds,
      handleTogglePlayer,
      colors,
      isDark,
      getReputationDisplay,
      getReasons,
      getDistanceLabel,
    ]
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

    if (listError) {
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
  }, [isLoading, listError, searchQuery, players.length, colors, t]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Creation confirmation (when this step is the post-creation default) */}
      {successNote && (
        <View style={[styles.successNote, { backgroundColor: `${colors.buttonActive}12` }]}>
          <Ionicons name="checkmark-circle" size={18} color={colors.buttonActive} />
          <Text size="sm" weight="semibold" color={colors.buttonActive}>
            {successNote}
          </Text>
        </View>
      )}

      {/* Header with optional back (chevron) and close (X) */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity
            onPress={() => {
              selectionHaptic();
              onBack();
            }}
            style={styles.headerBackButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
          </TouchableOpacity>
        )}
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

      {/* Secondary actions (share, view game, ...) — alternatives to inviting
          from the list, kept on this screen rather than a separate panel */}
      {secondaryActions && secondaryActions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.secondaryActionsScroll}
          contentContainerStyle={styles.secondaryActionsRow}
          keyboardShouldPersistTaps="handled"
        >
          {secondaryActions.map(action => {
            const tint = action.tint ?? colors.buttonActive;
            return (
              <TouchableOpacity
                key={action.key}
                style={[styles.secondaryAction, { borderColor: `${tint}55` }]}
                onPress={() => {
                  lightHaptic();
                  action.onPress();
                }}
                disabled={action.loading}
                activeOpacity={0.7}
              >
                {action.loading ? (
                  <ActivityIndicator size="small" color={tint} />
                ) : (
                  <>
                    <Ionicons name={action.icon} size={15} color={tint} />
                    <Text size="sm" weight="semibold" color={tint}>
                      {action.label}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

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
        ListHeaderComponent={
          usingRankedList && players.length > 0 ? (
            <Text size="sm" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
              {t('matchCreation.invite.suggestedForGame')}
            </Text>
          ) : null
        }
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
  headerBackButton: {
    padding: spacingPixels[1],
    marginRight: spacingPixels[2],
  },
  // ---- Secondary actions (share / Facebook / create another) ----
  // flexGrow/Shrink 0 so the row sizes to its chips instead of being
  // squeezed by the surrounding flex column (which clipped the chips).
  secondaryActionsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    minHeight: 36,
  },
  successNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
  },
  sectionLabel: {
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // ---- Player row (mirrors ParticipantRow: flat, hairline dividers) ----
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[1],
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    flexWrap: 'wrap',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    flexShrink: 0,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  searchBarWrapper: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
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
