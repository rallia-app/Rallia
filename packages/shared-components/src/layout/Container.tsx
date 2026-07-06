import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { spacing } from '../theme';

export interface ContainerProps {
  /**
   * Content to render inside the container
   */
  children: React.ReactNode;

  /**
   * Padding around the content
   * Can be a number (applies to all sides) or an object for individual sides
   * @default 16
   */
  padding?:
    | number
    | {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
        horizontal?: number;
        vertical?: number;
      };

  /**
   * Maximum width of the container
   * Useful for centering content on large screens
   */
  maxWidth?: number | string;

  /**
   * Background color of the container
   * @default 'transparent'
   */
  backgroundColor?: string;

  /**
   * Whether to center the container horizontally when maxWidth is set
   * @default true
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
 * Container component provides consistent padding and max-width for content
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Container>
 *   <Text>Content goes here</Text>
 * </Container>
 *
 * // With custom padding
 * <Container padding={24}>
 *   <Text>More padding</Text>
 * </Container>
 *
 * // With max width (centered on large screens)
 * <Container maxWidth={600}>
 *   <Text>Centered content</Text>
 * </Container>
 *
 * // With background color
 * <Container backgroundColor="#f5f5f5" padding={20}>
 *   <Text>Colored background</Text>
 * </Container>
 *
 * // With custom padding per side
 * <Container padding={{ horizontal: 24, vertical: 16 }}>
 *   <Text>Different padding</Text>
 * </Container>
 * ```
 */
export const Container: React.FC<ContainerProps> = ({
  children,
  padding = spacing[4], // 16px default
  maxWidth,
  backgroundColor = 'transparent',
  center = true,
  style,
  testID = 'container',
}) => {
  // Calculate padding styles
  const paddingStyle: ViewStyle =
    typeof padding === 'number'
      ? { padding }
      : {
          paddingTop: padding.top ?? padding.vertical,
          paddingRight: padding.right ?? padding.horizontal,
          paddingBottom: padding.bottom ?? padding.vertical,
          paddingLeft: padding.left ?? padding.horizontal,
        };

  // Calculate max width and centering
  const maxWidthStyle: ViewStyle = maxWidth
    ? {
        maxWidth: maxWidth as number | '100%' | 'auto',
        width: '100%',
        ...(center && { alignSelf: 'center' as const }),
      }
    : {};

  return (
    <View
      style={[styles.container, paddingStyle, maxWidthStyle, { backgroundColor }, style]}
      testID={testID}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
