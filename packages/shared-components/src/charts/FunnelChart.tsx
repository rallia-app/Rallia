/**
 * FunnelChart Component
 *
 * A funnel chart for visualizing conversion flows and dropoffs.
 * Critical for Onboarding Analytics to show user progression.
 *
 * @example
 * ```tsx
 * <FunnelChart
 *   data={[
 *     { label: 'Sign Up', value: 1000 },
 *     { label: 'Email Verified', value: 800 },
 *     { label: 'Profile Created', value: 600 },
 *     { label: 'First Match', value: 300 },
 *   ]}
 *   title="Onboarding Funnel"
 *   showConversion
 * />
 * ```
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@rallia/shared-hooks';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { primary, neutral, status, spacingPixels, radiusPixels } from '@rallia/design-system';

export interface FunnelChartDataPoint {
  /** Stage label */
  label: string;
  /** Stage value */
  value: number;
  /** Custom color for this stage */
  color?: string;
  /** Secondary label (e.g., time period) */
  sublabel?: string;
}

export interface FunnelChartProps {
  /** Data points to display (ordered from top to bottom) */
  data: FunnelChartDataPoint[];

  /** Chart title */
  title?: string;

  /** Chart subtitle */
  subtitle?: string;

  /** Whether to show conversion rates between stages */
  showConversion?: boolean;

  /** Whether to show percentage of initial value */
  showPercentOfTotal?: boolean;

  /** Maximum bar width */
  maxBarWidth?: number;

  /** Minimum bar width (as ratio of max) */
  minWidthRatio?: number;

  /** Whether bars scale proportionally to values */
  proportionalBars?: boolean;

  /** Bar height */
  barHeight?: number;

  /** Gap between bars */
  barGap?: number;

  /** Container style */
  style?: ViewStyle;

  /** Whether to animate on render */
  animated?: boolean;

  /** Callback when a bar is pressed */
  onBarPress?: (item: FunnelChartDataPoint, index: number) => void;
}

// Color gradient from primary to status colors
const DEFAULT_GRADIENT = [primary[500], primary[400], status.warning.DEFAULT, status.error.DEFAULT];

export const FunnelChart: React.FC<FunnelChartProps> = ({
  data,
  title,
  subtitle,
  showConversion = true,
  showPercentOfTotal = true,
  maxBarWidth = 300,
  minWidthRatio = 0.3,
  proportionalBars = true,
  barHeight = 48,
  barGap: _barGap = 8,
  style,
  animated = true,
  onBarPress: _onBarPress,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = useMemo(
    () => ({
      background: isDark ? neutral[900] : '#ffffff',
      text: isDark ? neutral[100] : neutral[900],
      textSecondary: isDark ? neutral[400] : neutral[500],
      conversionBg: isDark ? neutral[800] : neutral[100],
      conversionGood: status.success.DEFAULT,
      conversionMid: status.warning.DEFAULT,
      conversionBad: status.error.DEFAULT,
    }),
    [isDark]
  );

  // Calculate metrics
  const metrics = useMemo(() => {
    const maxValue = data[0]?.value || 1;
    const minWidth = maxBarWidth * minWidthRatio;

    return data.map((item, index) => {
      const prevValue = index > 0 ? data[index - 1].value : item.value;
      const conversionRate = prevValue > 0 ? (item.value / prevValue) * 100 : 100;
      const percentOfTotal = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

      // Calculate bar width
      let width: number;
      if (proportionalBars) {
        const ratio = item.value / maxValue;
        width = minWidth + (maxBarWidth - minWidth) * ratio;
      } else {
        // Linear decrease
        const ratio = 1 - index / Math.max(data.length - 1, 1);
        width = minWidth + (maxBarWidth - minWidth) * ratio;
      }

      // Determine bar color
      const color = item.color || getGradientColor(index, data.length);

      return {
        ...item,
        width,
        color,
        conversionRate,
        percentOfTotal,
        isFirst: index === 0,
      };
    });
  }, [data, maxBarWidth, minWidthRatio, proportionalBars]);

  // Get conversion label color
  const getConversionColor = (rate: number): string => {
    if (rate >= 80) return colors.conversionGood;
    if (rate >= 50) return colors.conversionMid;
    return colors.conversionBad;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }, style]}>
      {/* Header */}
      {(title || subtitle) && (
        <View style={styles.header}>
          {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
          {subtitle && (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
          )}
        </View>
      )}

      {/* Funnel Bars */}
      <View style={styles.funnelContainer}>
        {metrics.map((item, index) => (
          <View key={item.label} style={styles.stageContainer}>
            {/* Conversion connector */}
            {showConversion && !item.isFirst && (
              <Animated.View
                entering={animated ? FadeInRight.delay(index * 120) : undefined}
                style={[styles.conversionConnector, { backgroundColor: colors.conversionBg }]}
              >
                <Text
                  style={[
                    styles.conversionText,
                    { color: getConversionColor(item.conversionRate) },
                  ]}
                >
                  {item.conversionRate.toFixed(0)}%
                </Text>
              </Animated.View>
            )}

            {/* Bar Row */}
            <Animated.View
              entering={animated ? FadeInRight.delay(index * 100) : undefined}
              style={styles.barRow}
            >
              {/* Label */}
              <View style={styles.labelContainer}>
                <Text style={[styles.stageLabel, { color: colors.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.sublabel && (
                  <Text
                    style={[styles.stageSubLabel, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {item.sublabel}
                  </Text>
                )}
              </View>

              {/* Bar */}
              <Animated.View
                style={[
                  styles.bar,
                  {
                    backgroundColor: item.color,
                    width: item.width,
                    height: barHeight,
                  },
                ]}
              >
                <View style={styles.barContent}>
                  <Text style={styles.barValue}>{formatValue(item.value)}</Text>
                  {showPercentOfTotal && !item.isFirst && (
                    <Text style={styles.barPercent}>{item.percentOfTotal.toFixed(0)}%</Text>
                  )}
                </View>
              </Animated.View>
            </Animated.View>

            {/* Dropoff indicator */}
            {showConversion && index < metrics.length - 1 && (
              <View style={styles.dropoffContainer}>
                <View style={[styles.dropoffLine, { backgroundColor: colors.textSecondary }]} />
                <Text style={[styles.dropoffText, { color: colors.textSecondary }]}>
                  -{formatValue(item.value - metrics[index + 1].value)} dropped
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Summary */}
      {data.length > 1 && (
        <View style={[styles.summary, { borderTopColor: isDark ? neutral[700] : neutral[200] }]}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
              Overall Conversion
            </Text>
            <Text
              style={[
                styles.summaryValue,
                { color: getConversionColor(metrics[metrics.length - 1]?.percentOfTotal || 0) },
              ]}
            >
              {(metrics[metrics.length - 1]?.percentOfTotal || 0).toFixed(1)}%
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
              Total Dropoff
            </Text>
            <Text style={[styles.summaryValue, { color: colors.conversionBad }]}>
              {formatValue((data[0]?.value || 0) - (data[data.length - 1]?.value || 0))}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

// Format large numbers
function formatValue(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

// Get gradient color based on position
function getGradientColor(index: number, total: number): string {
  if (total === 1) return DEFAULT_GRADIENT[0];
  const ratio = index / (total - 1);
  const gradientIndex = Math.floor(ratio * (DEFAULT_GRADIENT.length - 1));
  return DEFAULT_GRADIENT[Math.min(gradientIndex, DEFAULT_GRADIENT.length - 1)];
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  header: {
    marginBottom: spacingPixels[4],
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
  funnelContainer: {
    alignItems: 'center',
  },
  stageContainer: {
    width: '100%',
    alignItems: 'center',
  },
  conversionConnector: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.sm,
    marginBottom: 4,
  },
  conversionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  labelContainer: {
    flex: 1,
    minWidth: 80,
  },
  stageLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  stageSubLabel: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 1,
  },
  bar: {
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[3],
  },
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  barPercent: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    fontWeight: '500',
  },
  dropoffContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacingPixels[2],
    gap: spacingPixels[2],
    alignSelf: 'flex-end',
    marginRight: spacingPixels[4],
  },
  dropoffLine: {
    width: 1,
    height: 12,
  },
  dropoffText: {
    fontSize: 10,
    fontWeight: '400',
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacingPixels[4],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '400',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
  },
});

export default FunnelChart;
