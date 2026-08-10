/**
 * EmptyState Component
 *
 * Full-screen empty state for list/browse screens: a large tinted icon badge
 * with an optional corner mark, bold title, muted description, and optional
 * CTA(s). Replaces hand-rolled per-screen empty states so typography, badge
 * treatment, and CTA styling stay consistent.
 *
 * The `sheet` variant is a compact version (72px badge, base title, sm
 * description, md CTA) for empty states inside action sheets, modals, and
 * wizard steps; pass its icon at 36px.
 *
 * For inline section empty states (a card inside a scrolling hub page), use
 * the section card pattern instead (see Home's myMatchesEmpty styles).
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<Ionicons name="notifications-off-outline" size={64} color={colors.primary} />}
 *   title={t('notifications.empty')}
 *   description={t('notifications.emptyDescription')}
 * />
 *
 * // With a corner mark and CTA
 * <EmptyState
 *   icon={<SportIcon sportName={sportName} size={64} color={colors.primary} />}
 *   markIcon={<Ionicons name="search" size={14} color={COLORS.white} />}
 *   title={t('publicMatches.empty.title')}
 *   description={t('publicMatches.empty.description')}
 *   ctaLabel={t('matches.createMatch')}
 *   onCtaPress={onCreatePress}
 * />
 *
 * // Compact, inside a sheet or wizard step
 * <EmptyState
 *   variant="sheet"
 *   icon={<Ionicons name="search-outline" size={36} color={colors.primary} />}
 *   title={t('inviteToMatch.noMatches')}
 *   description={t('inviteToMatch.noMatchesDescription')}
 * />
 * ```
 */

import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { useThemeStyles } from '@rallia/shared-hooks';
import { COLORS, fontSizePixels, spacingPixels } from '@rallia/design-system';

import { Text } from '../foundation/Text';
import { Button } from '../foundation/Button';

export interface EmptyStateProps {
  /** Layout scale: full `screen` (default) or compact `sheet` for sheets/modals/wizard steps */
  variant?: 'screen' | 'sheet';
  /** Large icon inside the tinted badge (recommended: 64px for screen, 36px for sheet; colors.primary) */
  icon: React.ReactNode;
  /** Small icon for the corner mark disc (recommended: 14px, COLORS.white); no mark when omitted */
  markIcon?: React.ReactNode;
  /** Bold headline */
  title: string;
  /** Muted supporting line under the title */
  description?: string;
  /** Primary CTA label; no CTA when omitted */
  ctaLabel?: string;
  /** Primary CTA press handler */
  onCtaPress?: () => void;
  /** Optional icon rendered inside the primary CTA */
  ctaLeftIcon?: React.ReactNode;
  /** Secondary (outline) CTA label; requires ctaLabel to be set */
  secondaryCtaLabel?: string;
  /** Secondary CTA press handler */
  onSecondaryCtaPress?: () => void;
  /** Small muted line under the CTA */
  helperText?: string;
  /** Additional container styles */
  style?: StyleProp<ViewStyle>;
  /** Test ID for testing */
  testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant = 'screen',
  icon,
  markIcon,
  title,
  description,
  ctaLabel,
  onCtaPress,
  ctaLeftIcon,
  secondaryCtaLabel,
  onSecondaryCtaPress,
  helperText,
  style,
  testID,
}) => {
  const { colors } = useThemeStyles();
  const isSheet = variant === 'sheet';

  return (
    <View style={[styles.container, isSheet && styles.containerSheet, style]} testID={testID}>
      <View
        style={[
          styles.badge,
          isSheet && styles.badgeSheet,
          { backgroundColor: `${colors.primary}14` },
        ]}
      >
        {icon}
        {markIcon ? (
          <View
            style={[
              styles.badgeMark,
              isSheet && styles.badgeMarkSheet,
              { backgroundColor: colors.primary },
            ]}
          >
            {markIcon}
          </View>
        ) : null}
      </View>

      <Text
        size={isSheet ? 'base' : 'xl'}
        weight={isSheet ? 'semibold' : 'bold'}
        color={colors.text}
        style={styles.title}
      >
        {title}
      </Text>
      {description ? (
        <Text
          size={isSheet ? 'sm' : 'base'}
          color={colors.textMuted}
          style={isSheet ? styles.descriptionSheet : styles.description}
        >
          {description}
        </Text>
      ) : null}

      {ctaLabel && onCtaPress ? (
        <Button
          variant="primary"
          size={isSheet ? 'md' : 'lg'}
          fullWidth={!isSheet}
          rounded
          onPress={onCtaPress}
          leftIcon={ctaLeftIcon}
          style={isSheet ? styles.ctaSheet : styles.cta}
        >
          {ctaLabel}
        </Button>
      ) : null}
      {secondaryCtaLabel && onSecondaryCtaPress ? (
        <Button
          variant="outline"
          size={isSheet ? 'md' : 'lg'}
          fullWidth={!isSheet}
          rounded
          onPress={onSecondaryCtaPress}
          style={styles.secondaryCta}
        >
          {secondaryCtaLabel}
        </Button>
      ) : null}
      {helperText ? (
        <Text size="sm" color={colors.textMuted} style={styles.helper}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
    paddingHorizontal: spacingPixels[6],
    gap: spacingPixels[2],
  },
  containerSheet: {
    paddingVertical: spacingPixels[6],
  },
  badge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  badgeSheet: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: spacingPixels[3],
  },
  badgeMark: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  badgeMarkSheet: {
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    lineHeight: Math.round(fontSizePixels.base * 1.4),
    maxWidth: 300,
  },
  descriptionSheet: {
    textAlign: 'center',
    lineHeight: Math.round(fontSizePixels.sm * 1.4),
    maxWidth: 280,
  },
  cta: {
    marginTop: spacingPixels[6],
  },
  ctaSheet: {
    marginTop: spacingPixels[4],
  },
  secondaryCta: {
    marginTop: 0,
  },
  helper: {
    textAlign: 'center',
    marginTop: spacingPixels[1],
  },
});
