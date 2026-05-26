/**
 * MomentsList
 *
 * Inline list of recent computable highlights (streaks, milestones).
 * Server returns title_key + title_params; we localize.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import type { NetworkPulseMoment } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';
import type { TranslationKey } from '#/hooks';

interface MomentsListProps {
  moments: NetworkPulseMoment[];
  onPlayerPress?: (playerId: string) => void;
}

export function MomentsList({ moments, onPlayerPress }: MomentsListProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  if (!moments.length) return null;

  return (
    <View style={styles.section}>
      <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.discover.momentsTitle')}
      </Text>
      <View
        style={[
          styles.list,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {moments.map((m, i) => (
          <TouchableOpacity
            key={`${m.player_id}-${i}`}
            activeOpacity={0.75}
            onPress={() => onPlayerPress?.(m.player_id)}
            style={[
              styles.row,
              i > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Text size="sm" style={{ color: colors.text, flex: 1 }} numberOfLines={2}>
              {t(m.title_key as TranslationKey, m.title_params ?? {})}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[4],
  },
  title: {
    marginBottom: spacingPixels[2],
  },
  list: {
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
});

export default MomentsList;
