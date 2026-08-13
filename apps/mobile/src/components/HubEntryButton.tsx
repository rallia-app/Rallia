import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useEventListColors } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';

/**
 * The two entry-point affordances a hub list puts above its feed: one filled
 * button for the create action, and outlined rows for everything else the
 * reader might jump to. Shared by the Events list and the public games feed so
 * both hubs open the same way.
 */

/** Filled call to action — the one thing the hub wants you to start. */
export const PrimaryEntryButton: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID?: string;
}> = ({ icon, title, subtitle, onPress, testID }) => (
  <TouchableOpacity
    onPress={() => {
      void lightHaptic();
      onPress();
    }}
    activeOpacity={0.85}
    style={styles.primary}
    accessibilityRole="button"
    accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    testID={testID}
  >
    <View style={styles.primaryIcon}>
      <Ionicons name={icon} size={26} color="#ffffff" />
    </View>
    <View style={styles.primaryTextWrap}>
      <Text size="base" weight="semibold" color="#ffffff" numberOfLines={1}>
        {title}
      </Text>
      {/* One line, always: the longest translation shrinks to fit rather than
          wrapping under the icon or getting cut off. */}
      {subtitle ? (
        <Text
          size="xs"
          color="rgba(255,255,255,0.85)"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.75)" />
  </TouchableOpacity>
);

/**
 * Outlined row. `trailing` carries a live value (a standing, a count) when the
 * destination has one worth previewing.
 */
export const RowEntryButton: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: string;
  onPress: () => void;
  testID?: string;
}> = ({ icon, label, trailing, onPress, testID }) => {
  const colors = useEventListColors();
  return (
    <TouchableOpacity
      onPress={() => {
        void lightHaptic();
        onPress();
      }}
      activeOpacity={0.85}
      style={[
        styles.row,
        { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
      ]}
      accessibilityRole="button"
      accessibilityLabel={trailing ? `${label}. ${trailing}` : label}
      testID={testID}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.chipPrimaryBg }]}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text size="sm" weight="semibold" color={colors.text} style={styles.rowLabel}>
        {label}
      </Text>
      {trailing ? (
        <Text size="sm" weight="semibold" color={colors.primary} numberOfLines={1}>
          {trailing}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  primary: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    borderColor: primary[600],
    backgroundColor: primary[500],
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    shadowColor: primary[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTextWrap: {
    flex: 1,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[3],
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
  },
});
