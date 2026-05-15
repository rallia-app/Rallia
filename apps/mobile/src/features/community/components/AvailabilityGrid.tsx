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

const PERIODS: AvailabilityPeriod[] = ['morning', 'afternoon', 'evening'];

interface AvailabilityGridProps {
  availability: Partial<Record<AvailabilityDay, AvailabilityPeriod[]>> | null;
  activeColor: string;
  mutedColor: string;
}

/**
 * Compact 7-day availability grid: one cell per day with a colored day letter
 * (muted when the player has zero slots that day) and a row of three period
 * dots underneath (morning / afternoon / evening). Renders nothing when the
 * player has set no availability at all.
 */
const AvailabilityGrid: React.FC<AvailabilityGridProps> = ({
  availability,
  activeColor,
  mutedColor,
}) => {
  const { t } = useTranslation();

  if (!availability || Object.keys(availability).length === 0) return null;

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
            <View style={styles.dotsRow}>
              {PERIODS.map(period => {
                const filled = periods.includes(period);
                return (
                  <View
                    key={period}
                    style={[
                      styles.dot,
                      filled
                        ? { backgroundColor: activeColor }
                        : { backgroundColor: mutedColor, opacity: 0.25 },
                    ]}
                  />
                );
              })}
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
