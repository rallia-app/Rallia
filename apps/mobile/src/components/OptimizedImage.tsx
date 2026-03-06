/**
 * OptimizedImage - A wrapper around React Native Image
 *
 * Note: expo-image provides better performance but requires a development build.
 * For Expo Go compatibility, we use React Native's built-in Image component.
 * When you create a dev build, you can switch to expo-image for better caching.
 */

import React from 'react';
import { Image as RNImage, ImageStyle, StyleProp } from 'react-native';

interface OptimizedImageProps {
  source: { uri: string };
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  placeholder?: string;
  transition?: number;
}

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  source,
  style,
  contentFit = 'cover',
}) => {
  // Map contentFit to resizeMode for RN Image
  const resizeMode =
    contentFit === 'scale-down' ? 'contain' : (contentFit as 'cover' | 'contain' | 'stretch');

  return <RNImage source={source} style={style} resizeMode={resizeMode} />;
};

export default OptimizedImage;
