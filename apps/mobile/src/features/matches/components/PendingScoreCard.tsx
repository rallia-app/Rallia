/**
 * PendingScoreCard Component
 *
 * Card displaying a pending score confirmation request.
 * Tapping opens the ScoreConfirmationModal.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import type { PendingScoreConfirmation } from '@rallia/shared-hooks';

import { useThemeStyles } from '#/hooks';

interface PendingScoreCardProps {
  confirmation: PendingScoreConfirmation;
  onPress: () => void;
}

export function PendingScoreCard({ confirmation, onPress }: PendingScoreCardProps) {
  const { colors, isDark } = useThemeStyles();

  const matchDate = new Date(confirmation.match_date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const deadline = new Date(confirmation.confirmation_deadline);
  const now = new Date();
  const hoursRemaining = Math.max(
    0,
    Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60))
  );

  const isUrgent = hoursRemaining < 6;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: colors.cardBackground,
          borderColor: isUrgent ? '#FFB800' : colors.border,
          borderWidth: isUrgent ? 2 : 1,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Urgent badge */}
      {isUrgent && (
        <View style={styles.urgentBadge}>
          <Ionicons name="time-outline" size={12} color="#fff" />
          <Text size="xs" weight="medium" style={{ color: '#fff', marginLeft: 2 }}>
            {hoursRemaining}h left
          </Text>
        </View>
      )}

      <View style={styles.content}>
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
          {confirmation.submitted_by_avatar ? (
            <Image
              source={{ uri: getProfilePictureUrl(confirmation.submitted_by_avatar) ?? '' }}
              style={styles.avatarImage}
            />
          ) : (
            <Ionicons name="person-outline" size={20} color={colors.textMuted} />
          )}
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text weight="medium" style={{ color: colors.text }} numberOfLines={1}>
            {confirmation.submitted_by_name}
          </Text>
          <Text size="sm" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {confirmation.sport_name} • {matchDate}
          </Text>
        </View>

        {/* Score preview */}
        <View style={styles.scorePreview}>
          <Text weight="semibold" style={{ color: colors.text }}>
            {confirmation.team1_score} - {confirmation.team2_score}
          </Text>
        </View>

        {/* Arrow */}
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFB800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    borderBottomRightRadius: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  scorePreview: {
    marginRight: 8,
  },
});
