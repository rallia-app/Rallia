import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { useThemeStyles } from '../../../hooks';

// Dimensions kept in sync with PlayerCard.tsx — change them together.
const AVATAR_SIZE = 60;
const AVATAR_RING_BORDER = 2;
const CARD_HORIZONTAL_MARGIN = spacingPixels[4];
const CARD_PADDING = spacingPixels[4];
const DAY_CELL_COUNT = 7;
// Text-box heights (fontSize × normal lineHeight 1.5). Match these to reserve
// the exact vertical space the real Text component will occupy on swap-in.
const NAME_LINE_HEIGHT = 24; // base: 16 × 1.5
const LOCATION_LINE_HEIGHT = 21; // sm:  14 × 1.5 — row height
const LOCATION_TEXT_GLYPH_HEIGHT = 14; // sm fontSize — visible text glyph
const DAY_LETTER_LINE_HEIGHT = 18; // xs:  12 × 1.5
// Bumped above the real sm-badge height (20) so the skeleton pill reads
// fuller — matches the visual weight of the loaded badge content.
const BADGE_HEIGHT_SM = 26;
// Widths that match the badge components' own internal loading skeletons.
const RATING_BADGE_WIDTH = 60;
const REPUTATION_BADGE_WIDTH = 80;

const PlayerCardSkeleton: React.FC = () => {
  const { isDark } = useThemeStyles();

  // Same surface treatment as the real card.
  const cardBackground = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  // Tinted skeleton shades sit one step away from the card surface so they
  // read as "loading content" without clashing against the teal background.
  // Light mode pairs primary[100] base with a primary[50] highlight so the
  // shimmer pulses softly toward the card surface instead of brightening.
  const skeletonBg = isDark ? primary[900] : primary[100];
  const skeletonHighlight = isDark ? primary[800] : primary[50];

  return (
    <View style={[styles.card, { backgroundColor: cardBackground, borderColor }]}>
      <View style={styles.content}>
        <View style={styles.avatarSection}>
          {/* 2px transparent padding mirrors avatarRing's border, so the
             avatar column occupies the same 64×64 footprint as the real card. */}
          <View style={styles.avatarRingWrapper}>
            <Skeleton
              width={AVATAR_SIZE}
              height={AVATAR_SIZE}
              circle
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
        </View>
        <View style={styles.infoContainer}>
          {/* Row 1: name + favorite placeholder (matches real card's 28px row height) */}
          <View style={styles.nameRow}>
            <Skeleton
              width="55%"
              height={NAME_LINE_HEIGHT}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <View style={styles.favoritePlaceholder}>
              <Skeleton
                width={20}
                height={20}
                circle
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
          </View>
          {/* Row 2: pin icon · distance · separator · activity — discrete
             skeletons that mirror the real elements, with row height pinned
             to 21 (sm Text lineHeight) so the row never shrinks. */}
          <View style={styles.locationRow}>
            <Skeleton
              width={13}
              height={13}
              circle
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={42}
              height={LOCATION_TEXT_GLYPH_HEIGHT}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={3}
              height={3}
              circle
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={62}
              height={LOCATION_TEXT_GLYPH_HEIGHT}
              borderRadius={4}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
          {/* Row 3: rating badge + reputation badge (widths match each
             component's own internal loading width) */}
          <View style={styles.badgesRow}>
            <Skeleton
              width={RATING_BADGE_WIDTH}
              height={BADGE_HEIGHT_SM}
              borderRadius={radiusPixels.full}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <Skeleton
              width={REPUTATION_BADGE_WIDTH}
              height={BADGE_HEIGHT_SM}
              borderRadius={radiusPixels.full}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          </View>
        </View>
      </View>

      {/* Availability grid skeleton — matches AvailabilityGrid layout */}
      <View style={styles.availabilitySection}>
        {Array.from({ length: DAY_CELL_COUNT }).map((_, i) => (
          <View key={i} style={styles.dayCell}>
            <Skeleton
              width={10}
              height={DAY_LETTER_LINE_HEIGHT}
              borderRadius={2}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
            <View style={styles.dotsRow}>
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton
                  key={j}
                  width={4}
                  height={4}
                  borderRadius={2}
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.xl,
    marginHorizontal: CARD_HORIZONTAL_MARGIN,
    marginBottom: spacingPixels[3],
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: CARD_PADDING,
    gap: spacingPixels[3],
  },
  avatarSection: {
    flexShrink: 0,
  },
  avatarRingWrapper: {
    padding: AVATAR_RING_BORDER,
  },
  infoContainer: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[0.5],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  favoritePlaceholder: {
    padding: spacingPixels[1],
    marginLeft: 'auto',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    height: LOCATION_LINE_HEIGHT,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[1],
  },
  availabilitySection: {
    paddingHorizontal: CARD_PADDING,
    paddingBottom: CARD_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[1],
  },
  dayCell: {
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 2,
  },
});

export default PlayerCardSkeleton;
