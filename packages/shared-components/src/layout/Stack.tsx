import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { spacing } from '../theme';

export interface StackProps {
  /**
   * Content to render inside the stack
   */
  children: React.ReactNode;

  /**
   * Direction of the stack
   * @default 'vertical'
   */
  direction?: 'vertical' | 'horizontal';

  /**
   * Spacing between children (in pixels)
   * @default 8
   */
  spacing?: number;

  /**
   * Alignment of children along the cross axis
   * - vertical stack: 'start' = left, 'center' = center, 'end' = right, 'stretch' = full width
   * - horizontal stack: 'start' = top, 'center' = center, 'end' = bottom, 'stretch' = full height
   * @default 'stretch'
   */
  align?: 'start' | 'center' | 'end' | 'stretch';

  /**
   * Justification of children along the main axis
   * - 'start': pack items at the start
   * - 'center': pack items at the center
   * - 'end': pack items at the end
   * - 'space-between': distribute items evenly, first at start, last at end
   * - 'space-around': distribute items evenly with equal space around
   * - 'space-evenly': distribute items evenly with equal space between
   * @default 'start'
   */
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';

  /**
   * Whether children should wrap to the next line/column
   * @default false
   */
  wrap?: boolean;

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
 * Stack component for laying out children with consistent spacing
 * Supports both vertical (VStack) and horizontal (HStack) layouts
 *
 * @example
 * ```tsx
 * // Vertical stack (default)
 * <Stack spacing={16}>
 *   <Text>Item 1</Text>
 *   <Text>Item 2</Text>
 *   <Text>Item 3</Text>
 * </Stack>
 *
 * // Horizontal stack
 * <Stack direction="horizontal" spacing={8}>
 *   <Button>Cancel</Button>
 *   <Button>Submit</Button>
 * </Stack>
 *
 * // Centered items
 * <Stack align="center" spacing={12}>
 *   <Icon name="check" />
 *   <Text>Success!</Text>
 * </Stack>
 *
 * // Space between items
 * <Stack direction="horizontal" justify="space-between">
 *   <Text>Left</Text>
 *   <Text>Right</Text>
 * </Stack>
 *
 * // Wrapping horizontal stack
 * <Stack direction="horizontal" spacing={8} wrap>
 *   <Badge>Tag 1</Badge>
 *   <Badge>Tag 2</Badge>
 *   <Badge>Tag 3</Badge>
 * </Stack>
 * ```
 */
export const Stack: React.FC<StackProps> = ({
  children,
  direction = 'vertical',
  spacing: spacingProp = spacing[2], // 8px default
  align = 'stretch',
  justify = 'start',
  wrap = false,
  style,
  testID = 'stack',
}) => {
  const isHorizontal = direction === 'horizontal';

  // Map align prop to flexbox alignItems
  const alignItems: ViewStyle['alignItems'] = {
    start: 'flex-start' as const,
    center: 'center' as const,
    end: 'flex-end' as const,
    stretch: 'stretch' as const,
  }[align];

  // Map justify prop to flexbox justifyContent
  const justifyContent: ViewStyle['justifyContent'] = {
    start: 'flex-start' as const,
    center: 'center' as const,
    end: 'flex-end' as const,
    'space-between': 'space-between' as const,
    'space-around': 'space-around' as const,
    'space-evenly': 'space-evenly' as const,
  }[justify];

  // Filter out null/undefined children
  const validChildren = React.Children.toArray(children).filter(Boolean);

  return (
    <View
      style={[
        styles.container,
        {
          flexDirection: isHorizontal ? 'row' : 'column',
          alignItems,
          justifyContent,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
      testID={testID}
    >
      {validChildren.map((child, index) => {
        const isLastChild = index === validChildren.length - 1;

        // Don't add spacing after the last child
        if (isLastChild) {
          return <React.Fragment key={index}>{child}</React.Fragment>;
        }

        // Add spacing based on direction
        const spacingStyle: ViewStyle = isHorizontal
          ? { marginRight: spacingProp }
          : { marginBottom: spacingProp };

        return (
          <View key={index} style={spacingStyle}>
            {child}
          </View>
        );
      })}
    </View>
  );
};

/**
 * VStack is a convenience wrapper for vertical Stack
 *
 * @example
 * ```tsx
 * <VStack spacing={16}>
 *   <Text>Item 1</Text>
 *   <Text>Item 2</Text>
 * </VStack>
 * ```
 */
export const VStack: React.FC<Omit<StackProps, 'direction'>> = props => (
  <Stack {...props} direction="vertical" />
);

/**
 * HStack is a convenience wrapper for horizontal Stack
 *
 * @example
 * ```tsx
 * <HStack spacing={8}>
 *   <Button>Cancel</Button>
 *   <Button>Submit</Button>
 * </HStack>
 * ```
 */
export const HStack: React.FC<Omit<StackProps, 'direction'>> = props => (
  <Stack {...props} direction="horizontal" />
);

const styles = StyleSheet.create({
  container: {
    // Base styles
  },
});
