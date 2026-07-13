import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../theme';

export interface DividerProps {
  /**
   * Orientation of the divider
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Thickness of the divider in pixels
   * @default 1
   */
  thickness?: number;

  /**
   * Color of the divider
   * @default colors.gray[300]
   */
  color?: string;

  /**
   * Margin/spacing around the divider
   * For horizontal: top and bottom margin
   * For vertical: left and right margin
   * @default 0
   */
  spacing?: number;

  /**
   * Length of the divider (width for horizontal, height for vertical)
   * Can be a number (px) or '100%'
   * @default '100%'
   */
  length?: number | string;

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
 * Divider component for creating visual separations between content
 *
 * @example
 * ```tsx
 * // Horizontal divider (default)
 * <Divider />
 *
 * // Horizontal divider with spacing
 * <Divider spacing={16} />
 *
 * // Thicker divider
 * <Divider thickness={2} />
 *
 * // Custom color divider
 * <Divider color="#E0E0E0" />
 *
 * // Vertical divider
 * <HStack>
 *   <Text>Left</Text>
 *   <Divider orientation="vertical" length={20} spacing={8} />
 *   <Text>Right</Text>
 * </HStack>
 *
 * // Divider in a list
 * <VStack>
 *   <Text>Item 1</Text>
 *   <Divider spacing={12} />
 *   <Text>Item 2</Text>
 *   <Divider spacing={12} />
 *   <Text>Item 3</Text>
 * </VStack>
 * ```
 */
export const Divider: React.FC<DividerProps> = ({
  orientation = 'horizontal',
  thickness = 1,
  color = colors.gray[300],
  spacing = 0,
  length = '100%',
  style,
  testID = 'divider',
}) => {
  const isHorizontal = orientation === 'horizontal';

  const dividerStyle: ViewStyle = isHorizontal
    ? {
        width: length as number | '100%' | 'auto',
        height: thickness,
        backgroundColor: color,
        marginVertical: spacing,
      }
    : {
        width: thickness,
        height: length as number | '100%' | 'auto',
        backgroundColor: color,
        marginHorizontal: spacing,
      };

  return <View style={[styles.divider, dividerStyle, style]} testID={testID} />;
};

const styles = StyleSheet.create({
  divider: {
    // Base styles
  },
});
