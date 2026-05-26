/**
 * PulseHero
 *
 * Single rotating "insight of the day" card at the very top of the
 * Leaderboard tab. The server picks the type and the localized title-key
 * + params; the client renders. Tappable when the insight points to a
 * specific player.
 */

import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import type { NetworkPulseHeadlineInsight } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';
import type { TranslationKey } from '#/hooks';

interface PulseHeroProps {
  insight: NetworkPulseHeadlineInsight;
  onPlayerPress?: (playerId: string) => void;
}

export function PulseHero({ insight, onPlayerPress }: PulseHeroProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const tappable = !!insight.primary_player_id && !!onPlayerPress;
  const title = t(insight.title_key as TranslationKey, insight.title_params ?? {});

  const Wrapper: React.ComponentType<React.ComponentProps<typeof View>> = tappable
    ? (TouchableOpacity as unknown as React.ComponentType<React.ComponentProps<typeof View>>)
    : View;

  const wrapperProps = tappable
    ? {
        activeOpacity: 0.85,
        onPress: () => insight.primary_player_id && onPlayerPress?.(insight.primary_player_id),
      }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      style={[
        styles.card,
        {
          backgroundColor: isDark ? `${primary[700]}26` : primary[50],
          borderColor: isDark ? primary[700] : primary[200],
        },
      ]}
    >
      <Text size="base" weight="semibold" style={{ color: colors.text }} numberOfLines={2}>
        {title}
      </Text>
      {tappable && (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textMuted}
          style={styles.chevron}
        />
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacingPixels[4],
  },
  chevron: {
    marginLeft: spacingPixels[3],
  },
});

export default PulseHero;
