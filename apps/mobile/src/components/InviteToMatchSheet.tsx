/**
 * Invite To Match Bottom Sheet
 *
 * A modal bottom sheet that shows the user's upcoming matches with available spots.
 * Allows inviting a player to join one of the user's matches.
 * Uses the standard MatchCard component with a custom "Send Invite" CTA.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, Text, MatchCard, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  radiusPixels,
  spacingPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  status,
  base,
} from '@rallia/design-system';
import { selectionHaptic, lightHaptic } from '@rallia/shared-utils';
import { useTheme, usePlayerMatches, useInviteToMatch, useAuth } from '@rallia/shared-hooks';
import type { MatchWithDetails } from '@rallia/shared-types';

import { useTranslation } from '#/hooks';

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

  // Track which match is currently being invited and which have been sent
  const [invitingMatchId, setInvitingMatchId] = React.useState<string | null>(null);
  const [invitedMatchIds, setInvitedMatchIds] = React.useState<Set<string>>(new Set());

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
      textSecondary: isDark ? primary[300] : primary[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextActive: base.white,
    }),
    [themeColors, isDark]
  );

  // Handle invite success — keep sheet open so user can invite to more matches
  const handleInviteSuccess = useCallback(() => {
    const matchId = invitingMatchId;
    setInvitingMatchId(null);
    if (matchId) {
      setInvitedMatchIds(prev => new Set(prev).add(matchId));
    }
    toast.success(t('inviteToMatch.inviteSent').replace('{name}', targetPlayerName));
    lightHaptic();
  }, [toast, t, targetPlayerName, invitingMatchId]);

  // Handle invite error
  const handleInviteError = useCallback(
    (error: Error) => {
      setInvitingMatchId(null);
      toast.error(t('inviteToMatch.inviteError'));
      console.error('Failed to invite player:', error);
    },
    [toast, t]
  );

  // Invite hook - matchId is now passed at call time, no stale closure issues
  const { invitePlayers, isInviting: isInviteLoading } = useInviteToMatch({
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
      invitePlayers({ matchId: match.id, playerIds: [targetPlayerId] });
    },
    [isInviteLoading, invitingMatchId, invitePlayers, targetPlayerId]
  );

  // Handle close button press
  const handleClose = useCallback(() => {
    selectionHaptic();
    SheetManager.hide('invite-to-match');
  }, []);

  // Render match card with custom invite CTA
  const renderMatchCard = useCallback(
    ({ item }: { item: MatchWithSpots }) => {
      const isThisInviting = invitingMatchId === item.id;
      const alreadyInvited = invitedMatchIds.has(item.id);

      return (
        <View style={styles.cardWrapper}>
          <MatchCard
            match={item}
            isDark={isDark}
            t={t}
            locale={locale}
            currentPlayerId={currentUserId}
            renderCta={() => {
              if (alreadyInvited) {
                return (
                  <View
                    style={[
                      styles.invitedBadge,
                      {
                        backgroundColor: isDark
                          ? 'rgba(5, 150, 105, 0.15)'
                          : 'rgba(5, 150, 105, 0.1)',
                        borderColor: isDark ? 'rgba(5, 150, 105, 0.3)' : 'rgba(5, 150, 105, 0.25)',
                      },
                    ]}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={status.success.light} />
                    <Text style={[styles.invitedBadgeText, { color: status.success.light }]}>
                      {t('inviteToMatch.invited')}
                    </Text>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  style={[
                    styles.inviteButton,
                    { backgroundColor: colors.buttonActive },
                    isThisInviting && styles.inviteButtonDisabled,
                  ]}
                  onPress={() => handleInvite(item)}
                  disabled={isThisInviting}
                  activeOpacity={0.7}
                >
                  {isThisInviting ? (
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
              );
            }}
          />
        </View>
      );
    },
    [isDark, t, locale, currentUserId, colors, handleInvite, invitingMatchId, invitedMatchIds]
  );

  // Render empty state
  const renderEmptyState = () => (
    <EmptyState
      variant="sheet"
      icon={<Ionicons name="calendar-outline" size={36} color={colors.buttonActive} />}
      title={t('inviteToMatch.noMatches')}
      description={t('inviteToMatch.noMatchesDescription')}
    />
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
      useBottomSafeAreaPadding={false}
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

        {/* Content viewport — bounds the FlatList so it can scroll inside the sheet */}
        <View style={styles.contentViewport}>
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
            />
          )}
        </View>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
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
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  listContent: {
    paddingBottom: 0,
  },
  // overflow: visible keeps the tier ribbon badge from being clipped.
  cardWrapper: {
    overflow: 'visible',
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  inviteButtonDisabled: {
    opacity: 0.6,
  },
  invitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
    gap: spacingPixels[1.5],
    borderWidth: 1,
  },
  invitedBadgeText: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
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
