/**
 * DatePickerBar Component
 * Horizontal scrollable date picker with active state and slot counts.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  shadowsNative,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

interface DateItem {
  dateKey: string;
  label: string;
  dayOfWeek: string;
  dayNumber: string;
  month: string;
  isToday: boolean;
  isTomorrow: boolean;
  slotCount: number;
}

interface DatePickerBarProps {
  dates: DateItem[];
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
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
}

export default function DatePickerBar({
  dates,
  selectedDate,
  onSelectDate,
  colors,
  isDark,
  t,
}: DatePickerBarProps) {
  const scrollViewRef = useRef<ScrollView>(null);

  // Scroll to selected date when it changes
  useEffect(() => {
    const selectedIndex = dates.findIndex(d => d.dateKey === selectedDate);
    if (selectedIndex >= 0 && scrollViewRef.current) {
      // Calculate scroll position (each item is ~80px wide + 8px gap)
      const scrollPosition = Math.max(0, selectedIndex * 88 - 20);
      scrollViewRef.current.scrollTo({ x: scrollPosition, animated: true });
    }
  }, [selectedDate, dates]);

  const handleDatePress = useCallback(
    (dateKey: string) => {
      lightHaptic();
      onSelectDate(dateKey);
    },
    [onSelectDate]
  );

  if (dates.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={88}
      >
        {dates.map(date => {
          const isSelected = date.dateKey === selectedDate;
          const hasSlots = date.slotCount > 0;

          return (
            <TouchableOpacity
              key={date.dateKey}
              onPress={() => handleDatePress(date.dateKey)}
              activeOpacity={0.7}
              style={[
                styles.dateItem,
                {
                  backgroundColor: isSelected ? primary[500] : isDark ? neutral[800] : colors.card,
                  borderColor: isSelected ? primary[500] : isDark ? neutral[700] : neutral[200],
                },
                isSelected && shadowsNative.sm,
              ]}
            >
              {/* Day of week */}
              <Text
                size="xs"
                weight="medium"
                color={isSelected ? '#fff' : colors.textMuted}
                style={styles.dayOfWeek}
              >
                {date.isToday
                  ? t('common.time.today')
                  : date.isTomorrow
                    ? t('common.time.tomorrow')
                    : date.dayOfWeek}
              </Text>

              {/* Day number */}
              <Text size="xl" weight="bold" color={isSelected ? '#fff' : colors.text}>
                {date.month} {date.dayNumber}
              </Text>

              {/* Slot count badge */}
              {hasSlots && (
                <View
                  style={[
                    styles.slotBadge,
                    {
                      backgroundColor: isSelected
                        ? 'rgba(255,255,255,0.25)'
                        : isDark
                          ? neutral[700]
                          : primary[50],
                    },
                  ]}
                >
                  <Text size="xs" weight="semibold" color={isSelected ? '#fff' : colors.primary}>
                    {date.slotCount} {t('common.time.slots')}
                  </Text>
                </View>
              )}

              {/* No slots indicator */}
              {!hasSlots && (
                <View style={styles.noSlotsIndicator}>
                  <View
                    style={[
                      styles.noSlotsDot,
                      { backgroundColor: isDark ? neutral[600] : neutral[300] },
                    ]}
                  />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  dateItem: {
    width: 120,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.xl,
    alignItems: 'center',
    borderWidth: 1,
    gap: spacingPixels[0.5],
  },
  dayOfWeek: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slotBadge: {
    marginTop: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    minWidth: 24,
    alignItems: 'center',
  },
  noSlotsIndicator: {
    marginTop: spacingPixels[1],
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noSlotsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
