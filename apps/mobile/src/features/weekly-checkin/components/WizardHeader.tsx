/**
 * WizardHeader — back chevron (intermediate steps) + progress dots.
 *
 * The weekly check-in is mandatory: there is no exit affordance. The empty
 * right-hand slot is kept so the progress dots stay centered against the back
 * chevron on the left.
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
  /** Hide the back chevron on the first step. */
  showBack: boolean;
  /** Hold the dots until the count is final (context loaded) so it never jumps. */
  showDots?: boolean;
}

export function WizardHeader({
  currentStep,
  totalSteps,
  onBack,
  showBack,
  showDots = true,
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

      {showDots ? <ProgressDots current={currentStep} total={totalSteps} /> : <View />}

      {/* Empty slot balances the back chevron so the dots stay centered. */}
      <View style={styles.sideSlot} />
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
});
