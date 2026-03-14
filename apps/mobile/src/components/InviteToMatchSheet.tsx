/**
 * Invite To Match Bottom Sheet
 *
 * A modal bottom sheet that shows the user's upcoming matches with available spots.
 * Allows inviting a player to join one of the user's matches.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  radiusPixels,
  spacingPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { selectionHaptic, lightHaptic, formatTime } from '@rallia/shared-utils';
import { useTheme, usePlayerMatches, useInviteToMatch, useAuth } from '@rallia/shared-hooks';
import type { MatchWithDetails } from '@rallia/shared-types';
import { useTranslation } from '../hooks';

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

interface MatchWithSpots extends MatchWithDetails {
  spotsLeft: number;
  totalSpots: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate available spots for a match
 */
function getMatchSpots(match: MatchWithDetails): { spotsLeft: number; totalSpots: number } {
  const totalSpots = match.format === 'doubles' ? 4 : 2;
  const joinedParticipants = match.participants?.filter(p => p.status === 'joined') ?? [];
  const spotsLeft = Math.max(0, totalSpots - joinedParticipants.length);
  return { spotsLeft, totalSpots };
}

/**
 * Check if user is the host of the match
 */
function isUserHost(match: MatchWithDetails, userId: string): boolean {
  return match.created_by === userId;
}

/**
 * Format match date for display
 */
function formatMatchDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// =============================================================================
// MATCH CARD COMPONENT
// =============================================================================

interface MatchCardProps {
  match: MatchWithSpots;
  onInvite: () => void;
  isInviting: boolean;
  colors: {
    background: string;
    cardBackground: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    buttonTextActive: string;
  };
  isDark: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: any) => string;
  locale: string;
}

const MatchCard: React.FC<MatchCardProps> = ({
  match,
  onInvite,
  isInviting,
  colors,
  isDark,
  t,
  locale,
}) => {
  const sportName = match.sport?.display_name || match.sport?.name || '';
  const locationName =
    match.location_name || match.facility?.name || t('inviteToMatch.unknownLocation');
  const matchDate = formatMatchDate(match.match_date, locale);
  const timeRange = `${formatTime(match.start_time)} - ${formatTime(match.end_time)}`;
  const formatLabel =
    match.format === 'doubles' ? t('inviteToMatch.doubles') : t('inviteToMatch.singles');

  return (
    <View
      style={[
        styles.matchCard,
        {
          backgroundColor: isDark ? neutral[800] : neutral[50],
          borderColor: colors.border,
        },
      ]}
    >
      {/* Match Info */}
      <View style={styles.matchInfo}>
        {/* Sport & Format */}
        <View style={styles.matchHeader}>
          <Text style={[styles.sportName, { color: colors.text }]} numberOfLines={1}>
            {sportName}
          </Text>
          <View
            style={[styles.formatBadge, { backgroundColor: isDark ? primary[900] : primary[100] }]}
          >
            <Text style={[styles.formatText, { color: isDark ? primary[300] : primary[700] }]}>
              {formatLabel}
            </Text>
          </View>
        </View>

        {/* Date & Time */}
        <View style={styles.matchRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.matchDetail, { color: colors.textSecondary }]}>
            {matchDate} • {timeRange}
          </Text>
        </View>

        {/* Location */}
        <View style={styles.matchRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.matchDetail, { color: colors.textSecondary }]} numberOfLines={1}>
            {locationName}
          </Text>
        </View>

        {/* Spots Available */}
        <View style={styles.matchRow}>
          <Ionicons name="people-outline" size={14} color={status.success.DEFAULT} />
          <Text style={[styles.spotsText, { color: status.success.DEFAULT }]}>
            {t('inviteToMatch.spotsAvailable').replace('{count}', String(match.spotsLeft))}
          </Text>
        </View>
      </View>

      {/* Invite Button */}
      <TouchableOpacity
        style={[
          styles.inviteButton,
          { backgroundColor: colors.buttonActive },
          isInviting && styles.inviteButtonDisabled,
        ]}
        onPress={onInvite}
        disabled={isInviting}
        activeOpacity={0.7}
      >
        {isInviting ? (
          <ActivityIndicator size="small" color={colors.buttonTextActive} />
        ) : (
          <>
            <Ionicons name="paper-plane" size={14} color={colors.buttonTextActive} />
            <Text style={[styles.inviteButtonText, { color: colors.buttonTextActive }]}>
              {t('inviteToMatch.sendInvite')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function InviteToMatchActionSheet({ payload }: SheetProps<'invite-to-match'>) {
  const targetPlayerId = payload?.playerId ?? '';
  const targetPlayerName = payload?.playerName ?? '';

  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? '';
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const isDark = theme === 'dark';

  // Track which match is currently being invited
  const [invitingMatchId, setInvitingMatchId] = React.useState<string | null>(null);

  // Fetch user's upcoming matches
  const { matches, isLoading, isError } = usePlayerMatches({
    userId: currentUserId,
    timeFilter: 'upcoming',
    statusFilter: 'hosting', // Only matches where user is host
    enabled: !!currentUserId,
  });

  // Filter matches to only those with available spots
  const availableMatches = useMemo<MatchWithSpots[]>(() => {
    if (!matches || !currentUserId) return [];

    return (
      matches
        .filter(match => {
          // Must be host
          if (!isUserHost(match, currentUserId)) return false;

          // Must have spots available
          const { spotsLeft } = getMatchSpots(match);
          if (spotsLeft <= 0) return false;

          // Player must not already be in this match
          const isAlreadyParticipant = match.participants?.some(
            p => p.player_id === targetPlayerId
          );
          if (isAlreadyParticipant) return false;

          // Match must not be cancelled
          if (match.cancelled_at) return false;

          return true;
        })
        .map(match => ({
          ...match,
          ...getMatchSpots(match),
        }))
        // Sort by date (soonest first)
        .sort((a, b) => {
          const dateA = new Date(`${a.match_date}T${a.start_time}`);
          const dateB = new Date(`${b.match_date}T${b.start_time}`);
          return dateA.getTime() - dateB.getTime();
        })
    );
  }, [matches, currentUserId, targetPlayerId]);

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.card,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextActive: BASE_WHITE,
    }),
    [themeColors, isDark]
  );

  // Handle invite success
  const handleInviteSuccess = useCallback(() => {
    setInvitingMatchId(null);
    toast.success(t('inviteToMatch.inviteSent').replace('{name}', targetPlayerName));
    lightHaptic();
    SheetManager.hide('invite-to-match');
  }, [toast, t, targetPlayerName]);

  // Handle invite error
  const handleInviteError = useCallback(
    (error: Error) => {
      setInvitingMatchId(null);
      toast.error(t('inviteToMatch.inviteError'));
      console.error('Failed to invite player:', error);
    },
    [toast, t]
  );

  // Invite hook - we'll call this for each match
  const { invitePlayers, isInviting: isInviteLoading } = useInviteToMatch({
    matchId: invitingMatchId ?? '',
    hostId: currentUserId,
    onSuccess: handleInviteSuccess,
    onError: handleInviteError,
  });

  // Handle invite button press
  const handleInvite = useCallback(
    (match: MatchWithSpots) => {
      if (isInviteLoading || invitingMatchId) return;

      selectionHaptic();
      setInvitingMatchId(match.id);

      // Small delay to let state update before calling invitePlayers
      setTimeout(() => {
        invitePlayers([targetPlayerId]);
      }, 50);
    },
    [isInviteLoading, invitingMatchId, invitePlayers, targetPlayerId]
  );

  // Handle close button press
  const handleClose = useCallback(() => {
    selectionHaptic();
    SheetManager.hide('invite-to-match');
  }, []);

  // Render match card
  const renderMatchCard = useCallback(
    ({ item }: { item: MatchWithSpots }) => (
      <MatchCard
        match={item}
        onInvite={() => handleInvite(item)}
        isInviting={invitingMatchId === item.id}
        colors={colors}
        isDark={isDark}
        t={t}
        locale={locale}
      />
    ),
    [colors, isDark, t, locale, handleInvite, invitingMatchId]
  );

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons
        name="calendar-outline"
        size={48}
        color={colors.textMuted}
        style={styles.emptyIcon}
      />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {t('inviteToMatch.noMatches')}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
        {t('inviteToMatch.noMatchesDescription')}
      </Text>
    </View>
  );

  // Render loading state
  const renderLoadingState = () => (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.buttonActive} />
      <Text style={[styles.loadingText, { color: colors.textMuted }]}>
        {t('inviteToMatch.loadingMatches')}
      </Text>
    </View>
  );

  // Render error state
  const renderErrorState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons
        name="alert-circle-outline"
        size={48}
        color={status.error.DEFAULT}
        style={styles.emptyIcon}
      />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {t('inviteToMatch.errorLoading')}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
        {t('inviteToMatch.errorLoadingDescription')}
      </Text>
    </View>
  );

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{t('inviteToMatch.title')}</Text>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Subtitle */}
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {t('inviteToMatch.subtitle').replace('{name}', targetPlayerName)}
        </Text>

        {/* Content */}
        {isLoading ? (
          renderLoadingState()
        ) : isError ? (
          renderErrorState()
        ) : availableMatches.length === 0 ? (
          renderEmptyState()
        ) : (
          <FlatList
            data={availableMatches}
            renderItem={renderMatchCard}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility
export const InviteToMatchSheet = InviteToMatchActionSheet;

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    maxHeight: '80%',
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  container: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  title: {
    fontSize: fontSizePixels.xl,
    fontWeight: fontWeightNumeric.semibold,
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  subtitle: {
    fontSize: fontSizePixels.sm,
    marginBottom: spacingPixels[4],
  },
  listContent: {
    paddingBottom: spacingPixels[4],
  },
  separator: {
    height: spacingPixels[3],
  },
  matchCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    padding: spacingPixels[4],
  },
  matchInfo: {
    marginBottom: spacingPixels[3],
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[2],
  },
  sportName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
    flex: 1,
  },
  formatBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  formatText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[1],
    gap: spacingPixels[2],
  },
  matchDetail: {
    fontSize: fontSizePixels.sm,
    flex: 1,
  },
  spotsText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  inviteButtonDisabled: {
    opacity: 0.6,
  },
  inviteButtonText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.semibold,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[12],
    paddingHorizontal: spacingPixels[6],
  },
  emptyIcon: {
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: fontWeightNumeric.semibold,
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptySubtitle: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    lineHeight: fontSizePixels.sm * 1.5,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[12],
  },
  loadingText: {
    marginTop: spacingPixels[3],
    fontSize: fontSizePixels.sm,
  },
});

export default InviteToMatchActionSheet;
