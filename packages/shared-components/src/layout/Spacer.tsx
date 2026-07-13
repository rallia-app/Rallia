import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

export interface SpacerProps {
  /**
   * Size of the spacer in pixels
   * Can also accept responsive sizes
   * @default 16
   */
  size?: number;

  /**
   * Direction of the spacer
   * - 'vertical': Adds height (spacing between vertical items)
   * - 'horizontal': Adds width (spacing between horizontal items)
   * @default 'vertical'
   */
  direction?: 'vertical' | 'horizontal';

  /**
   * Whether to use flex to fill available space
   * When true, spacer will grow to fill remaining space in a flex container
   * @default false
   */
  flex?: boolean;

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
 * Spacer component for adding space between elements
 * Can be used for fixed spacing or flexible spacing that fills available space
 *
 * @example
 * ```tsx
 * // Vertical spacer (adds height)
 * <VStack>
 *   <Text>Item 1</Text>
 *   <Spacer size={20} />
 *   <Text>Item 2</Text>
 * </VStack>
 *
 * // Horizontal spacer (adds width)
 * <HStack>
 *   <Text>Left</Text>
 *   <Spacer size={20} direction="horizontal" />
 *   <Text>Right</Text>
 * </HStack>
 *
 * // Flexible spacer (pushes items apart)
 * <HStack>
 *   <Text>Left</Text>
 *   <Spacer flex />
 *   <Text>Right</Text>
 * </HStack>
 *
 * // Vertical flexible spacer
 * <VStack style={{ height: 400 }}>
 *   <Text>Top</Text>
 *   <Spacer flex />
 *   <Button>Bottom Button</Button>
 * </VStack>
 *
 * // Custom size spacer
 * <VStack>
 *   <Heading>Title</Heading>
 *   <Spacer size={32} />
 *   <Text>Content with larger spacing</Text>
 * </VStack>
 * ```
 */
export const Spacer: React.FC<SpacerProps> = ({
  size = 16,
  direction = 'vertical',
  flex = false,
  style,
  testID = 'spacer',
}) => {
  const isVertical = direction === 'vertical';

  const spacerStyle: ViewStyle = flex
    ? {
        flex: 1,
      }
    : isVertical
      ? {
          height: size,
          width: '100%',
        }
      : {
          width: size,
          height: '100%',
        };

  return <View style={[styles.spacer, spacerStyle, style]} testID={testID} />;
};

const styles = StyleSheet.create({
  spacer: {
    // Base styles
  },
});
