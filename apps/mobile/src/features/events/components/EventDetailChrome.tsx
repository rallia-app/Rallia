/**
 * The chrome an event detail screen wears, whatever its format: the sticky
 * underline tab bar, and the initial-load skeleton that stands in for hero,
 * tabs and the first pane.
 *
 * Both detail screens drew these identically — the skeletons differed only by
 * banner aspect and a component name — so a format now supplies its tab
 * manifest and its banner shape, and gets the rest.
 */

import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Skeleton, SkeletonTextLine } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '../../../hooks';

/** One tab in a detail screen's manifest. */
export interface EventDetailTab<K extends string> {
  key: K;
  label: string;
}

interface EventDetailTabBarProps<K extends string> {
  tabs: EventDetailTab<K>[];
  currentKey: K;
  onSelect: (key: K) => void;
  colors: { background: string; border: string; primary: string; textMuted: string };
  /** Prefix for each tab's testID, e.g. `tournament` → `tournament-tab-players`. */
  testIDPrefix: string;
}

/**
 * Sticky scrollable underline tabs: each sized to its label and left-aligned,
 * so any number of tabs scrolls cleanly.
 */
export function EventDetailTabBar<K extends string>({
  tabs,
  currentKey,
  onSelect,
  colors,
  testIDPrefix,
}: EventDetailTabBarProps<K>) {
  return (
    <View
      style={[
        styles.tabBarSticky,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarContent}
      >
        {tabs.map(tab => {
          const selected = tab.key === currentKey;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onSelect(tab.key)}
              activeOpacity={0.7}
              style={styles.tabItem}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              testID={`${testIDPrefix}-tab-${tab.key}`}
            >
              <Text
                size="sm"
                weight={selected ? 'semibold' : 'medium'}
                color={selected ? colors.primary : colors.textMuted}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
              <View
                style={[
                  styles.tabUnderline,
                  { backgroundColor: selected ? colors.primary : 'transparent' },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Initial-load stand-in: hero banner, tab bar, stats, stepper and info rows. */
export const EventDetailSkeleton: React.FC<{ bannerAspect: number }> = ({ bannerAspect }) => {
  const { width } = useWindowDimensions();
  const { colors: themed } = useThemeStyles();
  const shimmer = {
    backgroundColor: themed.skeletonBackground,
    highlightColor: themed.skeletonHighlight,
  };
  // The scrim lines sit on the banner artwork, so they shimmer in the same
  // translucent white the real scrim text uses.
  const onBanner = {
    backgroundColor: 'rgba(255,255,255,0.40)',
    highlightColor: 'rgba(255,255,255,0.60)',
  };
  return (
    <View>
      <View style={styles.heroFixed}>
        <View style={styles.heroBanner}>
          <Skeleton {...shimmer} height={Math.round(width / bannerAspect)} borderRadius={0} />
          {/* Status pill floats near-white on the image in both themes */}
          <View style={styles.heroBannerTopRow}>
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(255,255,255,0.94)' }]}>
              <SkeletonTextLine
                size="xs"
                width={72}
                backgroundColor="rgba(0,0,0,0.10)"
                highlightColor="rgba(0,0,0,0.18)"
              />
            </View>
          </View>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.68)']}
            locations={[0, 0.42, 1]}
            style={styles.heroScrim}
          >
            <SkeletonTextLine {...onBanner} size="2xl" lineHeight="tight" width="62%" />
            <SkeletonTextLine {...onBanner} size="sm" width="46%" />
          </LinearGradient>
        </View>
      </View>

      <View
        style={[
          styles.tabBarSticky,
          { backgroundColor: themed.background, borderBottomColor: themed.border },
        ]}
      >
        <View style={styles.tabBarContent}>
          {[64, 52, 58, 46].map((w, i) => (
            <View key={i} style={styles.tabItem}>
              <SkeletonTextLine {...shimmer} size="sm" width={w} />
              <View style={styles.tabUnderline} />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tabContent}>
        {/* Stats: three value/label segments split by hairlines */}
        <View
          style={[
            styles.section,
            styles.statsCard,
            { backgroundColor: themed.cardBackground, borderColor: themed.border },
          ]}
        >
          {[0, 1, 2].map(i => (
            <React.Fragment key={i}>
              {i > 0 && <View style={[styles.statDivider, { backgroundColor: themed.border }]} />}
              <View style={styles.statSegment}>
                <SkeletonTextLine {...shimmer} size="lg" width={44} />
                <SkeletonTextLine {...shimmer} size="xs" width={56} />
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Lifecycle stepper: four dots joined by connectors */}
        <View
          style={[
            styles.section,
            styles.stepperCard,
            { backgroundColor: themed.cardBackground, borderColor: themed.border },
          ]}
        >
          <View style={styles.stepperRow}>
            {[0, 1, 2, 3].map(i => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <View style={[styles.stepperConnector, { backgroundColor: themed.border }]} />
                )}
                <View style={styles.stepperStep}>
                  <Skeleton {...shimmer} width={32} height={32} circle />
                  <SkeletonTextLine {...shimmer} size="xs" width={44} />
                </View>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* Event info: icon-disc rows behind a section title */}
        <View style={styles.section}>
          <SkeletonTextLine {...shimmer} size="xs" width={88} style={styles.sectionTitle} />
          <View
            style={[
              styles.card,
              { backgroundColor: themed.cardBackground, borderColor: themed.border },
            ]}
          >
            {['58%', '72%', '44%', '64%'].map((w, i) => (
              <View
                key={w}
                style={[
                  styles.overviewInfoRow,
                  i > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: themed.border,
                  },
                ]}
              >
                <Skeleton {...shimmer} width={30} height={30} circle />
                <View style={styles.overviewInfoTexts}>
                  <SkeletonTextLine {...shimmer} size="sm" width={w} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  heroFixed: {
    paddingBottom: spacingPixels[2],
  },
  heroBanner: {
    position: 'relative',
  },
  heroBannerTopRow: {
    position: 'absolute',
    top: spacingPixels[3],
    left: spacingPixels[4],
    right: spacingPixels[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[1],
  },
  statusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  tabBarSticky: {
    paddingTop: spacingPixels[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  tabItem: {
    alignItems: 'center',
    paddingTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  tabUnderline: {
    alignSelf: 'stretch',
    height: 2,
    borderRadius: 1,
  },
  tabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  section: {
    marginBottom: spacingPixels[5],
  },
  sectionTitle: {
    marginBottom: spacingPixels[2],
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingVertical: spacingPixels[3.5],
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: spacingPixels[0.5],
  },
  statSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacingPixels[2],
  },
  stepperCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepperConnector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginTop: 15,
    marginHorizontal: -spacingPixels[3],
  },
  stepperStep: {
    alignItems: 'center',
    gap: spacingPixels[1],
    width: 72,
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  overviewInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[3.5],
    paddingVertical: spacingPixels[3],
  },
  overviewInfoTexts: {
    flex: 1,
    gap: 2,
  },
});
