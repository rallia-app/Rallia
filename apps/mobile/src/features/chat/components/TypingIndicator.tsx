/**
 * TypingIndicator Component
 * Shows when other users are typing in a conversation
 */

import React, { memo, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels, primary } from '@rallia/design-system';
import type { TypingIndicator as TypingIndicatorType } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';

interface TypingIndicatorProps {
  typingUsers: TypingIndicatorType[];
}

function TypingIndicatorComponent({ typingUsers }: TypingIndicatorProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  // Animation values - using useMemo for stable instances
  const dot1 = useMemo(() => new Animated.Value(0), []);
  const dot2 = useMemo(() => new Animated.Value(0), []);
  const dot3 = useMemo(() => new Animated.Value(0), []);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (typingUsers.length === 0) return;

    // Create a looping animation with proper cleanup
    const dotAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(dot1, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dot2, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dot3, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dot1, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dot2, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dot3, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ])
    );

    animationRef.current = dotAnimation;
    dotAnimation.start();

    return () => {
      // Properly stop the animation loop on cleanup
      if (animationRef.current) {
        animationRef.current.stop();
        animationRef.current = null;
      }
      dot1.setValue(0);
      dot2.setValue(0);
      dot3.setValue(0);
    };
  }, [typingUsers.length, dot1, dot2, dot3]);

  if (typingUsers.length === 0) return null;

  // Build the typing message
  let typingText = '';
  if (typingUsers.length === 1) {
    typingText = t('chat.typing.one', { name: typingUsers[0].player_name });
  } else if (typingUsers.length === 2) {
    typingText = t('chat.typing.two', {
      name1: typingUsers[0].player_name,
      name2: typingUsers[1].player_name,
    });
  } else {
    typingText = t('chat.typing.many', {
      name: typingUsers[0].player_name,
      count: typingUsers.length - 1,
    });
  }

  const dotStyle = (anim: Animated.Value) => ({
    opacity: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -3],
        }),
      },
    ],
  });

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={[styles.text, { color: colors.textMuted }]}>{typingText}</Text>
        <View style={styles.dotsContainer}>
          <Animated.View style={[styles.dot, { backgroundColor: primary[500] }, dotStyle(dot1)]} />
          <Animated.View style={[styles.dot, { backgroundColor: primary[500] }, dotStyle(dot2)]} />
          <Animated.View style={[styles.dot, { backgroundColor: primary[500] }, dotStyle(dot3)]} />
        </View>
      </View>
    </View>
  );
}

export const TypingIndicator = memo(TypingIndicatorComponent);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
  },
  dotsContainer: {
    flexDirection: 'row',
    marginLeft: spacingPixels[1],
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 2,
  },
});
