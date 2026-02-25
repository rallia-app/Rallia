/**
 * PieChart Component
 *
 * A pie/donut chart for showing proportional data.
 * Supports interactive segments, legends, and center labels.
 *
 * @example
 * ```tsx
 * <PieChart
 *   data={[
 *     { label: 'Tennis', value: 60, color: '#3B82F6' },
 *     { label: 'Pickleball', value: 40, color: '#10B981' },
 *   ]}
 *   title="Sport Distribution"
 *   donut
 * />
 * ```
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import { PieChart as GiftedPieChart } from 'react-native-gifted-charts';
import { useTheme } from '@rallia/shared-hooks';
import { primary, neutral, status, spacingPixels, radiusPixels } from '@rallia/design-system';

export interface PieChartDataPoint {
  /** Segment label */
  label: string;
  /** Segment value */
  value: number;
  /** Segment color */
  color?: string;
  /** Whether segment is focused/selected */
  focused?: boolean;
  /** Gradient color for segment */
  gradientCenterColor?: string;
}

export interface PieChartProps {
  /** Data points to display */
  data: PieChartDataPoint[];

  /** Chart title */
  title?: string;

  /** Chart subtitle */
  subtitle?: string;

  /** Pie radius */
  radius?: number;

  /** Inner radius (for donut chart) */
  innerRadius?: number;

  /** Whether to display as donut chart */
  donut?: boolean;

  /** Center label text (for donut) */
  centerLabel?: string;

  /** Center value text (for donut) */
  centerValue?: string;

  /** Whether to show percentage labels */
  showPercentages?: boolean;

  /** Whether to show value labels */
  showValues?: boolean;

  /** Whether to show the legend */
  showLegend?: boolean;

  /** Legend position */
  legendPosition?: 'bottom' | 'right';

  /** Whether to use gradient colors */
  showGradient?: boolean;

  /** Container style */
  style?: ViewStyle;

  /** Whether to animate on render */
  animated?: boolean;

  /** Focus on specific segment (controlled mode) */
  focusedIndex?: number;

  /** Callback when segment is pressed */
  onSegmentPress?: (item: PieChartDataPoint, index: number) => void;
}

// Default color palette
const DEFAULT_COLORS = [
  primary[500],
  status.success.DEFAULT,
  status.warning.DEFAULT,
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16', // lime
  '#6366F1', // indigo
  '#14B8A6', // teal
];

export const PieChart: React.FC<PieChartProps> = ({
  data,
  title,
  subtitle,
  radius = 100,
  innerRadius,
  donut = false,
  centerLabel,
  centerValue,
  showPercentages = false,
  showValues = false,
  showLegend = true,
  legendPosition = 'bottom',
  showGradient = true,
  style,
  animated = true,
  focusedIndex,
  onSegmentPress,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [selectedIndex, setSelectedIndex] = useState<number | null>(focusedIndex ?? null);

  const colors = useMemo(
    () => ({
      background: isDark ? neutral[900] : '#ffffff',
      text: isDark ? neutral[100] : neutral[900],
      textSecondary: isDark ? neutral[400] : neutral[500],
      centerBg: isDark ? neutral[800] : neutral[50],
    }),
    [isDark]
  );

  // Calculate total for percentages
  const total = useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);

  // Transform data for gifted-charts
  const chartData = useMemo(() => {
    return data.map((item, index) => {
      const segmentColor = item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
      const isFocused = selectedIndex === index || focusedIndex === index;

      return {
        value: item.value,
        color: segmentColor,
        gradientCenterColor: showGradient
          ? item.gradientCenterColor || lightenColor(segmentColor, 0.3)
          : undefined,
        focused: isFocused,
        onPress: () => {
          setSelectedIndex(isFocused ? null : index);
          onSegmentPress?.(item, index);
        },
        text: showPercentages
          ? `${((item.value / total) * 100).toFixed(0)}%`
          : showValues
            ? formatValue(item.value)
            : undefined,
        textColor: '#ffffff',
        textSize: 11,
        textBackgroundColor: 'transparent',
      };
    });
  }, [
    data,
    selectedIndex,
    focusedIndex,
    showGradient,
    showPercentages,
    showValues,
    total,
    onSegmentPress,
  ]);

  // Donut inner radius
  const effectiveInnerRadius = donut ? (innerRadius ?? radius * 0.55) : 0;

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

      {/* Chart and Legend */}
      <View style={[styles.chartArea, legendPosition === 'right' && styles.chartAreaRow]}>
        {/* Pie Chart */}
        <View style={styles.pieContainer}>
          <GiftedPieChart
            data={chartData}
            radius={radius}
            innerRadius={effectiveInnerRadius}
            showText={showPercentages || showValues}
            textColor="#ffffff"
            textSize={11}
            focusOnPress
            showGradient={showGradient}
            isAnimated={animated}
            animationDuration={800}
            sectionAutoFocus
            centerLabelComponent={
              donut && (centerLabel || centerValue)
                ? () => (
                    <View style={[styles.centerLabel, { backgroundColor: colors.centerBg }]}>
                      {centerValue && (
                        <Text style={[styles.centerValue, { color: colors.text }]}>
                          {centerValue}
                        </Text>
                      )}
                      {centerLabel && (
                        <Text style={[styles.centerLabelText, { color: colors.textSecondary }]}>
                          {centerLabel}
                        </Text>
                      )}
                    </View>
                  )
                : undefined
            }
          />
        </View>

        {/* Legend */}
        {showLegend && (
          <View style={[styles.legend, legendPosition === 'right' && styles.legendRight]}>
            {data.map((item, index) => {
              const segmentColor = item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
              const percentage = ((item.value / total) * 100).toFixed(1);
              const isSelected = selectedIndex === index;

              return (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.legendItem, isSelected && styles.legendItemSelected]}
                  onPress={() => {
                    setSelectedIndex(isSelected ? null : index);
                    onSegmentPress?.(item, index);
                  }}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.legendColor,
                      {
                        backgroundColor: segmentColor,
                        borderWidth: 1,
                        borderColor: segmentColor,
                      },
                    ]}
                  />
                  <View style={styles.legendTextContainer}>
                    <Text
                      style={[
                        styles.legendLabel,
                        { color: colors.text },
                        isSelected && styles.legendLabelSelected,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.label || `Item ${index + 1}`}
                    </Text>
                    <Text
                      style={[styles.legendValue, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {formatValue(item.value)} ({percentage}%)
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
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
  return value.toString();
}

// Lighten a hex color
function lightenColor(hex: string, amount: number): string {
  const cleanHex = hex.replace('#', '');
  const num = parseInt(cleanHex, 16);
  const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * amount));
  const g = Math.min(
    255,
    Math.floor(((num >> 8) & 0x00ff) + (255 - ((num >> 8) & 0x00ff)) * amount)
  );
  const b = Math.min(255, Math.floor((num & 0x0000ff) + (255 - (num & 0x0000ff)) * amount));
  return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
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
  chartArea: {
    alignItems: 'center',
    width: '100%',
  },
  chartAreaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    width: '100%',
  },
  pieContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  centerValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  centerLabelText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  legend: {
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
    alignSelf: 'stretch',
    width: '100%',
  },
  legendRight: {
    marginTop: 0,
    marginLeft: spacingPixels[6],
    justifyContent: 'center',
    alignSelf: 'auto',
    width: 'auto',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.sm,
    marginBottom: spacingPixels[1],
  },
  legendItemSelected: {
    backgroundColor: `${primary[500]}15`,
  },
  legendColor: {
    width: 14,
    height: 14,
    minWidth: 14,
    minHeight: 14,
    borderRadius: 3,
    marginRight: spacingPixels[3],
    flexShrink: 0,
  },
  legendTextContainer: {
    flex: 1,
    flexShrink: 1,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '500',
    flexWrap: 'wrap',
  },
  legendLabelSelected: {
    fontWeight: '600',
  },
  legendValue: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 1,
  },
});

export default PieChart;
