/**
 * MatchOrganizerBanner
 *
 * A prominent, pinned CTA bar at the top of a chat (below the header, above the
 * messages) that opens the Match Organizer. Shown only when organizing a game
 * is available in this chat (small direct/group chat or a tournament round chat
 * with no game created yet). Replaces the subtle calendar icon in the input.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, primary } from '@rallia/design-system';

import { useThemeStyles, useTranslation } from '#/hooks';

const WHITE = '#ffffff';

interface MatchOrganizerBannerProps {
  onPress: () => void;
}

export function MatchOrganizerBanner({ onPress }: MatchOrganizerBannerProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const accent = isDark ? primary[500] : primary[600];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: accent, borderBottomColor: colors.border },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('matchOrganizer.banner.title')}
    >
      <View style={styles.iconCircle}>
        <Ionicons name="calendar" size={20} color={WHITE} />
      </View>
      <View style={styles.textBlock}>
        <Text size="sm" weight="bold" color={WHITE}>
          {t('matchOrganizer.banner.title')}
        </Text>
        <Text size="xs" color="rgba(255,255,255,0.88)" lineHeight="tight" style={styles.subtitle}>
          {t('matchOrganizer.banner.subtitle')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.9)" />
    </Pressable>
  );
}

export default MatchOrganizerBanner;

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
    backgroundColor: 'rgba(255,255,255,0.22)',
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
