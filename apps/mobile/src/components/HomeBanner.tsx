/**
 * HomeBanner — single primitive for every Home-screen header banner.
 *
 * Replaces the ad-hoc styling that grew across BillingIssueBanner,
 * ReferenceRequestsBanner, CrossSportBanner, SecondSportBanner, and
 * ProfileCompletionBanner. Each call site now picks a `variant` for the tint
 * and supplies a leading element (icon, sport icon, completion ring),
 * title/description, CTA, and optional dismiss — the layout, paddings,
 * borders, and stack rhythm are owned here so the five banners stack as a
 * cohesive set.
 */

import React, { createContext, useContext } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  status as statusColors,
  secondary,
} from '@rallia/design-system';
import { useThemeStyles } from '@rallia/shared-hooks';

/**
 * Layout mode — set by the parent (HomeBannerCarousel vs. single-banner row)
 * so each HomeBanner picks the right width without prop-drilling through the
 * five wrapper banners.
 */
type HomeBannerLayout = 'card' | 'fullWidth';
const HomeBannerLayoutContext = createContext<HomeBannerLayout>('card');

export const HomeBannerLayoutProvider: React.FC<{
  layout: HomeBannerLayout;
  children: React.ReactNode;
}> = ({ layout, children }) => (
  <HomeBannerLayoutContext.Provider value={layout}>{children}</HomeBannerLayoutContext.Provider>
);

export type HomeBannerVariant = 'info' | 'warning' | 'success' | 'action' | 'danger';

export interface HomeBannerProps {
  /** Tint and CTA color family. Default `action` (primary). */
  variant?: HomeBannerVariant;
  /**
   * Custom leading element — e.g., a SportIcon or progress ring. Wins over
   * `icon`. The render function receives the resolved accent color so the
   * caller can color its glyph to match the banner variant.
   */
  leading?: ((accent: string) => React.ReactNode) | React.ReactNode;
  /** Ionicon shorthand if no custom leading is provided. */
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Two-line body that sits under the title row. */
  description?: string;
  primaryAction?: { label: string; onPress: () => void };
  onDismiss?: () => void;
  /** Optional fade animation (used by SecondSportBanner). */
  fadeAnim?: Animated.Value;
}

function variantTint(
  variant: HomeBannerVariant,
  primary: string
): { accent: string; bg: string; border: string } {
  const accent =
    variant === 'warning'
      ? statusColors.warning.DEFAULT
      : variant === 'info'
        ? statusColors.info.DEFAULT
        : variant === 'success'
          ? statusColors.success.DEFAULT
          : variant === 'danger'
            ? secondary[500]
            : primary;
  // 7% / 22% opacity — soft tint, readable border at every brightness.
  return { accent, bg: `${accent}12`, border: `${accent}38` };
}

/** Resolve the accent color for a variant — exported so call sites that pass
 *  custom leading nodes can color them to match the banner variant. */
export function useHomeBannerAccent(variant: HomeBannerVariant = 'action'): string {
  const { colors } = useThemeStyles();
  return variantTint(variant, colors.primary).accent;
}

const HomeBanner: React.FC<HomeBannerProps> = ({
  variant = 'action',
  leading,
  icon,
  title,
  description,
  primaryAction,
  onDismiss,
  fadeAnim,
}) => {
  const { colors } = useThemeStyles();
  const { accent, bg, border } = variantTint(variant, colors.primary);
  const layout = useContext(HomeBannerLayoutContext);

  const Wrapper = fadeAnim ? Animated.View : View;
  const wrapperStyle = fadeAnim ? { opacity: fadeAnim } : null;
  const layoutStyle = layout === 'fullWidth' ? styles.fullWidth : styles.card;

  const resolvedLeading: React.ReactNode =
    typeof leading === 'function'
      ? leading(accent)
      : (leading ?? (icon ? <Ionicons name={icon} size={20} color={accent} /> : null));

  return (
    <Wrapper
      style={[
        styles.container,
        layoutStyle,
        { backgroundColor: bg, borderColor: border },
        wrapperStyle,
      ]}
    >
      <View style={styles.headerRow}>
        {resolvedLeading ? <View style={styles.leading}>{resolvedLeading}</View> : null}
        <Text
          size="sm"
          weight="semibold"
          color={colors.text}
          style={styles.title}
          numberOfLines={1}
        >
          {title}
        </Text>
        {onDismiss ? (
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.dismiss}
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {description ? (
        <Text size="xs" color={colors.textMuted} numberOfLines={2} style={styles.description}>
          {description}
        </Text>
      ) : null}

      {primaryAction ? (
        <TouchableOpacity
          onPress={primaryAction.onPress}
          activeOpacity={0.85}
          style={[styles.cta, { backgroundColor: accent }]}
        >
          <Text size="xs" weight="semibold" color="#FFFFFF">
            {primaryAction.label}
          </Text>
        </TouchableOpacity>
      ) : null}
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[2],
  },
  card: {
    width: 260,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  leading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  dismiss: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    // Reserve exactly two lines of vertical space (xs ≈ 12px @ 1.5 line height)
    // so banners stack at a uniform height across locales, even if the
    // translated copy is shorter than two lines on a wide screen.
    lineHeight: 16,
    minHeight: 32,
  },
  cta: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    marginTop: spacingPixels[1],
  },
});

export default HomeBanner;
