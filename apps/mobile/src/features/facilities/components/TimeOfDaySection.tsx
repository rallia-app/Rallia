/**
 * TimeOfDaySection Component
 * Groups slots by time period (Morning, Afternoon, Evening) with collapsible functionality.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, neutral, accent, status } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { FormattedSlot } from '@rallia/shared-hooks';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

interface TimeOfDaySectionProps {
  timeOfDay: TimeOfDay;
  slots: FormattedSlot[];
  renderSlot: (slot: FormattedSlot, index: number) => React.ReactNode;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
    background: string;
  };
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  initiallyExpanded?: boolean;
}

const TIME_OF_DAY_CONFIG: Record<
  TimeOfDay,
  {
    icon: keyof typeof Ionicons.glyphMap;
    timeRange: string;
  }
> = {
  morning: {
    icon: 'sunny-outline',
    timeRange: '6am - 12pm',
  },
  afternoon: {
    icon: 'partly-sunny-outline',
    timeRange: '12pm - 5pm',
  },
  evening: {
    icon: 'moon-outline',
    timeRange: '5pm - 10pm',
  },
};

/**
 * Categorize a slot into morning, afternoon, or evening
 */
export function getTimeOfDay(slot: FormattedSlot): TimeOfDay {
  const hour = slot.datetime.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Group slots by time of day
 */
export function groupSlotsByTimeOfDay(slots: FormattedSlot[]): Record<TimeOfDay, FormattedSlot[]> {
  const groups: Record<TimeOfDay, FormattedSlot[]> = {
    morning: [],
    afternoon: [],
    evening: [],
  };

  slots.forEach(slot => {
    const timeOfDay = getTimeOfDay(slot);
    groups[timeOfDay].push(slot);
  });

  return groups;
}

export default function TimeOfDaySection({
  timeOfDay,
  slots,
  renderSlot,
  colors,
  isDark,
  t,
  initiallyExpanded = true,
}: TimeOfDaySectionProps) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const rotateAnim = useMemo(
    () => new Animated.Value(initiallyExpanded ? 1 : 0),
    [initiallyExpanded]
  );

  const config = TIME_OF_DAY_CONFIG[timeOfDay];
  const iconColor =
    timeOfDay === 'morning'
      ? accent[500]
      : timeOfDay === 'afternoon'
        ? accent[600]
        : status.info.DEFAULT;

  const handleToggle = useCallback(() => {
    lightHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded(!isExpanded);

    Animated.timing(rotateAnim, {
      toValue: isExpanded ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isExpanded, rotateAnim]);

  const chevronRotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  if (slots.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <TouchableOpacity
        onPress={handleToggle}
        activeOpacity={0.7}
        style={[styles.header, { backgroundColor: isDark ? neutral[800] + '50' : neutral[50] }]}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.iconWrapper, { backgroundColor: iconColor + '20' }]}>
            <Ionicons name={config.icon} size={16} color={iconColor} />
          </View>
          <View style={styles.headerText}>
            <Text size="sm" weight="semibold" color={colors.text}>
              {t(`facilityDetail.timeOfDay.${timeOfDay}` as Parameters<typeof t>[0])}
            </Text>
            <Text size="xs" color={colors.textMuted}>
              {config.timeRange} • {slots.length} {slots.length === 1 ? 'slot' : 'slots'}
            </Text>
          </View>
        </View>

        <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
          <Ionicons name="chevron-up" size={18} color={colors.textMuted} />
        </Animated.View>
      </TouchableOpacity>

      {/* Slots Container */}
      {isExpanded && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.slotsContainer}
        >
          {slots.map((slot, index) => renderSlot(slot, index))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacingPixels[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginHorizontal: spacingPixels[4],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    gap: spacingPixels[0.5],
  },
  slotsContainer: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2.5],
    paddingBottom: spacingPixels[1],
  },
});
