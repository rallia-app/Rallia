/**
 * WizardHeader — back chevron (steps 2-4), progress dots, discrete × button.
 *
 * The × is intentionally faint (30% opacity) — per the prototype spec, exit
 * is meant to be discoverable but not inviting. Tapping it raises the
 * exit-confirmation prompt; only confirming there actually dismisses the wizard.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { ProgressDots } from './ProgressDots';

interface WizardHeaderProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onRequestExit: () => void;
  /** Hide the back chevron on the first step. */
  showBack: boolean;
}

export function WizardHeader({
  currentStep,
  totalSteps,
  onBack,
  onRequestExit,
  showBack,
}: WizardHeaderProps) {
  const { colors } = useThemeStyles();

  return (
    <View style={styles.row}>
      <View style={styles.sideSlot}>
        {showBack && (
          <TouchableOpacity
            onPress={() => {
              lightHaptic();
              onBack();
            }}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      <ProgressDots current={currentStep} total={totalSteps} />

      <View style={styles.sideSlot}>
        <TouchableOpacity
          onPress={() => {
            lightHaptic();
            onRequestExit();
          }}
          style={[styles.iconButton, styles.closeButton]}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[3],
  },
  sideSlot: {
    width: 36,
    alignItems: 'center',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    opacity: 0.3, // discrete — see prototype spec
  },
});
