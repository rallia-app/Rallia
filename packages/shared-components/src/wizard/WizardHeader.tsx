/**
 * Wizard top bar: back chevron, centred badge, close button. Identical in the
 * match, league, tournament, auth and onboarding wizards, so it lives here.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { Text } from '../foundation/Text';

import type { WizardColors } from './types';

export interface WizardHeaderProps {
  /** False hides the chevron and keeps the badge centred with a spacer. */
  showBack?: boolean;
  onBack: () => void;
  onClose: () => void;
  /** Glyph inside the centre pill, e.g. a sport icon. */
  badgeIcon?: React.ReactNode;
  badgeLabel?: string;
  colors: WizardColors;
  backAccessibilityLabel: string;
  closeAccessibilityLabel: string;
}

export const WizardHeader: React.FC<WizardHeaderProps> = ({
  showBack = true,
  onBack,
  onClose,
  badgeIcon,
  badgeLabel,
  colors,
  backAccessibilityLabel,
  closeAccessibilityLabel,
}) => (
  <View style={[styles.header, { borderBottomColor: colors.border }]}>
    <View style={styles.headerLeft}>
      {showBack && (
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            void lightHaptic();
            onBack();
          }}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={backAccessibilityLabel}
        >
          <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
        </TouchableOpacity>
      )}
    </View>

    {badgeLabel != null && (
      <View style={[styles.badge, { backgroundColor: colors.buttonActive }]}>
        {badgeIcon}
        <Text size="sm" weight="semibold" color="#ffffff">
          {badgeLabel}
        </Text>
      </View>
    )}

    <View style={styles.headerRight}>
      <TouchableOpacity
        onPress={() => {
          Keyboard.dismiss();
          void lightHaptic();
          onClose();
        }}
        style={styles.headerButton}
        accessibilityRole="button"
        accessibilityLabel={closeAccessibilityLabel}
      >
        <Ionicons name="close-outline" size={24} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1.5],
  },
});
