import React from 'react';
import { ActivityIndicator, View, StyleSheet, ViewStyle } from 'react-native';
import { primary } from '@rallia/design-system';

// Default spinner color - teal primary that is visible on both light and dark backgrounds
const DEFAULT_SPINNER_COLOR = primary[500]; // #14b8a6

export interface SpinnerProps {
  /**
   * Size of the spinner
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';

  /**
   * Color of the spinner
   * @default primary[500] (teal)
   */
  color?: string;

  /**
   * Whether to center the spinner in its container
   * @default false
   */
  center?: boolean;

  /**
   * Additional style overrides
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

/**
 * Spinner component for indicating loading states
 * Uses React Native's ActivityIndicator with size and color customization
 *
 * @example
 * ```tsx
 * // Basic spinner
 * <Spinner />
 *
 * // Small spinner
 * <Spinner size="sm" />
 *
 * // Large spinner with custom color
 * <Spinner size="lg" color="#FF5722" />
 *
 * // Centered spinner
 * <Spinner center />
 *
 * // In a button (loading state)
 * <Button disabled>
 *   <HStack spacing={8} align="center">
 *     <Spinner size="sm" color="#fff" />
 *     <Text color="#fff">Loading...</Text>
 *   </HStack>
 * </Button>
 *
 * // Full-screen loading
 * <View style={{ flex: 1 }}>
 *   <Spinner size="xl" center />
 * </View>
 * ```
 */
export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = DEFAULT_SPINNER_COLOR,
  center = false,
  style,
  testID = 'spinner',
}) => {
  // Map size prop to ActivityIndicator size and custom dimensions
  const getSize = (): 'small' | 'large' => {
    return size === 'sm' || size === 'md' ? 'small' : 'large';
  };

  // Get scale transform for xl size
  const getScale = (): number => {
    const scales = {
      sm: 0.8,
      md: 1,
      lg: 1,
      xl: 1.5,
    };
    return scales[size];
  };

  const spinnerStyle: ViewStyle = {
    transform: [{ scale: getScale() }],
  };

  const containerStyle: ViewStyle = center
    ? {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
      }
    : {};

  return (
    <View style={[containerStyle, style]} testID={testID}>
      <ActivityIndicator size={getSize()} color={color} style={spinnerStyle} />
    </View>
  );
};

const styles = StyleSheet.create({
  // No additional styles needed
});
