/**
 * BarChart Component
 *
 * A flexible bar chart for comparing categorical data.
 * Supports vertical/horizontal orientation, stacked bars, and custom styling.
 *
 * @example
 * ```tsx
 * <BarChart
 *   data={[
 *     { label: 'Tennis', value: 1200 },
 *     { label: 'Pickleball', value: 800 },
 *   ]}
 *   title="Players by Sport"
 * />
 * ```
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle, Dimensions } from 'react-native';
import { BarChart as GiftedBarChart } from 'react-native-gifted-charts';
import { useTheme } from '@rallia/shared-hooks';
import { primary, neutral, spacingPixels, radiusPixels } from '@rallia/design-system';

export interface BarChartDataPoint {
  /** Bar label (x-axis) */
  label: string;
  /** Bar value (y-axis) */
  value: number;
  /** Optional custom color */
  color?: string;
  /** Optional secondary value for stacked bars */
  stackedValue?: number;
  /** Optional gradient colors */
  gradientColor?: string;
}

export interface BarChartProps {
  /** Data points to display */
  data: BarChartDataPoint[];

  /** Chart title */
  title?: string;

  /** Chart subtitle */
  subtitle?: string;

  /** Chart width */
  width?: number;

  /** Chart height */
  height?: number;

  /** Bar width */
  barWidth?: number;

  /** Spacing between bars */
  spacing?: number;

  /** Whether to show values on bars */
  showValues?: boolean;

  /** Whether to show gradient on bars */
  showGradient?: boolean;

  /** Primary bar color */
  barColor?: string;

  /** Gradient end color */
  gradientColor?: string;

  /** Whether to display horizontal bars */
  horizontal?: boolean;

  /** Whether bars are rounded */
  roundedBars?: boolean;

  /** Maximum value (for consistent scaling) */
  maxValue?: number;

  /** Unit suffix for values (e.g., '%', 'k') */
  valueSuffix?: string;

  /** Container style */
  style?: ViewStyle;

  /** Whether to show the x-axis */
  showXAxis?: boolean;

  /** Whether to show the y-axis */
  showYAxis?: boolean;

  /** Whether to show grid lines */
  showGrid?: boolean;

  /** Whether to animate on render */
  animated?: boolean;

  /** Number of y-axis sections */
  noOfSections?: number;

  /** Callback when bar is pressed */
  onBarPress?: (item: BarChartDataPoint, index: number) => void;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  title,
  subtitle,
  width,
  height = 220,
  barWidth = 32,
  spacing = 20,
  showValues = true,
  showGradient = true,
  barColor,
  gradientColor,
  horizontal = false,
  roundedBars = true,
  maxValue,
  valueSuffix = '',
  style,
  showXAxis = true,
  showYAxis = true,
  showGrid = true,
  animated = true,
  noOfSections = 4,
  onBarPress,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = useMemo(
    () => ({
      background: isDark ? neutral[900] : '#ffffff',
      text: isDark ? neutral[100] : neutral[900],
      textSecondary: isDark ? neutral[400] : neutral[500],
      bar: barColor || (isDark ? primary[500] : primary[600]),
      gradient: gradientColor || (isDark ? primary[300] : primary[400]),
      axis: isDark ? neutral[700] : neutral[300],
      grid: isDark ? neutral[800] : neutral[100],
    }),
    [isDark, barColor, gradientColor]
  );

  // Calculate chart width based on screen if not provided
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = width || screenWidth - 80; // Account for padding

  // Transform data for gifted-charts
  const chartData = useMemo(() => {
    // For large datasets, show labels only at intervals to avoid crowding
    const labelInterval = data.length > 20 ? 5 : data.length > 10 ? 2 : 1;

    return data.map((item, index) => ({
      value: item.value,
      // Always include the label text, gifted-charts will handle display
      label: index % labelInterval === 0 ? item.label || '' : '',
      labelTextStyle: {
        color: colors.textSecondary,
        fontSize: data.length > 15 ? 8 : 10,
        width: data.length > 15 ? 30 : 45,
      },
      frontColor: item.color || colors.bar,
      gradientColor: item.gradientColor || colors.gradient,
      topLabelComponent: showValues
        ? () => (
            <Text style={[styles.valueLabel, { color: colors.textSecondary }]}>
              {formatValue(item.value)}
              {valueSuffix}
            </Text>
          )
        : undefined,
      onPress: onBarPress ? () => onBarPress(item, index) : undefined,
    }));
  }, [data, colors, showValues, valueSuffix, onBarPress]);

  // Calculate max value if not provided
  const calculatedMaxValue = useMemo(() => {
    if (maxValue) return maxValue;
    const max = Math.max(...data.map(d => d.value));
    // Round up to nearest nice number
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / magnitude) * magnitude;
  }, [data, maxValue]);

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

      {/* Chart */}
      <View style={styles.chartContainer}>
        <GiftedBarChart
          data={chartData}
          width={chartWidth}
          height={height}
          barWidth={barWidth}
          spacing={spacing}
          roundedTop={roundedBars}
          roundedBottom={false}
          showGradient={showGradient}
          maxValue={calculatedMaxValue}
          noOfSections={noOfSections}
          yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
          xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: data.length > 15 ? 8 : 10 }}
          yAxisColor={showYAxis ? colors.axis : 'transparent'}
          xAxisColor={showXAxis ? colors.axis : 'transparent'}
          rulesColor={showGrid ? colors.grid : 'transparent'}
          rulesType="solid"
          isAnimated={animated}
          animationDuration={500}
          horizontal={horizontal}
          disableScroll={data.length <= 10}
          showScrollIndicator={data.length > 10}
          initialSpacing={15}
          endSpacing={15}
          rotateLabel={data.length > 7}
          labelsExtraHeight={data.length > 7 ? 20 : 10}
          xAxisLabelsHeight={data.length > 7 ? 60 : 35}
          xAxisLabelsVerticalShift={3}
          showXAxisIndices={true}
          xAxisIndicesColor={colors.axis}
          xAxisIndicesHeight={4}
        />
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
  chartContainer: {
    alignItems: 'center',
  },
  valueLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 4,
  },
});

export default BarChart;
