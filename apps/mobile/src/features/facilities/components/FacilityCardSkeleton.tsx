import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';
import { useThemeStyles } from '../../../hooks';

// Dimensions kept in sync with FacilityCard.tsx — change them together.
const CARD_HORIZONTAL_MARGIN = spacingPixels[4];
const CARD_PADDING = spacingPixels[4];
// Text-box heights (fontSize × normal lineHeight 1.5).
const NAME_LINE_HEIGHT = 24; // base 16 × 1.5
const ROW_LINE_HEIGHT = 21; // sm 14 × 1.5
const BADGE_TEXT_LINE_HEIGHT = 18; // xs 12 × 1.5
const TEXT_GLYPH_SM = 14;
// Slot-chip dimensions match the real chip's box: paddingH 8 + paddingV 4 +
// xs text (lineHeight 18) + 1px border on each side.
const SLOT_TIME_GLYPH = 12; // visible xs glyph
const SLOT_COURT_BADGE = 14; // matches courtCountBadge (16×16 minus a hair for inner)
// Date label override: real card sets fontSize 10 on top of size="xs".
const DATE_LABEL_GLYPH = 12;

// Static skeleton schedule — variety of chip counts + court-badge presence so
// the loading state looks like a real availability snapshot.
const SLOT_SCHEDULE: Array<{
  labelWidth: number;
  chips: Array<{ timeWidth: number; hasCourtBadge: boolean }>;
}> = [
  {
    labelWidth: 38,
    chips: [
      { timeWidth: 36, hasCourtBadge: true },
      { timeWidth: 32, hasCourtBadge: false },
      { timeWidth: 36, hasCourtBadge: true },
    ],
  },
  {
    labelWidth: 30,
    chips: [
      { timeWidth: 36, hasCourtBadge: true },
      { timeWidth: 36, hasCourtBadge: true },
    ],
  },
  {
    labelWidth: 32,
    chips: [
      { timeWidth: 32, hasCourtBadge: false },
      { timeWidth: 36, hasCourtBadge: true },
    ],
  },
];

const FacilityCardSkeleton: React.FC = () => {
  const { isDark } = useThemeStyles();

  const cardBackground = isDark ? primary[950] : primary[50];
  const borderColor = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  // Faint tinted fill on each slot chip — mirrors the inactive-chip background
  // used by FacilityCard when a slot is not tappable.
  const chipFill = isDark ? `${primary[400]}10` : `${primary[500]}08`;
  // Slightly stronger tint for the badge pills (real badges use ~15% alpha).
  const badgeFill = isDark ? `${primary[400]}1A` : `${primary[500]}14`;
  // Same tinted shades as PlayerCardSkeleton — bg one step away from the
  // card surface, highlight matching the surface so the shimmer fades soft.
  const skeletonBg = isDark ? primary[900] : primary[100];
  const skeletonHighlight = isDark ? primary[800] : primary[50];

  return (
    <View style={[styles.card, { backgroundColor: cardBackground, borderColor }]}>
      <View style={styles.content}>
        {/* Row 1: name + favorite */}
        <View style={styles.headerRow}>
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

        {/* Row 2: address (pin + text) */}
        <View style={styles.addressRow}>
          <Skeleton
            width={14}
            height={14}
            circle
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
          <Skeleton
            width="75%"
            height={TEXT_GLYPH_SM}
            borderRadius={4}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
        </View>

        {/* Row 3: distance · court count */}
        <View style={styles.distanceRow}>
          <Skeleton
            width={14}
            height={14}
            circle
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
          <Skeleton
            width={48}
            height={TEXT_GLYPH_SM}
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
            width={13}
            height={13}
            circle
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
          <Skeleton
            width={62}
            height={TEXT_GLYPH_SM}
            borderRadius={4}
            backgroundColor={skeletonBg}
            highlightColor={skeletonHighlight}
          />
        </View>

        {/* Row 4: badges — structured pill (icon + text bar) so the badge
           lands at the real 24px height: paddingV 3 + xs lineHeight 18 + 3. */}
        <View style={styles.badgesRow}>
          {[30, 48, 70].map(textWidth => (
            <View key={textWidth} style={[styles.badgeSkeleton, { backgroundColor: badgeFill }]}>
              <Skeleton
                width={12}
                height={12}
                circle
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <Skeleton
                width={textWidth}
                height={BADGE_TEXT_LINE_HEIGHT}
                borderRadius={3}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
            </View>
          ))}
        </View>

        {/* Slot scroller skeleton — mirrors the real chip structure: a
           rounded pill with a thin border holding a time-text skeleton and
           an optional court-count circle. Uses negative horizontal margins
           so chips can reach the card edges like the real ScrollView. */}
        <View style={styles.slotsScroller}>
          {SLOT_SCHEDULE.map((group, groupIdx) => (
            <View key={groupIdx} style={styles.dateGroup}>
              <Skeleton
                width={group.labelWidth}
                height={DATE_LABEL_GLYPH}
                borderRadius={3}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
              />
              <View style={styles.dateSlotsRow}>
                {group.chips.map((chip, chipIdx) => (
                  <View
                    key={chipIdx}
                    style={[styles.slotChip, { borderColor, backgroundColor: chipFill }]}
                  >
                    <Skeleton
                      width={chip.timeWidth}
                      height={SLOT_TIME_GLYPH}
                      borderRadius={3}
                      backgroundColor={skeletonBg}
                      highlightColor={skeletonHighlight}
                    />
                    {chip.hasCourtBadge && (
                      <Skeleton
                        width={SLOT_COURT_BADGE}
                        height={SLOT_COURT_BADGE}
                        circle
                        backgroundColor={skeletonBg}
                        highlightColor={skeletonHighlight}
                      />
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
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
    padding: CARD_PADDING,
    gap: spacingPixels[1.5],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  favoritePlaceholder: {
    padding: spacingPixels[1],
    marginLeft: 'auto',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    height: ROW_LINE_HEIGHT,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    height: ROW_LINE_HEIGHT,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[1],
    marginTop: spacingPixels[1],
  },
  // Same horizontal padding + gap as the real badge, but bumped paddingV so
  // the pill container itself reads taller in the skeleton. Container math:
  // paddingV 6 + xs lineHeight 18 + paddingV 6 = 30.
  badgeSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 6,
    borderRadius: radiusPixels.full,
  },
  slotsScroller: {
    flexDirection: 'row',
    gap: spacingPixels[4],
    marginTop: spacingPixels[2],
    // Mirror the real ScrollView: negative horizontal margins extend to the
    // card edges; the card's overflow:hidden clips anything that escapes.
    marginHorizontal: -CARD_PADDING,
    paddingLeft: CARD_PADDING,
    paddingRight: spacingPixels[2],
    overflow: 'hidden',
  },
  dateGroup: {
    gap: spacingPixels[1],
  },
  dateSlotsRow: {
    flexDirection: 'row',
    gap: spacingPixels[1.5],
  },
  // Same horizontal padding + border as the real slot chip, but paddingV
  // bumped so the chip container itself reads taller in the skeleton.
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 7,
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
});

export default FacilityCardSkeleton;
