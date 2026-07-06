/**
 * PolicyConsentCheckbox
 *
 * Shared consent-checkbox card (icon-circle badge + bordered, checked-tint
 * card with an inline policy link) used by both the onboarding wizard's
 * ConsentStep (new signups) and the standalone re-consent gate screen
 * (existing users, on a policy version bump) — one place for the visual
 * language and copy behavior instead of two forks.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { primary, spacingPixels, radiusPixels } from '@rallia/design-system';

export interface PolicyConsentColors {
  text: string;
  textSecondary: string;
  textMuted: string;
  buttonActive: string;
  inputBackground: string;
  inputBorder: string;
}

export interface PolicyConsentTint {
  iconColor: string;
  iconBackgroundColor: string;
  checkedTint: string;
}

export function getPolicyConsentTint(isDark: boolean): PolicyConsentTint {
  return {
    iconColor: isDark ? primary[400] : primary[600],
    iconBackgroundColor: isDark ? `${primary[400]}20` : `${primary[600]}15`,
    checkedTint: isDark ? `${primary[400]}1a` : `${primary[600]}0d`,
  };
}

export function PolicyConsentIconBadge({ isDark }: { isDark: boolean }) {
  const { iconColor, iconBackgroundColor } = getPolicyConsentTint(isDark);
  return (
    <View style={[styles.iconCircle, { backgroundColor: iconBackgroundColor }]}>
      <Ionicons name="shield-checkmark-outline" size={28} color={iconColor} />
    </View>
  );
}

interface PolicyConsentCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  prefix: string;
  linkLabel: string;
  suffix: string;
  url: string;
  colors: PolicyConsentColors;
  checkedTint: string;
}

export const PolicyConsentCheckbox: React.FC<PolicyConsentCheckboxProps> = ({
  checked,
  onToggle,
  prefix,
  linkLabel,
  suffix,
  url,
  colors,
  checkedTint,
}) => (
  <TouchableOpacity
    style={[
      styles.consentCard,
      {
        backgroundColor: checked ? checkedTint : colors.inputBackground,
        borderColor: checked ? colors.buttonActive : colors.inputBorder,
      },
    ]}
    onPress={onToggle}
    activeOpacity={0.7}
    accessibilityRole="checkbox"
    accessibilityState={{ checked }}
    accessibilityLabel={`${prefix}${linkLabel}${suffix}`}
  >
    <Ionicons
      name={checked ? 'checkbox' : 'square-outline'}
      size={22}
      color={checked ? colors.buttonActive : colors.textMuted}
      style={styles.consentCheckboxIcon}
    />
    <Text size="sm" color={colors.textSecondary} style={styles.consentText}>
      {prefix}
      <Text
        size="sm"
        weight="semibold"
        color={primary[500]}
        style={styles.termsLink}
        onPress={() => Linking.openURL(url)}
      >
        {linkLabel}
      </Text>
      {suffix}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacingPixels[4],
  },
  consentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1.5,
  },
  consentCheckboxIcon: {
    marginRight: spacingPixels[3],
    marginTop: 1,
  },
  consentText: {
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
});

export default PolicyConsentCheckbox;
