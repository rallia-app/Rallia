/**
 * PendingScoresSection Component
 *
 * Section displaying all pending score confirmations for the current user.
 * Includes the list of pending scores and the confirmation modal.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { usePendingScoreConfirmations, type PendingScoreConfirmation } from '@rallia/shared-hooks';

import { useThemeStyles } from '#/hooks';

import { PendingScoreCard } from './PendingScoreCard';

interface PendingScoresSectionProps {
  playerId: string;
  /** Only show confirmations for a specific group */
  groupId?: string;
  /** Title override */
  title?: string;
}

export function PendingScoresSection({
  playerId,
  groupId,
  title = 'Pending Confirmations',
}: PendingScoresSectionProps) {
  const { colors } = useThemeStyles();
  const { data: allConfirmations, isLoading } = usePendingScoreConfirmations(playerId);

  // Filter by groupId if provided
  const confirmations = groupId
    ? (allConfirmations || []).filter(c => c.network_id === groupId)
    : allConfirmations || [];

  const handleCardPress = useCallback(
    (confirmation: PendingScoreConfirmation) => {
      SheetManager.show('score-confirmation', {
        payload: { confirmation, playerId },
      });
    },
    [playerId]
  );

  // Don't render if no pending confirmations
  if (isLoading || confirmations.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.iconBadge, { backgroundColor: '#FF6B00' }]}>
            <Ionicons name="alert-circle" size={16} color="#fff" />
          </View>
          <Text weight="semibold" size="lg" style={{ color: colors.text, marginLeft: 8 }}>
            {title}
          </Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: '#FF6B00' }]}>
          <Text size="sm" weight="medium" style={{ color: '#fff' }}>
            {confirmations.length}
          </Text>
        </View>
      </View>

      {/* Description */}
      <Text size="sm" style={[styles.description, { color: colors.textSecondary }]}>
        Review and confirm these match scores submitted by other players.
      </Text>

      {/* List of pending confirmations */}
      <View style={styles.list}>
        {confirmations.map(confirmation => (
          <PendingScoreCard
            key={confirmation.match_result_id}
            confirmation={confirmation}
            onPress={() => handleCardPress(confirmation)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  description: {
    marginBottom: 12,
  },
  list: {
    gap: 0,
  },
});
