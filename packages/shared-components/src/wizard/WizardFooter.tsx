/**
 * The sticky wizard footer and its single primary action. `trailingIcon`
 * matches what each wizard draws today: an arrow while stepping forward, a
 * checkmark on submit where the wizard used one, nothing otherwise.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { Text } from '../foundation/Text';

import type { WizardColors } from './types';

export interface WizardFooterProps {
  label: string;
  onPress: () => void;
  colors: WizardColors;
  disabled?: boolean;
  /** Replaces the label with a spinner. */
  isSubmitting?: boolean;
  trailingIcon?: 'arrow' | 'check' | 'none';
  /** Extra bottom padding where the wizard sits above the home indicator. */
  paddingBottom?: number;
  testID?: string;
  accessibilityLabel?: string;
}

export const WizardFooter: React.FC<WizardFooterProps> = ({
  label,
  onPress,
  colors,
  disabled = false,
  isSubmitting = false,
  trailingIcon = 'none',
  paddingBottom,
  testID,
  accessibilityLabel,
}) => (
  <View
    style={[
      styles.footer,
      { borderTopColor: colors.border },
      paddingBottom != null && { paddingBottom },
    ]}
  >
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        { backgroundColor: colors.buttonActive },
        disabled && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      {isSubmitting ? (
        <ActivityIndicator color={colors.buttonTextActive} />
      ) : (
        <>
          <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
            {label}
          </Text>
          {trailingIcon === 'arrow' && (
            <Ionicons name="arrow-forward-outline" size={20} color={colors.buttonTextActive} />
          )}
          {trailingIcon === 'check' && (
            <Ionicons name="checkmark-outline" size={20} color={colors.buttonTextActive} />
          )}
        </>
      )}
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
