import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from '@rallia/shared-components';

interface ProfileCompletionRingProps {
  /** Percentage complete (0-100) */
  percentage: number;
  /** Diameter of the ring in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Color of the filled portion */
  color: string;
  /** Color of the unfilled track */
  trackColor: string;
  /** Whether to show the percentage text in the center */
  showLabel?: boolean;
  /** Text color for the center label */
  labelColor?: string;
}

const ProfileCompletionRing: React.FC<ProfileCompletionRingProps> = ({
  percentage,
  size = 40,
  strokeWidth = 4,
  color,
  trackColor,
  showLabel = true,
  labelColor,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPercentage = Math.min(100, Math.max(0, percentage));
  const strokeDashoffset = circumference - (clampedPercentage / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Background track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {showLabel && (
        <Text
          size="xs"
          weight="semibold"
          style={{ color: labelColor ?? color, fontSize: size * 0.25 }}
        >
          {clampedPercentage}%
        </Text>
      )}
    </View>
  );
};

export default ProfileCompletionRing;
