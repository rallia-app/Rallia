/**
 * AnalyticsSectionCard Component
 *
 * A navigation card for analytics sections with icon, title, and summary metric.
 * Used on the main analytics dashboard to navigate to detailed views.
 *
 * @example
 * ```tsx
 * <AnalyticsSectionCard
 *   icon="people"
 *   title="User Analytics"
 *   subtitle="847 new this week"
 *   onPress={() => navigation.navigate('AdminUserAnalytics')}
 * />
 * ```
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@rallia/shared-hooks';
import {
  primary,
  neutral,
  spacingPixels,
  radiusPixels,
} from '@rallia/design-system';
import * as Haptics from 'expo-haptics';

export interface AnalyticsSectionCardProps {
  /**
   * Ionicons icon name
   */
  icon: keyof typeof Ionicons.glyphMap;

  /**
   * Section title
   */
  title: string;

  /**
   * Summary subtitle (e.g., "847 new this week")
   */
  subtitle?: string;

  /**
   * Optional metric value to display prominently
   */
  metricValue?: string | number;

  /**
   * Optional metric label
   */
  metricLabel?: string;

  /**
   * Trend direction for the metric
   */
  trend?: 'up' | 'down' | 'neutral';

  /**
   * Trend percentage change
   */
  trendValue?: number;

  /**
   * Navigation handler
   */
  onPress: () => void;

  /**
   * Whether the card is disabled
   */
  disabled?: boolean;

  /**
   * Custom background color
   */
  backgroundColor?: string;

  /**
   * Custom icon color
   */
  iconColor?: string;

  /**
   * Container style
   */
  style?: ViewStyle;

  /**
   * Card size variant
   */
  size?: 'sm' | 'md' | 'lg' | 'fullWidth';

  /**
   * Extended description for fullWidth variant
   */
  description?: string;
}

export const AnalyticsSectionCard: React.FC<AnalyticsSectionCardProps> = ({
  icon,
  title,
  subtitle,
  description,
  metricValue,
  metricLabel,
  trend,
  trendValue,
  onPress,
  disabled = false,
  backgroundColor,
  iconColor,
  style,
  size = 'md',
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = {
    background: backgroundColor || (isDark ? neutral[800] : '#ffffff'),
    border: isDark ? neutral[700] : neutral[200],
    text: isDark ? neutral[50] : neutral[900],
    textSecondary: isDark ? neutral[400] : neutral[500],
    icon: iconColor || (isDark ? primary[400] : primary[600]),
    iconBackground: isDark ? `${primary[500]}20` : `${primary[500]}10`,
    chevron: isDark ? neutral[600] : neutral[400],
    trendUp: '#10B981',
    trendDown: '#EF4444',
    trendNeutral: neutral[500],
  };

  const sizeStyles = {
    sm: {
      padding: spacingPixels[2], // 8px
      iconSize: 20,
      iconContainerSize: 36,
      titleSize: 14,
      subtitleSize: 12,
      metricSize: 18,
    },
    md: {
      padding: spacingPixels[3], // 12px
      iconSize: 24,
      iconContainerSize: 44,
      titleSize: 15,
      subtitleSize: 13,
      metricSize: 20,
    },
    lg: {
      padding: spacingPixels[4], // 16px
      iconSize: 28,
      iconContainerSize: 52,
      titleSize: 16,
      subtitleSize: 14,
      metricSize: 24,
    },
    fullWidth: {
      padding: spacingPixels[4], // 16px
      iconSize: 24,
      iconContainerSize: 48,
      titleSize: 16,
      subtitleSize: 14,
      metricSize: 20,
      descriptionSize: 13,
    },
  };

  const currentSize = sizeStyles[size];

  const getTrendColor = () => {
    if (trend === 'up') return colors.trendUp;
    if (trend === 'down') return colors.trendDown;
    return colors.trendNeutral;
  };

  const getTrendIcon = (): keyof typeof Ionicons.glyphMap => {
    if (trend === 'up') return 'trending-up';
    if (trend === 'down') return 'trending-down';
    return 'remove';
  };

  const handlePress = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  // Full width variant renders a different layout
  if (size === 'fullWidth') {
    const fullWidthSize = sizeStyles.fullWidth;
    return (
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.7}
        style={[
          styles.fullWidthContainer,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            padding: fullWidthSize.padding,
            opacity: disabled ? 0.5 : 1,
          },
          style,
        ]}
      >
        <View style={styles.fullWidthContent}>
          {/* Icon Container - with gradient-like background */}
          <View
            style={[
              styles.fullWidthIconContainer,
              {
                backgroundColor: colors.iconBackground,
                width: fullWidthSize.iconContainerSize,
                height: fullWidthSize.iconContainerSize,
                borderRadius: radiusPixels.md,
              },
            ]}
          >
            <Ionicons
              name={icon}
              size={fullWidthSize.iconSize}
              color={colors.icon}
            />
          </View>

          {/* Text Content */}
          <View style={styles.fullWidthTextContent}>
            <Text
              style={[
                styles.fullWidthTitle,
                { color: colors.text, fontSize: fullWidthSize.titleSize },
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {(description || subtitle) && (
              <Text
                style={[
                  styles.fullWidthDescription,
                  {
                    color: colors.textSecondary,
                    fontSize: fullWidthSize.descriptionSize,
                  },
                ]}
                numberOfLines={2}
              >
                {description || subtitle}
              </Text>
            )}
          </View>

          {/* Chevron */}
          <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.chevron}
          />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          padding: currentSize.padding,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {/* Icon Container */}
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: colors.iconBackground,
              width: currentSize.iconContainerSize,
              height: currentSize.iconContainerSize,
              borderRadius: currentSize.iconContainerSize / 2,
            },
          ]}
        >
          <Ionicons name={icon} size={currentSize.iconSize} color={colors.icon} />
        </View>

        {/* Text Content */}
        <View style={styles.textContent}>
          <Text
            style={[
              styles.title,
              { color: colors.text, fontSize: currentSize.titleSize },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle && (
            <Text
              style={[
                styles.subtitle,
                { color: colors.textSecondary, fontSize: currentSize.subtitleSize },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
        </View>

        {/* Metric (if provided) */}
        {metricValue !== undefined && (
          <View style={styles.metricContainer}>
            <Text
              style={[
                styles.metricValue,
                { color: colors.text, fontSize: currentSize.metricSize },
              ]}
            >
              {typeof metricValue === 'number'
                ? metricValue.toLocaleString()
                : metricValue}
            </Text>
            {metricLabel && (
              <Text
                style={[
                  styles.metricLabel,
                  { color: colors.textSecondary, fontSize: currentSize.subtitleSize - 2 },
                ]}
              >
                {metricLabel}
              </Text>
            )}
            {trend && trendValue !== undefined && (
              <View style={styles.trendContainer}>
                <Ionicons
                  name={getTrendIcon()}
                  size={12}
                  color={getTrendColor()}
                />
                <Text style={[styles.trendText, { color: getTrendColor() }]}>
                  {trendValue > 0 ? '+' : ''}{trendValue}%
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Chevron */}
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.chevron}
          style={styles.chevron}
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3], // 12px
  },
  textContent: {
    flex: 1,
    marginRight: spacingPixels[2], // 8px
  },
  title: {
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    fontWeight: '400',
  },
  // Full width variant styles
  fullWidthContainer: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
  },
  fullWidthContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fullWidthIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[4], // 16px
  },
  fullWidthTextContent: {
    flex: 1,
    marginRight: spacingPixels[3],
  },
  fullWidthTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  fullWidthDescription: {
    fontWeight: '400',
    lineHeight: 18,
  },
  metricContainer: {
    alignItems: 'flex-end',
    marginRight: spacingPixels[2], // 8px
  },
  metricValue: {
    fontWeight: '700',
  },
  metricLabel: {
    fontWeight: '400',
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 2,
  },
  chevron: {
    marginLeft: 'auto',
  },
});

export default AnalyticsSectionCard;
