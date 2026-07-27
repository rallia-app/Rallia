/**
 * PointsToDefendCard — what the player is about to lose off the Circuit board
 *
 * The rolling 52-week window's counterpart to a season reset: instead of one
 * shared wipe twice a year, every player has their own expiries. Deliberately
 * quiet (outlined, not a gradient hero) so it reads as information beside the
 * standing card rather than competing with it.
 *
 * Only ever rendered with results whose expiry actually moves the player's
 * total — the caller filters on `countsNow`. Purely presentational.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';

import type { ThemeBits } from './BoardKit';

export interface DefendItem {
  id: string;
  /** Tournament that produced the result. */
  name: string;
  points: number;
  daysRemaining: number;
}

/** How many rows to list before collapsing the rest into a summary line. */
const MAX_ROWS = 3;

export function PointsToDefendCard({
  items,
  pointsAtStake,
  title,
  note,
  valueLabel,
  formatDays,
  formatMore,
  theme,
}: {
  items: DefendItem[];
  pointsAtStake: number;
  title: string;
  note: string;
  valueLabel: string;
  /** (days) => "in 12 days" — plural handling stays with the caller's i18n. */
  formatDays: (days: number) => string;
  /** (count) => "+2 more" */
  formatMore: (count: number) => string;
  theme: ThemeBits;
}) {
  if (items.length === 0) return null;

  const accentColor = theme.isDark ? primary[300] : primary[600];
  const shown = items.slice(0, MAX_ROWS);
  const remaining = items.length - shown.length;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.cardColor, borderColor: theme.borderColor }]}
    >
      <View style={styles.header}>
        <View style={[styles.disc, { backgroundColor: theme.inputColor }]}>
          <Ionicons name="hourglass-outline" size={18} color={accentColor} />
        </View>
        <View style={styles.headerText}>
          <Text size="base" weight="bold" color={theme.textColor}>
            {title}
          </Text>
          <Text size="xs" color={theme.mutedColor}>
            {note}
          </Text>
        </View>
        <View style={styles.totalCol}>
          <Text size="lg" weight="bold" color={accentColor}>
            {pointsAtStake.toLocaleString()}
          </Text>
          <Text size="xs" color={theme.mutedColor}>
            {valueLabel}
          </Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

      {shown.map(item => (
        <View key={item.id} style={styles.row}>
          <Text size="sm" color={theme.textColor} numberOfLines={1} style={styles.rowName}>
            {item.name}
          </Text>
          <Text size="sm" weight="semibold" color={theme.textColor} style={styles.rowPoints}>
            {item.points.toLocaleString()}
          </Text>
          <Text size="xs" color={theme.mutedColor} style={styles.rowDays}>
            {formatDays(item.daysRemaining)}
          </Text>
        </View>
      ))}

      {remaining > 0 ? (
        <Text size="xs" color={theme.mutedColor} style={styles.more}>
          {formatMore(remaining)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  totalCol: {
    alignItems: 'flex-end',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacingPixels[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
  rowName: {
    flex: 1,
  },
  rowPoints: {
    minWidth: 56,
    textAlign: 'right',
  },
  rowDays: {
    minWidth: 78,
    textAlign: 'right',
  },
  more: {
    marginTop: spacingPixels[2],
  },
});
