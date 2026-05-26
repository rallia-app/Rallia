/**
 * CertificationBadge Component
 *
 * Displays the certification status of a player's rating with color-coded badges.
 * - Yellow: Self-Declared (unverified rating)
 * - Green: Certified (verified by references or proofs)
 * - Red: Disputed (peer evaluations suggest different level)
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, fontSizePixels, primary } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

export type BadgeStatus = 'self_declared' | 'certified' | 'disputed';

export interface CertificationBadgeProps {
  /**
   * The certification status
   */
  status: BadgeStatus;

  /**
   * Size of the badge
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg';

  /**
   * Whether to show full label or just icon
   * @default true
   */
  showLabel?: boolean;

  /**
   * Whether to show tooltip on press
   * @default false
   */
  showTooltip?: boolean;

  /**
   * Callback when badge is pressed (for info display)
   */
  onPress?: () => void;

  /**
   * Additional style overrides
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

interface BadgeColorScheme {
  background: string;
  border: string;
  text: string;
  icon: string;
}

/**
 * Get the icon name for each status
 */
const getStatusIcon = (status: BadgeStatus): keyof typeof Ionicons.glyphMap => {
  switch (status) {
    case 'certified':
      return 'checkmark-circle';
    case 'disputed':
      return 'alert-circle';
    case 'self_declared':
    default:
      return 'help-circle';
  }
};

/**
 * CertificationBadge component for displaying rating certification status
 *
 * @example
 * ```tsx
 * // Basic usage
 * <CertificationBadge status="certified" />
 *
 * // Small size, icon only
 * <CertificationBadge status="self_declared" size="sm" showLabel={false} />
 *
 * // With press handler
 * <CertificationBadge
 *   status="disputed"
 *   onPress={() => showCertificationInfo()}
 * />
 * ```
 */
export const CertificationBadge: React.FC<CertificationBadgeProps> = ({
  status,
  size = 'md',
  showLabel = true,
  onPress,
  style,
  testID = 'certification-badge',
}) => {
  const { isDark } = useThemeStyles();
  const { t } = useTranslation();

  // Theme-aware color schemes matching SportProfile's getCertificationColors
  const getColorScheme = (badgeStatus: BadgeStatus): BadgeColorScheme => {
    const accent =
      badgeStatus === 'certified'
        ? '#4CAF50'
        : badgeStatus === 'disputed'
          ? '#F44336'
          : isDark
            ? primary[400]
            : primary[500];
    const bg = isDark ? `${accent}30` : `${accent}15`;
    return { background: bg, border: accent, text: accent, icon: accent };
  };

  // Get size-specific dimensions
  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingHorizontal: spacingPixels[1], // 4px
          paddingVertical: spacingPixels[0.5], // 2px
          fontSize: fontSizePixels.xs,
          iconSize: 12,
          gap: spacingPixels[0.5], // 2px
        };
      case 'lg':
        return {
          paddingHorizontal: spacingPixels[3], // 12px
          paddingVertical: spacingPixels[2], // 8px
          fontSize: fontSizePixels.base,
          iconSize: 20,
          gap: spacingPixels[2], // 8px
        };
      case 'md':
      default:
        return {
          paddingHorizontal: spacingPixels[2], // 8px
          paddingVertical: spacingPixels[1], // 4px
          fontSize: fontSizePixels.sm,
          iconSize: 16,
          gap: spacingPixels[1], // 4px
        };
    }
  };

  // Get translation key for badge label
  const getBadgeLabel = (badgeStatus: BadgeStatus): string => {
    switch (badgeStatus) {
      case 'certified':
        return t('profile.certification.badge.certified');
      case 'disputed':
        return t('profile.certification.badge.disputed');
      case 'self_declared':
      default:
        return t('profile.certification.badge.selfDeclared');
    }
  };

  const colorScheme = getColorScheme(status);
  const sizeStyles = getSizeStyles();
  const iconName = getStatusIcon(status);
  const label = getBadgeLabel(status);

  const BadgeContent = (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colorScheme.background,
          borderColor: colorScheme.border,
          paddingHorizontal: sizeStyles.paddingHorizontal,
          paddingVertical: sizeStyles.paddingVertical,
        },
        style,
      ]}
      testID={testID}
    >
      <Ionicons name={iconName} size={sizeStyles.iconSize} color={colorScheme.icon} />
      {showLabel && (
        <Text
          style={[
            styles.label,
            {
              color: colorScheme.text,
              fontSize: sizeStyles.fontSize,
              marginLeft: sizeStyles.gap,
            },
          ]}
        >
          {label}
        </Text>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {BadgeContent}
      </TouchableOpacity>
    );
  }

  return BadgeContent;
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radiusPixels.full,
  },
  label: {
    fontWeight: '500',
  },
});

export default CertificationBadge;
