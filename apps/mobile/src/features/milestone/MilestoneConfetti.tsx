/**
 * One-shot confetti rain for the milestone takeover. Core Animated on the
 * native driver, no library: OTA-safe and free after launch.
 */
import React, { useEffect, useMemo } from 'react';
import { Animated, Dimensions, Easing, StyleSheet } from 'react-native';
import { primary, accent } from '@rallia/design-system';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PIECE_COLORS = [
  accent[300],
  accent[400],
  accent[500],
  primary[300],
  primary[400],
  primary[500],
];
const PIECE_COUNT = 26;

type Piece = {
  x: number;
  drift: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  spin: string;
};

// Module scope: render stays pure for the React Compiler.
const pieces: Piece[] = Array.from({ length: PIECE_COUNT }, (_, i) => ({
  x: Math.random() * SCREEN_WIDTH,
  drift: (Math.random() - 0.5) * 140,
  size: 6 + Math.random() * 6,
  color: PIECE_COLORS[i % PIECE_COLORS.length],
  delay: Math.random() * 500,
  duration: 2200 + Math.random() * 1200,
  spin: `${Math.random() > 0.5 ? '' : '-'}${540 + Math.floor(Math.random() * 360)}deg`,
}));

export function MilestoneConfetti() {
  const progress = useMemo(() => pieces.map(() => new Animated.Value(0)), []);

  useEffect(() => {
    Animated.parallel(
      pieces.map((piece, i) =>
        Animated.timing(progress[i], {
          toValue: 1,
          duration: piece.duration,
          delay: piece.delay,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      )
    ).start();
  }, [progress]);

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((piece, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            top: -24,
            left: piece.x,
            width: piece.size,
            height: piece.size * 1.6,
            borderRadius: 2,
            backgroundColor: piece.color,
            opacity: progress[i].interpolate({
              inputRange: [0, 0.7, 1],
              outputRange: [1, 1, 0],
            }),
            transform: [
              {
                translateY: progress[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, SCREEN_HEIGHT * 0.9],
                }),
              },
              {
                translateX: progress[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, piece.drift],
                }),
              },
              {
                rotate: progress[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', piece.spin],
                }),
              },
            ],
          }}
        />
      ))}
    </Animated.View>
  );
}

export default MilestoneConfetti;
