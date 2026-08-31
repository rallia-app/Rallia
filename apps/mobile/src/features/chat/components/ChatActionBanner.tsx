/**
 * ChatActionBanner
 *
 * The pinned CTA bar at the top of a chat (below the header, above the
 * messages). One styling source for every such bar.
 *
 * Tone carries the meaning, not just the weight: 'primary' (teal) is the
 * forward-looking action — organize the next game — and 'accent' (gold, the
 * colour this app already uses for trophies and champions) is the result of
 * one already played. Both are filled, so a chat that offers both shows two
 * unmistakable bars that cannot be mistaken for each other.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, primary, accent, neutral, base } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

export interface ChatActionBannerProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** 'primary' = organize a game (teal); 'accent' = a played result (gold). */
  tone?: 'primary' | 'accent';
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
  const isAccent = tone === 'accent';

  // Gold carries near-black text on either theme, so it needs no flip; teal
  // carries white, and that opposite polarity is half of what tells them apart.
  const background = isAccent ? accent[400] : isDark ? primary[500] : primary[600];
  const titleColor = isAccent ? neutral[950] : base.white;
  const subtitleColor = isAccent ? neutral[800] : 'rgba(255,255,255,0.88)';
  const bubbleColor = isAccent ? 'rgba(12,21,20,0.14)' : 'rgba(255,255,255,0.22)';

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
      <View style={[styles.iconCircle, { backgroundColor: bubbleColor }]}>
        <Ionicons name={icon} size={20} color={titleColor} />
      </View>
      <View style={styles.textBlock}>
        <Text size="base" weight="bold" color={titleColor}>
          {title}
        </Text>
        <Text size="xs" color={subtitleColor} lineHeight="tight" style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={titleColor} />
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
    paddingVertical: spacingPixels[3.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.9,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
