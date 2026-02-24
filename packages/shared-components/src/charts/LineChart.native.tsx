/**
 * LineChart Component
 *
 * A full-featured line chart for time-series and trend data.
 * Supports multiple series, areas, tooltips, and markers.
 *
 * @example
 * ```tsx
 * <LineChart
 *   data={[
 *     { date: '2024-01-01', value: 100 },
 *     { date: '2024-01-02', value: 150 },
 *   ]}
 *   title="User Growth"
 * />
 * ```
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { LineChart as GiftedLineChart } from 'react-native-gifted-charts';
import { useTheme } from '@rallia/shared-hooks';
import {
  primary,
  neutral,
  status,
  spacingPixels,
  radiusPixels,
} from '@rallia/design-system';

export interface LineChartDataPoint {
  /** Date string or timestamp */
  date?: string;
  /** X-axis label (alternative to date) */
  label?: string;
  /** Y-axis value */
  value: number;
  /** Optional label shown at data point */
  dataPointLabel?: string;
}

export interface LineChartSeries {
  /** Series identifier */
  id: string;
  /** Series name for legend */
  name: string;
  /** Data points */
  data: LineChartDataPoint[];
  /** Line color */
  color?: string;
  /** Whether to show area fill */
  showArea?: boolean;
  /** Area fill color */
  areaColor?: string;
}

export interface LineChartProps {
  /** Single data series */
  data?: LineChartDataPoint[];

  /** Multiple data series */
  series?: LineChartSeries[];

  /** Chart title */
  title?: string;

  /** Chart subtitle */
  subtitle?: string;

  /** Chart width */
  width?: number;

  /** Chart height */
  height?: number;

  /** Line color (for single series) */
  lineColor?: string;

  /** Line thickness */
  thickness?: number;

  /** Whether to show area under line */
  showArea?: boolean;

  /** Area fill color */
  areaColor?: string;

  /** Whether to show data point markers */
  showDataPoints?: boolean;

  /** Data point size */
  dataPointSize?: number;

  /** Whether to show values on hover/press */
  showTooltip?: boolean;

  /** Whether to curve the line */
  curved?: boolean;

  /** Maximum value (for consistent scaling) */
  maxValue?: number;

  /** Minimum value */
  minValue?: number;

  /** Unit suffix for values */
  valueSuffix?: string;

  /** Unit prefix for values */
  valuePrefix?: string;

  /** Container style */
  style?: ViewStyle;

  /** Whether to show x-axis labels */
  showXAxisLabels?: boolean;

  /** Whether to show y-axis labels */
  showYAxisLabels?: boolean;

  /** Whether to show grid lines */
  showGrid?: boolean;

  /** Whether to animate on render */
  animated?: boolean;

  /** Number of y-axis sections */
  noOfSections?: number;

  /** Whether to show the legend */
  showLegend?: boolean;

  /** Format function for x-axis labels */
  formatXLabel?: (value: string) => string;

  /** Callback when data point is pressed */
  onDataPointPress?: (item: LineChartDataPoint, index: number) => void;
}

// Default colors for multiple series
const SERIES_COLORS = [
  primary[500],
  status.success.DEFAULT,
  status.warning.DEFAULT,
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
];

export const LineChart: React.FC<LineChartProps> = ({
  data,
  series,
  title,
  subtitle,
  width,
  height = 220,
  lineColor,
  thickness = 2,
  showArea = true,
  areaColor,
  showDataPoints = true,
  dataPointSize = 4,
  showTooltip = true,
  curved = true,
  maxValue,
  minValue: _minValue,
  valueSuffix = '',
  valuePrefix = '',
  style,
  showXAxisLabels = true,
  showYAxisLabels = true,
  showGrid = true,
  animated = true,
  noOfSections = 4,
  showLegend = false,
  formatXLabel,
  onDataPointPress,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [hoveredPoint, setHoveredPoint] = useState<{ value: number; label: string } | null>(null);

  const colors = useMemo(
    () => ({
      background: isDark ? neutral[900] : '#ffffff',
      text: isDark ? neutral[100] : neutral[900],
      textSecondary: isDark ? neutral[400] : neutral[500],
      line: lineColor || (isDark ? primary[400] : primary[600]),
      area: areaColor || (isDark ? `${primary[500]}30` : `${primary[500]}20`),
      axis: isDark ? neutral[700] : neutral[300],
      grid: isDark ? neutral[800] : neutral[100],
      dataPoint: isDark ? primary[300] : primary[500],
      tooltip: isDark ? neutral[800] : '#ffffff',
      tooltipBorder: isDark ? neutral[700] : neutral[200],
    }),
    [isDark, lineColor, areaColor]
  );

  // Transform single data to chart format
  const chartData = useMemo(() => {
    if (!data) return [];

    return data.map((item, index) => ({
      value: item.value,
      label: item.label || formatXLabel?.(item.date || '') || formatDateLabel(item.date),
      dataPointText: showDataPoints && item.dataPointLabel ? item.dataPointLabel : undefined,
      onPress: () => {
        setHoveredPoint({ value: item.value, label: item.label || item.date || '' });
        onDataPointPress?.(item, index);
      },
    }));
  }, [data, formatXLabel, showDataPoints, onDataPointPress]);

  // For multiple series, we need to render multiple lines
  // gifted-charts supports this with data + data2 props
  const { primaryData, secondaryData } = useMemo(() => {
    if (!series || series.length === 0) {
      return { primaryData: chartData, secondaryData: undefined };
    }

    const primary = series[0]?.data.map((item) => ({
      value: item.value,
      label: item.label || formatXLabel?.(item.date || '') || formatDateLabel(item.date),
    })) || [];

    const secondary = series[1]?.data.map((item) => ({
      value: item.value,
    }));

    return { primaryData: primary, secondaryData: secondary };
  }, [series, chartData, formatXLabel]);

  // Calculate bounds
  const allValues = useMemo(() => {
    if (data) return data.map((d) => d.value);
    if (series) return series.flatMap((s) => s.data.map((d) => d.value));
    return [0];
  }, [data, series]);

  const calculatedMaxValue = maxValue ?? Math.ceil(Math.max(...allValues) * 1.1);

  // Get series colors
  const primaryColor = series?.[0]?.color || colors.line;
  const secondaryColor = series?.[1]?.color || SERIES_COLORS[1];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }, style]}>
      {/* Header */}
      {(title || subtitle) && (
        <View style={styles.header}>
          {title && (
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          )}
          {subtitle && (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {subtitle}
            </Text>
          )}
        </View>
      )}

      {/* Tooltip */}
      {showTooltip && hoveredPoint && (
        <View
          style={[
            styles.tooltip,
            {
              backgroundColor: colors.tooltip,
              borderColor: colors.tooltipBorder,
            },
          ]}
        >
          <Text style={[styles.tooltipValue, { color: colors.text }]}>
            {valuePrefix}{formatValue(hoveredPoint.value)}{valueSuffix}
          </Text>
          <Text style={[styles.tooltipLabel, { color: colors.textSecondary }]}>
            {hoveredPoint.label}
          </Text>
        </View>
      )}

      {/* Legend */}
      {showLegend && series && series.length > 1 && (
        <View style={styles.legend}>
          {series.map((s, index) => (
            <View key={s.id} style={styles.legendItem}>
              <View
                style={[
                  styles.legendColor,
                  { backgroundColor: s.color || SERIES_COLORS[index] },
                ]}
              />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                {s.name}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Chart */}
      <View style={styles.chartContainer}>
        <GiftedLineChart
          data={primaryData}
          data2={secondaryData}
          width={width}
          height={height}
          color={primaryColor}
          color2={secondaryColor}
          thickness={thickness}
          thickness2={thickness}
          curved={curved}
          areaChart={showArea}
          startFillColor={colors.area}
          endFillColor={colors.area}
          startOpacity={0.8}
          endOpacity={0.1}
          startFillColor2={series?.[1]?.areaColor || `${secondaryColor}30`}
          endFillColor2={series?.[1]?.areaColor || `${secondaryColor}10`}
          startOpacity2={0.8}
          endOpacity2={0.1}
          maxValue={calculatedMaxValue}
          noOfSections={noOfSections}
          yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
          xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 9 }}
          yAxisColor={showYAxisLabels ? colors.axis : 'transparent'}
          xAxisColor={showXAxisLabels ? colors.axis : 'transparent'}
          rulesColor={showGrid ? colors.grid : 'transparent'}
          rulesType="solid"
          hideDataPoints={!showDataPoints}
          dataPointsColor={colors.dataPoint}
          dataPointsRadius={dataPointSize}
          dataPointsColor2={secondaryColor}
          isAnimated={animated}
          animationDuration={800}
          initialSpacing={15}
          endSpacing={15}
          spacing={width ? width / (primaryData.length + 1) : 50}
          hideYAxisText={!showYAxisLabels}
          showVerticalLines={false}
        />
      </View>
    </View>
  );
};

// Format date string to short label
function formatDateLabel(date?: string): string {
  if (!date) return '';
  try {
    const d = new Date(date);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return date;
  }
}

// Format large numbers
function formatValue(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  header: {
    marginBottom: spacingPixels[3],
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
  tooltip: {
    position: 'absolute',
    top: spacingPixels[12],
    right: spacingPixels[4],
    padding: spacingPixels[2],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    zIndex: 10,
  },
  tooltipValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  tooltipLabel: {
    fontSize: 11,
    fontWeight: '400',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacingPixels[3],
    gap: spacingPixels[4],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: spacingPixels[2],
  },
  legendText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default LineChart;
