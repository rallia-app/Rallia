/**
 * TimeRangeSelector Component
 *
 * A horizontal pill selector for choosing analytics time ranges.
 * Styled to match the Chat List tabs (pill container with shadow on active).
 *
 * @example
 * ```tsx
 * <TimeRangeSelector
 *   value="30d"
 *   onChange={(range) => setTimeRange(range)}
 * />
 * ```
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  Platform,
} from 'react-native';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  primary,
  neutral,
  spacingPixels,
} from '@rallia/design-system';
import * as Haptics from 'expo-haptics';

export type TimeRange = '7d' | '30d' | '90d' | 'ytd' | 'all';

export interface TimeRangeOption {
  value: TimeRange;
  label: string;
  days: number | null; // null for 'all' or 'ytd'
}

export interface TimeRangeSelectorProps {
  /**
   * Currently selected time range
   */
  value: TimeRange;

  /**
   * Callback when time range changes
   */
  onChange: (range: TimeRange) => void;

  /**
   * Available options (defaults to common ranges)
   */
  options?: TimeRangeOption[];

  /**
   * Container style
   */
  style?: ViewStyle;

  /**
   * Whether to disable interaction
   */
  disabled?: boolean;

  /**
   * Size variant
   */
  size?: 'sm' | 'md';
}

const DEFAULT_OPTIONS: TimeRangeOption[] = [
  { value: '7d', label: '7D', days: 7 },
  { value: '30d', label: '30D', days: 30 },
  { value: '90d', label: '90D', days: 90 },
  { value: 'ytd', label: 'YTD', days: null },
];

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  style,
  disabled = false,
  size = 'md',
}) => {
  const { colors, isDark } = useThemeStyles();

  const handlePress = useCallback(
    (range: TimeRange) => {
      if (disabled || range === value) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(range);
    },
    [disabled, value, onChange]
  );

  // Match Chat List tabs color scheme
  const themeColors = {
    containerBackground: isDark ? '#1C1C1E' : '#F2F2F7',
    activeBackground: colors.cardBackground || (isDark ? neutral[800] : '#FFFFFF'),
    text: colors.textMuted || (isDark ? neutral[400] : neutral[500]),
    activeText: colors.primary || primary[500],
  };

  const sizeStyles = {
    sm: {
      paddingVertical: spacingPixels[2], // 8px
      fontSize: 12,
    },
    md: {
      paddingVertical: 10,
      fontSize: 14,
    },
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: themeColors.containerBackground },
        style,
      ]}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => handlePress(option.value)}
            disabled={disabled}
            activeOpacity={0.7}
            style={[
              styles.option,
              { paddingVertical: sizeStyles[size].paddingVertical },
              isSelected && [
                styles.activeOption,
                { backgroundColor: themeColors.activeBackground },
              ],
            ]}
          >
            <Text
              style={[
                styles.optionText,
                {
                  fontSize: sizeStyles[size].fontSize,
                  color: isSelected ? themeColors.activeText : themeColors.text,
                  fontWeight: isSelected ? '600' : '500',
                },
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  activeOption: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  optionText: {
    textAlign: 'center',
  },
});

export default TimeRangeSelector;
