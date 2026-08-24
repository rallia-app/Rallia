/**
 * WizardHeader — back chevron (intermediate steps) + progress dots + close (X).
 *
 * The close affordance sits in the right-hand slot; when it's absent the empty
 * slot is kept so the progress dots stay centered against the back chevron.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '@rallia/shared-hooks';
import { spacingPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { WizardProgressDots } from '@rallia/shared-components';

interface WizardHeaderProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  /** Hide the back chevron on the first step. */
  showBack: boolean;
  /** Hold the dots until the count is final (context loaded) so it never jumps. */
  showDots?: boolean;
  /** When provided, renders a close (X) in the top-right that dismisses the wizard. */
  onClose?: () => void;
  /** Accessible label for the close button. */
  closeLabel?: string;
}

export function WizardHeader({
  currentStep,
  totalSteps,
  onBack,
  showBack,
  showDots = true,
  onClose,
  closeLabel = 'Close',
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

      {showDots ? <WizardProgressDots current={currentStep} total={totalSteps} /> : <View />}

      <View style={styles.sideSlot}>
        {onClose && (
          <TouchableOpacity
            onPress={() => {
              lightHaptic();
              onClose();
            }}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        )}
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
});
