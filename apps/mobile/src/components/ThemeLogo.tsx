/**
 * ThemeLogo Component
 *
 * Automatically switches between light and dark logo variants based on the current theme.
 * Uses useTheme hook to determine the active theme.
 */

import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { useTheme } from '@rallia/shared-hooks';

import RalliaLogoDark from '../../assets/images/logo-dark.svg';
import RalliaLogoLight from '../../assets/images/logo-light.svg';

interface ThemeLogoProps {
  /** Logo width */
  width?: number;
  /** Logo height */
  height?: number;
  /** Additional container styles */
  style?: StyleProp<ViewStyle>;
}

export const ThemeLogo: React.FC<ThemeLogoProps> = ({ width = 100, height = 30, style }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <View style={style}>
      {isDark ? (
        <RalliaLogoLight width={width} height={height} />
      ) : (
        <RalliaLogoDark width={width} height={height} />
      )}
    </View>
  );
};

export default ThemeLogo;
