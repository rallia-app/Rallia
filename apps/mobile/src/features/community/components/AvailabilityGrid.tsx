import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { AvailabilityDay, AvailabilityPeriod } from '@rallia/shared-services';
import { useTranslation } from '../../../hooks';

const DAYS: AvailabilityDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// 6-block availability collapses to a 2-row AM/PM aggregation on the compact
// widget: top dot = any of the morning cluster (early/morning/midday); bottom
// dot = any of the afternoon cluster (afternoon/evening/late). Keeps the
// PlayerCard footprint identical to the 3-period version while still conveying
// the new 6-block precision.
const AM_CLUSTER: AvailabilityPeriod[] = ['early', 'morning', 'midday'];
const PM_CLUSTER: AvailabilityPeriod[] = ['afternoon', 'evening', 'late'];

interface AvailabilityGridProps {
  availability: Partial<Record<AvailabilityDay, AvailabilityPeriod[]>> | null;
  activeColor: string;
  mutedColor: string;
}

/**
 * Compact 7-day availability grid: one cell per day with a colored day letter
 * and a 2×3 dot matrix underneath. Top row dots = AM cluster (early, morning,
 * midday) in order; bottom row dots = PM cluster (afternoon, evening, late).
 * Each dot represents one block, so the widget conveys all 6 blocks per day
 * at a glance without text. Renders nothing when the player has set no
 * availability at all.
 */
const AvailabilityGrid: React.FC<AvailabilityGridProps> = ({
  availability,
  activeColor,
  mutedColor,
}) => {
  const { t } = useTranslation();

  if (!availability || Object.keys(availability).length === 0) return null;

  const renderDot = (filled: boolean, key: string) => (
    <View
      key={key}
      style={[
        styles.dot,
        filled ? { backgroundColor: activeColor } : { backgroundColor: mutedColor, opacity: 0.25 },
      ]}
    />
  );

  return (
    <View style={styles.container}>
      {DAYS.map(day => {
        const periods = availability[day] ?? [];
        const isActive = periods.length > 0;
        return (
          <View key={day} style={styles.cell}>
            <Text size="xs" weight="semibold" color={isActive ? activeColor : mutedColor}>
              {t(`playerDirectory.dayLetters.${day}`)}
            </Text>
            <View style={styles.dotsGrid}>
              <View style={styles.dotsRow}>
                {AM_CLUSTER.map(p => renderDot(periods.includes(p), `${day}-${p}`))}
              </View>
              <View style={styles.dotsRow}>
                {PM_CLUSTER.map(p => renderDot(periods.includes(p), `${day}-${p}`))}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[1],
  },
  cell: {
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  dotsGrid: {
    flexDirection: 'column',
    gap: 2,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});

export default AvailabilityGrid;
