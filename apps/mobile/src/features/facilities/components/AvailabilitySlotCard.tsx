/**
 * AvailabilitySlotCard Component
 * Displays an individual availability slot with time, court count, price,
 * and availability indicators. Features press animation and visual state differentiation.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Animated, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, status } from '@rallia/design-system';
import type { FormattedSlot } from '@rallia/shared-hooks';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

interface AvailabilitySlotCardProps {
  slot: FormattedSlot;
  onPress: () => void;
  /** Fully disabled - all courts are paid and payments not enabled */
  disabled?: boolean;
  /** Partially disabled - some courts are free, some are paid (payments not enabled) */
  partiallyDisabled?: boolean;
  /** Animation delay for staggered entry */
  animationDelay?: number;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
    background: string;
  };
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

/**
 * Get availability level based on court count
 */
function getAvailabilityLevel(courtCount: number): 'high' | 'medium' | 'low' {
  if (courtCount >= 3) return 'high';
  if (courtCount >= 2) return 'medium';
  return 'low';
}

/**
 * Get availability indicator color
 */
function getAvailabilityColor(level: 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'high':
      return status.success.light;
    case 'medium':
      return status.warning.DEFAULT;
    case 'low':
      return status.error.DEFAULT;
  }
}

/**
 * Format price (already in dollars) to display string
 */
function formatPrice(price: number | undefined): string {
  if (price === undefined || price === 0) return '';
  return `$${price.toFixed(0)}`;
}

export default function AvailabilitySlotCard({
  slot,
  onPress,
  disabled = false,
  partiallyDisabled = false,
  animationDelay = 0,
  colors,
  isDark,
  t,
}: AvailabilitySlotCardProps) {
  const isLocalSlot = slot.isLocalSlot === true;
  const scaleAnim = useMemo(() => new Animated.Value(1), []);
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const slideAnim = useMemo(() => new Animated.Value(10), []);

  // Entry animation
  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        delay: animationDelay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        delay: animationDelay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animationDelay, fadeAnim, slideAnim]);

  // Press animation handlers
  const handlePressIn = useCallback(() => {
    if (disabled) return;
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  }, [disabled, scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  // When partially disabled (payments not enabled, some courts are paid),
  // only show price if all available courts are free
  let displayPrice: number | undefined;
  if (partiallyDisabled && isLocalSlot && slot.courtOptions) {
    const freeCourtOptions = slot.courtOptions.filter(opt => (opt.price ?? 0) === 0);
    if (freeCourtOptions.length > 0) {
      displayPrice = 0;
    } else {
      displayPrice = slot.price;
    }
  } else {
    displayPrice = slot.price;
  }

  const priceText = formatPrice(displayPrice);
  const hasPrice = Boolean(priceText);

  // Availability level
  const availabilityLevel = getAvailabilityLevel(slot.courtCount);
  const availabilityColor = getAvailabilityColor(availabilityLevel);

  // Colors — unified teal for all slot types
  const disabledOpacity = disabled ? 0.5 : 1;
  const cardBorderColor = primary[400];

  return (
    <TouchableWithoutFeedback
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderColor: cardBorderColor,
            borderWidth: 1.5,
            opacity: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, disabledOpacity],
            }),
            transform: [{ scale: scaleAnim }, { translateY: slideAnim }],
          },
        ]}
      >
        {/* Time - Hero element */}
        <Text size="xl" weight="bold" color={colors.text} style={styles.time}>
          {slot.time}
        </Text>

        {/* Availability indicator */}
        <View style={styles.availabilityRow}>
          <View
            style={[
              styles.availabilityDot,
              { backgroundColor: disabled ? neutral[400] : availabilityColor },
            ]}
          />
          <Text size="xs" weight="medium" color={colors.textMuted}>
            {slot.courtCount} {slot.courtCount === 1 ? 'court' : 'courts'}
          </Text>
        </View>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Price section */}
        <View style={styles.priceSection}>
          {hasPrice ? (
            <Text size="base" weight="bold" color={status.success.light}>
              {priceText}
            </Text>
          ) : (
            <View
              style={[
                styles.freeBadge,
                { backgroundColor: isDark ? neutral[700] : status.success.light + '15' },
              ]}
            >
              <Text size="xs" weight="semibold" color={status.success.light}>
                {t('facilityDetail.free')}
              </Text>
            </View>
          )}
        </View>

        {/* Source/Status indicator */}
        <View style={styles.sourceRow}>
          {disabled && hasPrice && isLocalSlot ? (
            <>
              <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
              <Text size="xs" weight="medium" color={colors.textMuted}>
                {t('facilityDetail.unavailable')}
              </Text>
            </>
          ) : partiallyDisabled && isLocalSlot ? (
            <>
              <View style={[styles.statusDot, { backgroundColor: status.warning.DEFAULT }]} />
              <Text size="xs" weight="medium" color={status.warning.DEFAULT}>
                {t('facilityDetail.limited')}
              </Text>
            </>
          ) : isLocalSlot ? (
            <>
              <Ionicons name="flash" size={11} color={primary[500]} />
              <Text size="xs" weight="semibold" color={primary[500]}>
                {t('facilityDetail.bookNow')}
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="open-outline" size={11} color={primary[500]} />
              <Text size="xs" weight="medium" color={primary[500]}>
                {t('facilityDetail.external')}
              </Text>
            </>
          )}
        </View>

        {/* Limited availability warning */}
        {availabilityLevel === 'low' && !disabled && (
          <View style={[styles.limitedBanner, { backgroundColor: status.error.DEFAULT + '15' }]}>
            <Text
              size="xs"
              weight="medium"
              color={status.error.DEFAULT}
              style={{ textAlign: 'center' }}
            >
              {t('facilityDetail.lastSpot')}
            </Text>
          </View>
        )}
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 110,
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
    paddingBottom: spacingPixels[2.5],
    paddingTop: spacingPixels[0.5],
  },
  time: {
    textAlign: 'center',
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[1],
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  availabilityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  divider: {
    height: 1,
    marginHorizontal: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  priceSection: {
    alignItems: 'center',
    minHeight: 24,
    justifyContent: 'center',
  },
  freeBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacingPixels[2],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  limitedBanner: {
    marginTop: spacingPixels[2],
    marginHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
  },
});
