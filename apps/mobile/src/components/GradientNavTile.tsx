import React, { useEffect, useMemo } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

export const NAV_TILE_WATERMARK_COLOR = 'rgba(255,255,255,0.12)';

/**
 * Gradient dispatch tile shared by the Home play grid and the Community hub —
 * same visual language as the home ClassementsTile (gradient surface, frosted
 * icon chip, low-opacity watermark, chevron).
 */
export const GradientNavTile: React.FC<{
  icon: (color: string) => React.ReactNode;
  watermark: React.ReactNode;
  gradient: [string, string];
  borderColor: string;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}> = ({ icon, watermark, gradient, borderColor, label, onPress, style }) => {
  const handlePress = () => {
    void lightHaptic();
    onPress();
  };
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.item, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.inner, { borderColor }]}
      >
        <View style={styles.watermark}>{watermark}</View>
        <View style={styles.topRow}>
          <View style={styles.iconCircle}>{icon('#ffffff')}</View>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
        </View>
        <Text size="sm" weight="semibold" color="#ffffff" numberOfLines={2} style={styles.label}>
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

/**
 * Live indicator: a steady dot with a ring breathing out of it. Stands in for
 * the stat overline's icon when the number is realtime rather than historical.
 */
const LivePulseDot: React.FC = () => {
  const pulse = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View
        style={[
          styles.pulseRing,
          {
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) },
            ],
            opacity: pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 0.15, 0] }),
          },
        ]}
      />
      <View style={styles.pulseCore} />
    </View>
  );
};

/** Live standing shown on the right half of a GradientStatTile. */
export interface NavTileStat {
  /** Small lead-in before the value on the headline row (e.g. "You're"). */
  prefix?: string;
  /** The headline number (e.g. "#4" or "12"). */
  value: string;
  /** Unit rendered beside the value on the headline row (e.g. "courts"). */
  unit?: string;
  /** Small line under the value (e.g. "12 games", "open near you"). */
  detail?: string;
}

/**
 * Full-width sibling of GradientNavTile: dispatch identity (icon + label) on
 * the left, a live stat showcase on the right. The right column always renders
 * the same skeleton — overline title, then value + detail (or a small nudge
 * when there's no standing yet) — so the three home tiles stay symmetric in
 * every state. While the stat loads the value block is blank; its reserved
 * min-height keeps the tile from resizing when the number lands.
 */
export const GradientStatTile: React.FC<{
  icon: (color: string) => React.ReactNode;
  watermark: React.ReactNode;
  gradient: [string, string];
  borderColor: string;
  label: string;
  /** Overline naming the showcased metric (e.g. "Monthly challenge"). */
  statTitle: string;
  /** Small glyph rendered beside the overline, giving the metric a face. */
  statIcon?: keyof typeof Ionicons.glyphMap;
  /** Replaces `statIcon` with a live pulse — for realtime numbers. */
  statLive?: boolean;
  stat: NavTileStat | null;
  /** Shown in the stat slot when there's no standing/data yet. */
  statFallback: string;
  /** Suppresses the fallback while the stat is still loading. */
  statLoading?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}> = ({
  icon,
  watermark,
  gradient,
  borderColor,
  label,
  statTitle,
  statIcon,
  statLive = false,
  stat,
  statFallback,
  statLoading = false,
  onPress,
  style,
}) => {
  const handlePress = () => {
    void lightHaptic();
    onPress();
  };
  const statText = stat
    ? [statTitle, [stat.prefix, stat.value, stat.unit].filter(Boolean).join(' '), stat.detail]
        .filter(Boolean)
        .join(' · ')
    : statLoading
      ? statTitle
      : `${statTitle}. ${statFallback}`;
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.item, style]}
      accessibilityRole="button"
      accessibilityLabel={`${label.replace('\n', ' ')}. ${statText}`}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.inner, styles.statInner, { borderColor }]}
      >
        <View style={styles.watermark}>{watermark}</View>
        <View style={styles.statLeftCol}>
          <View style={styles.iconCircle}>{icon('#ffffff')}</View>
          <Text size="sm" weight="semibold" color="#ffffff" numberOfLines={2} style={styles.label}>
            {label}
          </Text>
        </View>
        <View style={styles.statSlot}>
          <View style={styles.statTitleRow}>
            {statLive ? (
              <LivePulseDot />
            ) : statIcon ? (
              <Ionicons name={statIcon} size={13} color="rgba(255,255,255,0.9)" />
            ) : null}
            <Text
              size="xs"
              weight="semibold"
              color="rgba(255,255,255,0.9)"
              numberOfLines={1}
              style={styles.statTitle}
            >
              {statTitle}
            </Text>
          </View>
          <View style={styles.statValueBlock}>
            {stat ? (
              <>
                <View style={styles.statValueRow}>
                  {stat.prefix ? (
                    <Text size="base" weight="semibold" color="#ffffff" numberOfLines={1}>
                      {stat.prefix}
                    </Text>
                  ) : null}
                  <Text
                    size="2xl"
                    weight="bold"
                    color="#ffffff"
                    numberOfLines={1}
                    style={styles.statValue}
                  >
                    {stat.value}
                  </Text>
                  {stat.unit ? (
                    <Text size="base" weight="semibold" color="#ffffff" numberOfLines={1}>
                      {stat.unit}
                    </Text>
                  ) : null}
                </View>
                {stat.detail ? (
                  <Text
                    size="xs"
                    color="rgba(255,255,255,0.9)"
                    numberOfLines={2}
                    style={styles.statDetail}
                  >
                    {stat.detail}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text
                size="sm"
                weight="medium"
                color="rgba(255,255,255,0.95)"
                numberOfLines={3}
                style={styles.statNudge}
              >
                {/* Space, not empty, while loading — reserves the line. */}
                {statLoading ? ' ' : statFallback}
              </Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  item: {
    borderRadius: radiusPixels.xl,
  },
  inner: {
    flex: 1,
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    gap: spacingPixels[3],
    // If a same-row sibling's label wraps, row-stretch grows this tile too —
    // space-between keeps the label pinned to the bottom instead of floating.
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  // Stat variant lays out horizontally: identity left, stat right, chevron end.
  statInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[4],
  },
  statLeftCol: {
    flex: 1,
    // The label never truncates: past this floor the stat side wraps instead.
    minWidth: '34%',
    gap: spacingPixels[3],
  },
  statSlot: {
    flexShrink: 1,
    maxWidth: '60%',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  statTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  statTitle: {
    lineHeight: 14,
  },
  // Live pulse: 13px box so it swaps in for the overline's Ionicons glyph
  // without shifting the row.
  pulseWrap: {
    width: 13,
    height: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#ffffff',
  },
  pulseCore: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#ffffff',
  },
  // Reserved height fits the value row + its detail line, so every tile —
  // stat, nudge, or loading — renders at exactly the same height.
  statValueBlock: {
    minHeight: 42,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statDetail: {
    textAlign: 'right',
    lineHeight: 16,
  },
  // Unit sits on the headline row, baseline-ish against the big number.
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacingPixels[1],
  },
  // Tight leading: the default 1.5x line box is what opens a visible gap
  // between the overline and the number.
  statValue: {
    lineHeight: 26,
  },
  statNudge: {
    textAlign: 'right',
    lineHeight: 18,
  },
  watermark: {
    position: 'absolute',
    right: -spacingPixels[2],
    bottom: -spacingPixels[3],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  label: {
    lineHeight: 18,
  },
});
