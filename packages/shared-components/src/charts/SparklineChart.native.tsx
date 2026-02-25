/**
 * SparklineChart Component
 *
 * A minimal inline chart for showing trends within KPI cards.
 * Uses react-native-gifted-charts for rendering.
 *
 * @example
 * ```tsx
 * <SparklineChart
 *   data={[10, 20, 15, 25, 30]}
 *   color="#10B981"
 *   height={40}
 *   width={80}
 * />
 * ```
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

export interface SparklineDataPoint {
  value: number;
  date?: string;
}

export interface SparklineChartProps {
  /**
   * Data points to display - can be numbers or objects with value/date
   */
  data: number[] | SparklineDataPoint[];

  /**
   * Line color
   */
  color?: string;

  /**
   * Fill color under the line (gradient start)
   */
  fillColor?: string;

  /**
   * Chart width
   */
  width?: number;

  /**
   * Chart height
   */
  height?: number;

  /**
   * Whether to show the area fill under the line
   */
  showAreaFill?: boolean;

  /**
   * Line thickness
   */
  thickness?: number;

  /**
   * Whether the trend is positive, negative, or neutral
   * Used to automatically color the line if color prop not provided
   */
  trend?: 'positive' | 'negative' | 'neutral';

  /**
   * Container style
   */
  style?: ViewStyle;

  /**
   * Whether to animate the chart on render
   */
  animated?: boolean;
}

const TREND_COLORS = {
  positive: '#10B981', // Green
  negative: '#EF4444', // Red
  neutral: '#6B7280', // Gray
};

const TREND_FILL_COLORS = {
  positive: 'rgba(16, 185, 129, 0.1)',
  negative: 'rgba(239, 68, 68, 0.1)',
  neutral: 'rgba(107, 114, 128, 0.1)',
};

export const SparklineChart: React.FC<SparklineChartProps> = ({
  data,
  color,
  fillColor,
  width = 80,
  height = 40,
  showAreaFill = true,
  thickness = 2,
  trend = 'neutral',
  style,
  animated = false,
}) => {
  // Determine colors based on trend if not explicitly provided
  const lineColor = color || TREND_COLORS[trend];
  const areaFillColor = fillColor || TREND_FILL_COLORS[trend];

  // Convert data to chart format
  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return [{ value: 0 }];
    }

    return data.map((item) => {
      if (typeof item === 'number') {
        return { value: item };
      }
      return { value: item.value };
    });
  }, [data]);

  // Calculate min/max for better scaling
  const values = chartData.map((d) => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const padding = range * 0.1 || 1; // 10% padding or 1 if flat

  if (chartData.length < 2) {
    // Not enough data to show a line
    return <View style={[styles.container, { width, height }, style]} />;
  }

  return (
    <View style={[styles.container, { width, height }, style]}>
      <LineChart
        data={chartData}
        width={width}
        height={height}
        color={lineColor}
        thickness={thickness}
        hideDataPoints
        hideYAxisText
        hideAxesAndRules
        curved
        curveType={0}
        areaChart={showAreaFill}
        startFillColor={areaFillColor}
        endFillColor="transparent"
        startOpacity={0.4}
        endOpacity={0}
        yAxisOffset={minValue - padding}
        maxValue={maxValue + padding}
        adjustToWidth
        disableScroll
        isAnimated={animated}
        animationDuration={500}
        initialSpacing={0}
        endSpacing={0}
        spacing={(width - 10) / Math.max(chartData.length - 1, 1)}
        noOfSections={0}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

export default SparklineChart;
