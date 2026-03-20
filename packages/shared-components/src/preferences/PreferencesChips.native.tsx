/**
 * PreferencesChips Component
 *
 * Reusable chip selection component for preferences (match duration, match type, etc.)
 * Supports single and multi-select modes.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '@rallia/shared-constants';

export interface PreferencesChipsProps {
  /** Array of options to display as chips */
  options: string[];

  /** Currently selected value(s) - string for single-select, array for multi-select */
  selected?: string | string[];

  /** Callback when an option is selected */
  onSelect: (value: string) => void;

  /** Callback for haptic feedback (platform-specific) */
  onHapticFeedback?: () => void;

  /** Additional styles for the container */
  containerStyle?: ViewStyle;

  /** Additional styles for individual chips */
  chipStyle?: ViewStyle;
}

export const PreferencesChips: React.FC<PreferencesChipsProps> = ({
  options,
  selected,
  onSelect,
  onHapticFeedback,
  containerStyle,
  chipStyle,
}) => {
  const isSelected = (option: string): boolean => {
    if (Array.isArray(selected)) {
      return selected.includes(option);
    }
    return selected === option;
  };

  const handlePress = (option: string) => {
    if (onHapticFeedback) {
      onHapticFeedback();
    }
    onSelect(option);
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {options.map(option => (
        <TouchableOpacity
          key={option}
          style={[styles.chip, chipStyle, isSelected(option) && styles.chipSelected]}
          onPress={() => handlePress(option)}
          activeOpacity={0.8}
        >
          <Text style={[styles.chipText, isSelected(option) && styles.chipTextSelected]}>
            {option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  chipTextSelected: {
    color: '#fff',
  },
});
