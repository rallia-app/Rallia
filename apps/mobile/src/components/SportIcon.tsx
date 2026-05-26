/**
 * SportIcon - Renders tennis.svg or pickleball.svg based on sport name.
 * Use wherever a sport-specific icon is needed (matches, courts, etc.).
 */

import React from 'react';
import { ViewStyle } from 'react-native';

import TennisIcon from '../../assets/icons/tennis.svg';
import PickleballIcon from '../../assets/icons/pickleball.svg';

export type SportIconName = 'tennis' | 'pickleball';

interface SportIconProps {
  /** Sport name (e.g. 'tennis', 'pickleball'). Case-insensitive. Defaults to tennis if unknown. */
  sportName: string;
  size: number;
  /** Fill color for the icon (passed as fill to the SVG). */
  color: string;
  style?: ViewStyle;
}

export function SportIcon({ sportName, size, color, style }: SportIconProps) {
  const isPickleball = sportName?.toLowerCase() === 'pickleball';
  const Icon = isPickleball ? PickleballIcon : TennisIcon;
  return <Icon width={size} height={size} fill={color} style={style} />;
}

export default SportIcon;
