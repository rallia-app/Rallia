/**
 * ChatActionBanner
 *
 * The pinned CTA bar at the top of a chat (below the header, above the
 * messages). One styling source for every such bar: MatchOrganizerBanner is the
 * 'primary' one, and the pairing score entry uses 'subtle' so the two can stack
 * in a round chat without shouting over each other.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, primary } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

const WHITE = '#ffffff';

export interface ChatActionBannerProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** 'primary' fills with the brand colour; 'subtle' tints it. */
  tone?: 'primary' | 'subtle';
  accessibilityLabel?: string;
  testID?: string;
}

export function ChatActionBanner({
  icon,
  title,
  subtitle,
  onPress,
  tone = 'primary',
  accessibilityLabel,
  testID,
}: ChatActionBannerProps) {
  const { colors, isDark } = useThemeStyles();
  const accent = isDark ? primary[500] : primary[600];
  const isSubtle = tone === 'subtle';

  const background = isSubtle ? (isDark ? primary[950] : primary[50]) : accent;
  const titleColor = isSubtle ? colors.text : WHITE;
  const subtitleColor = isSubtle ? colors.textMuted : 'rgba(255,255,255,0.88)';
  const iconColor = isSubtle ? accent : WHITE;
  const chevronColor = isSubtle ? accent : 'rgba(255,255,255,0.9)';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: background, borderBottomColor: colors.border },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      testID={testID}
    >
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: isSubtle ? `${accent}20` : 'rgba(255,255,255,0.22)' },
        ]}
      >
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.textBlock}>
        <Text size="sm" weight="bold" color={titleColor}>
          {title}
        </Text>
        <Text size="xs" color={subtitleColor} lineHeight="tight" style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={chevronColor} />
    </Pressable>
  );
}

export default ChatActionBanner;

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.9,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
  },
  subtitle: {
    marginTop: 1,
  },
});
