/**
 * ScoreConfirmationModal Component
 *
 * Modal for confirming or disputing a pending match score.
 * Shows the match details and score, with options to confirm or dispute.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, useToast } from '@rallia/shared-components';
import { successHaptic, warningHaptic, lightHaptic } from '@rallia/shared-utils';
import { useThemeStyles } from '../../../hooks';
import { SportIcon } from '../../../components/SportIcon';
import { useConfirmMatchScore, type PendingScoreConfirmation } from '@rallia/shared-hooks';
import { getMatchWithDetails } from '@rallia/shared-services';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import type { MatchWithDetails } from '@rallia/shared-types';

export function ScoreConfirmationActionSheet({ payload }: SheetProps<'score-confirmation'>) {
  const confirmation = payload?.confirmation as PendingScoreConfirmation | null;
  const playerId = payload?.playerId ?? '';

  const { colors, isDark } = useThemeStyles();
  const toast = useToast();

  const handleClose = useCallback(() => {
    lightHaptic();
    SheetManager.hide('score-confirmation');
  }, []);

  const confirmMutation = useConfirmMatchScore();

  const isLoading = confirmMutation.isPending;

  const handleConfirm = useCallback(async () => {
    if (!confirmation) return;

    lightHaptic();
    try {
      await confirmMutation.mutateAsync({
        matchResultId: confirmation.match_result_id,
        playerId,
      });
      successHaptic();
      toast.success('The match score has been confirmed.');
      handleClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('already processed')) {
        warningHaptic();
        toast.info('This score has already been confirmed.');
        handleClose();
      } else {
        toast.error('Failed to confirm score. Please try again.');
      }
    }
  }, [confirmation, playerId, confirmMutation, handleClose, toast]);

  const handleProposeRebuttal = useCallback(async () => {
    if (!confirmation) return;

    warningHaptic();
    handleClose();
    // Fetch full match details so the score sheet can render properly
    const matchDetails = await getMatchWithDetails(confirmation.match_id);
    if (matchDetails) {
      setTimeout(() => {
        SheetManager.show('register-match-score', {
          payload: {
            match: matchDetails as MatchWithDetails,
            isRebuttal: true,
            matchResultId: confirmation.match_result_id,
          },
        });
      }, 200);
    }
  }, [confirmation, handleClose]);

  if (!confirmation) return null;

  const matchDate = new Date(confirmation.match_date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const deadline = new Date(confirmation.confirmation_deadline);
  const now = new Date();
  const hoursRemaining = Math.max(
    0,
    Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60))
  );
  const minutesRemaining = Math.max(
    0,
    Math.floor(((deadline.getTime() - now.getTime()) % (1000 * 60 * 60)) / (1000 * 60))
  );

  if (!confirmation) return null;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            Confirm Score
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {/* Submitter info */}
          <View
            style={[
              styles.submitterCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.submitterAvatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
            >
              {confirmation.submitted_by_avatar ? (
                <Image
                  source={{ uri: confirmation.submitted_by_avatar }}
                  style={styles.avatarImage}
                />
              ) : (
                <Ionicons name="person-outline" size={24} color={colors.textMuted} />
              )}
            </View>
            <View style={styles.submitterInfo}>
              <Text weight="medium" style={{ color: colors.text }}>
                {confirmation.submitted_by_name}
              </Text>
              <Text size="sm" style={{ color: colors.textSecondary }}>
                submitted a match score
              </Text>
            </View>
          </View>

          {/* Match details */}
          <View
            style={[
              styles.matchCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            {/* Sport & Date */}
            <View style={styles.matchHeader}>
              <View style={styles.sportBadge}>
                {confirmation.sport_icon_url ? (
                  <Image source={{ uri: confirmation.sport_icon_url }} style={styles.sportIcon} />
                ) : (
                  <SportIcon
                    sportName={confirmation.sport_name ?? 'tennis'}
                    size={16}
                    color={colors.primary}
                  />
                )}
                <Text size="sm" weight="medium" style={{ color: colors.text, marginLeft: 4 }}>
                  {confirmation.sport_name}
                </Text>
              </View>
              <Text size="sm" style={{ color: colors.textSecondary }}>
                {matchDate}
              </Text>
            </View>

            {/* Score display */}
            <View style={styles.scoreContainer}>
              <View style={styles.teamColumn}>
                <Text size="sm" style={{ color: colors.textSecondary }}>
                  {confirmation.player_team === 1 ? 'You' : confirmation.opponent_name}
                </Text>
                <Text
                  size="3xl"
                  weight="bold"
                  style={{
                    color: confirmation.winning_team === 1 ? colors.primary : colors.text,
                  }}
                >
                  {confirmation.team1_score}
                </Text>
                {confirmation.winning_team === 1 && (
                  <View style={[styles.winnerBadge, { backgroundColor: colors.primary }]}>
                    <Ionicons name="trophy-outline" size={12} color="#fff" />
                    <Text size="xs" weight="medium" style={{ color: '#fff', marginLeft: 2 }}>
                      Winner
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.vsContainer}>
                <Text size="lg" weight="medium" style={{ color: colors.textMuted }}>
                  vs
                </Text>
              </View>

              <View style={styles.teamColumn}>
                <Text size="sm" style={{ color: colors.textSecondary }}>
                  {confirmation.player_team === 2 ? 'You' : confirmation.opponent_name}
                </Text>
                <Text
                  size="3xl"
                  weight="bold"
                  style={{
                    color: confirmation.winning_team === 2 ? colors.primary : colors.text,
                  }}
                >
                  {confirmation.team2_score}
                </Text>
                {confirmation.winning_team === 2 && (
                  <View style={[styles.winnerBadge, { backgroundColor: colors.primary }]}>
                    <Ionicons name="trophy-outline" size={12} color="#fff" />
                    <Text size="xs" weight="medium" style={{ color: '#fff', marginLeft: 2 }}>
                      Winner
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Group info if any */}
            {confirmation.network_name && (
              <View style={[styles.groupInfo, { borderTopColor: colors.border }]}>
                <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 4 }}>
                  Posted to {confirmation.network_name}
                </Text>
              </View>
            )}
          </View>

          {/* Deadline warning */}
          <View
            style={[
              styles.deadlineCard,
              { backgroundColor: isDark ? '#3A2A00' : '#FFF9E6', borderColor: '#FFB800' },
            ]}
          >
            <Ionicons name="time-outline" size={20} color="#FFB800" />
            <View style={styles.deadlineInfo}>
              <Text size="sm" weight="medium" style={{ color: isDark ? '#FFD54F' : '#8B6914' }}>
                {hoursRemaining}h {minutesRemaining}m remaining to respond
              </Text>
              <Text size="xs" style={{ color: isDark ? '#C4A84D' : '#A67F00' }}>
                Score will be auto-confirmed after deadline
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Button
            variant="outline"
            onPress={handleProposeRebuttal}
            disabled={isLoading}
            style={styles.disputeButton}
          >
            Propose Different Score
          </Button>
          <Button
            variant="primary"
            onPress={handleConfirm}
            disabled={isLoading}
            style={styles.confirmButton}
          >
            {isLoading ? 'Processing...' : 'Confirm Score'}
          </Button>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const ScoreConfirmationModal = ScoreConfirmationActionSheet;

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
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  closeButton: {
    padding: spacingPixels[1],
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[5],
  },
  submitterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  submitterAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  submitterInfo: {
    marginLeft: 12,
    flex: 1,
  },
  matchCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  teamColumn: {
    alignItems: 'center',
    flex: 1,
  },
  vsContainer: {
    paddingHorizontal: 16,
  },
  winnerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  groupInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
  },
  deadlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  deadlineInfo: {
    marginLeft: 12,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  disputeButton: {
    flex: 1,
  },
  confirmButton: {
    flex: 2,
  },
});
