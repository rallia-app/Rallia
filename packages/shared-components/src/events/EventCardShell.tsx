/**
 * The card chrome every event format shares: banner with an overlay row and a
 * title scrim, a body for the fact line, and a divided footer. Formats fill the
 * slots; none of them re-draw the box.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';

import { Text } from '../foundation/Text';
import { Skeleton } from '../feedback/Skeleton';

import type { EventListColors } from './eventListColors';

export interface EventCardShellProps {
  colors: EventListColors;
  onPress: () => void;
  testID?: string;
  /** The format's banner component, drawn at its own aspect ratio. */
  banner: React.ReactNode;
  /** Overlaid on the banner, leading edge (the status pill). */
  bannerTopLeft?: React.ReactNode;
  /** Overlaid on the banner, trailing edge (prize, ranking points). */
  bannerTopRight?: React.ReactNode;
  title: string;
  /** Second scrim line: dates, venue, whatever identifies the event. */
  subtitle?: string | null;
  /** The fact line, normally an EventMetaRow. */
  meta?: React.ReactNode;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
}

export const EventCardShell: React.FC<EventCardShellProps> = ({
  colors,
  onPress,
  testID,
  banner,
  bannerTopLeft,
  bannerTopRight,
  title,
  subtitle,
  meta,
  footerLeft,
  footerRight,
}) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    testID={testID}
    style={[
      styles.card,
      { backgroundColor: colors.cardBackground, borderColor: colors.cardBorder },
    ]}
  >
    <View style={styles.bannerWrap}>
      {banner}
      {(bannerTopLeft || bannerTopRight) && (
        <View style={styles.bannerTopRow}>
          {bannerTopLeft}
          {bannerTopRight && <View style={styles.bannerBadges}>{bannerTopRight}</View>}
        </View>
      )}
      {/* Scrim is deliberately shallow and light: it only has to carry two
          lines, and the text shadow does the rest of the legibility work, so
          the artwork stays visible. */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.66)']}
        locations={[0, 0.42, 1]}
        style={styles.bannerScrim}
      >
        <Text
          size="base"
          weight="semibold"
          color="#ffffff"
          numberOfLines={1}
          style={styles.scrimText}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text size="xs" color="rgba(255,255,255,0.92)" numberOfLines={1} style={styles.scrimText}>
            {subtitle}
          </Text>
        ) : null}
      </LinearGradient>
    </View>

    <View style={styles.cardBody}>
      {meta}
      {(footerLeft || footerRight) && (
        <View style={[styles.cardFooter, { borderTopColor: colors.cardBorder }]}>
          {footerLeft}
          {footerRight}
        </View>
      )}
    </View>
  </TouchableOpacity>
);

export interface EventFooterLinkProps {
  label: string;
  color: string;
}

/** The card footer's trailing affordance: a short label and a chevron. */
export const EventFooterLink: React.FC<EventFooterLinkProps> = ({ label, color }) => (
  <View style={styles.footerLink}>
    <Text size="xs" weight="semibold" color={color}>
      {label}
    </Text>
    <Ionicons name="chevron-forward" size={13} color={color} />
  </View>
);

export interface EventCardSkeletonProps {
  /** The banner's width:height ratio, so the placeholder box matches the card. */
  bannerAspect: number;
}

/** Loading placeholder shaped like an EventCardShell, primary-tinted like MatchCardSkeleton. */
export const EventCardSkeleton: React.FC<EventCardSkeletonProps> = ({ bannerAspect }) => {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const isDark = theme === 'dark';
  // Skeleton takes a numeric height, so mirror the card banner's box.
  const bannerHeight = Math.round((width - spacingPixels[4] * 2) / bannerAspect);
  const bone = isDark ? primary[900] : primary[100];
  const boneHighlight = isDark ? primary[800] : primary[50];
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? primary[950] : primary[50],
          borderColor: isDark ? `${primary[400]}40` : `${primary[500]}20`,
        },
      ]}
    >
      <Skeleton
        width="100%"
        height={bannerHeight}
        backgroundColor={bone}
        highlightColor={boneHighlight}
      />
      <View style={styles.cardBody}>
        <Skeleton width="65%" height={12} backgroundColor={bone} highlightColor={boneHighlight} />
        <View style={styles.cardHeader}>
          <Skeleton width={96} height={20} backgroundColor={bone} highlightColor={boneHighlight} />
          <Skeleton width={110} height={12} backgroundColor={bone} highlightColor={boneHighlight} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  bannerWrap: {
    position: 'relative',
  },
  bannerTopRow: {
    position: 'absolute',
    top: spacingPixels[2.5],
    left: spacingPixels[2.5],
    right: spacingPixels[2.5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  bannerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginLeft: 'auto',
    flexShrink: 1,
  },
  bannerScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
    gap: 1,
  },
  scrimText: {
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  cardBody: {
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2.5],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[2.5],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacingPixels[2.5],
  },
  footerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
