/**
 * ContactRow
 *
 * Visual primitive for any contact list row in the mobile app — device
 * contacts, shared-list contacts, opponent picker, etc.
 *
 * Provides the shared baseline (color-coded letter avatar, name, subtitle,
 * hairline separator) and exposes a `trailing` slot so each surface can supply
 * its own affordance (selection check, chevron, action menu).
 *
 * Pair with `<ContactSelectionCheck />` for multi/single-select flows.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';

import { getAvatarColor, getContactInitials } from '#/utils/contactDisplay';

const BASE_WHITE = '#ffffff';

export interface ContactRowProps {
  name: string;
  subtitle?: string;
  /** Seed used to derive the avatar color. Defaults to `name`. */
  avatarSeed?: string;
  isLast?: boolean;
  isDark?: boolean;
  /** Background tint (light selection state). Optional. */
  selectedBackground?: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Custom right-side affordance. Defaults to nothing. */
  trailing?: React.ReactNode;
  /** Override the textual content in the avatar (e.g. emoji or different initials). */
  avatarOverride?: React.ReactNode;
  /** Optional color overrides for the row text. Falls back to Text component defaults. */
  nameColor?: string;
  subtitleColor?: string;
}

export const ContactRow: React.FC<ContactRowProps> = ({
  name,
  subtitle,
  avatarSeed,
  isLast,
  isDark,
  selectedBackground,
  selected,
  onPress,
  disabled,
  trailing,
  avatarOverride,
  nameColor,
  subtitleColor,
}) => {
  const initials = getContactInitials(name);
  const avatarColor = getAvatarColor(avatarSeed ?? name);

  return (
    <TouchableOpacity
      style={[
        styles.row,
        !isLast && {
          borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        selected && selectedBackground ? { backgroundColor: selectedBackground } : null,
      ]}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={onPress ? 0.6 : 1}
    >
      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
        {avatarOverride ?? (
          <Text size="sm" weight="semibold" color={BASE_WHITE}>
            {initials}
          </Text>
        )}
      </View>
      <View style={styles.info}>
        <Text size="base" weight="semibold" numberOfLines={1} color={nameColor}>
          {name}
        </Text>
        {subtitle ? (
          <Text size="xs" numberOfLines={1} style={styles.subtitle} color={subtitleColor}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </TouchableOpacity>
  );
};

interface ContactSelectionCheckProps {
  selected: boolean;
  isDark?: boolean;
}

export const ContactSelectionCheck: React.FC<ContactSelectionCheckProps> = ({
  selected,
  isDark,
}) => (
  <View
    style={[
      checkStyles.indicator,
      selected
        ? checkStyles.indicatorSelected
        : { borderColor: isDark ? neutral[600] : neutral[300] },
    ]}
  >
    {selected && <Ionicons name="checkmark" size={16} color={BASE_WHITE} />}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
    gap: spacingPixels[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
  trailing: {
    marginLeft: spacingPixels[2],
  },
});

const checkStyles = StyleSheet.create({
  indicator: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorSelected: {
    borderColor: primary[500],
    backgroundColor: primary[500],
    borderWidth: 0,
    shadowColor: primary[500],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 2,
  },
});

export default ContactRow;
