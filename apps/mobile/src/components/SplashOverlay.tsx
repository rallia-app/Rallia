import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Animated, Dimensions, Easing } from 'react-native';
import RalliaLogoDark from '../../assets/images/logo-dark.svg';
import RalliaLogoLight from '../../assets/images/logo-light.svg';
import { ANIMATION_DELAYS } from '../constants';
import { useThemeStyles, useTranslation } from '../hooks';
import { primary } from '@rallia/design-system';

const { width } = Dimensions.get('window');

interface SplashOverlayProps {
  /** Callback fired when the splash animation has completely finished */
  onAnimationComplete?: () => void;
  /** When true, holds the splash visible until set back to false (e.g. waiting for OTA update) */
  holdVisible?: boolean;
}

/**
 * SplashOverlay - Animated splash overlay shown on app launch
 *
 * Renders on top of the entire app and fades out after the animation completes.
 * This avoids navigation transitions since it's an overlay, not a screen.
 */
export function SplashOverlay({ onAnimationComplete, holdVisible = false }: SplashOverlayProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(true);
  const [minDurationElapsed, setMinDurationElapsed] = useState(false);

  // Logo animations (useState lazy init keeps stable refs without accessing refs during render)
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [logoScale] = useState(() => new Animated.Value(0.6));
  const [logoTranslateY] = useState(() => new Animated.Value(20));

  // Slogan animation (slightly delayed after logo)
  const [sloganOpacity] = useState(() => new Animated.Value(0));
  const [sloganTranslateY] = useState(() => new Animated.Value(12));

  // Background circle animations
  const [circle1Scale] = useState(() => new Animated.Value(0.8));
  const [circle1Opacity] = useState(() => new Animated.Value(0));
  const [circle2Scale] = useState(() => new Animated.Value(0.8));
  const [circle2Opacity] = useState(() => new Animated.Value(0));

  // Exit animation
  const [exitOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    // All entrance animations run in parallel with staggered delays
    Animated.parallel([
      // Circle 1: fade in and scale up
      Animated.timing(circle1Opacity, {
        toValue: 0.1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(circle1Scale, {
        toValue: 1,
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
      // Circle 2: slightly delayed fade in and scale up
      Animated.sequence([
        Animated.delay(80),
        Animated.timing(circle2Opacity, {
          toValue: 0.15,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(80),
        Animated.spring(circle2Scale, {
          toValue: 1,
          tension: 35,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      // Logo: delayed entrance with bounce
      Animated.sequence([
        Animated.delay(150),
        Animated.parallel([
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 250,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.spring(logoScale, {
            toValue: 1,
            tension: 80,
            friction: 6,
            useNativeDriver: true,
          }),
          Animated.spring(logoTranslateY, {
            toValue: 0,
            tension: 80,
            friction: 6,
            useNativeDriver: true,
          }),
        ]),
      ]),
      // Slogan: fade in after logo
      Animated.sequence([
        Animated.delay(350),
        Animated.parallel([
          Animated.timing(sloganOpacity, {
            toValue: 1,
            duration: 350,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.spring(sloganTranslateY, {
            toValue: 0,
            tension: 60,
            friction: 8,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();

    // Mark minimum animation duration as elapsed
    const timer = setTimeout(() => {
      setMinDurationElapsed(true);
    }, ANIMATION_DELAYS.SPLASH_DURATION);

    return () => clearTimeout(timer);
  }, [
    logoOpacity,
    logoScale,
    logoTranslateY,
    sloganOpacity,
    sloganTranslateY,
    circle1Scale,
    circle1Opacity,
    circle2Scale,
    circle2Opacity,
  ]);

  // Run exit animation once minimum duration has elapsed AND hold is released
  const hasExitedRef = useRef(false);
  useEffect(() => {
    if (!minDurationElapsed || holdVisible || hasExitedRef.current) return;
    hasExitedRef.current = true;

    Animated.timing(exitOpacity, {
      toValue: 0,
      duration: 300,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setIsVisible(false);
      onAnimationComplete?.();
    });
  }, [minDurationElapsed, holdVisible, exitOpacity, onAnimationComplete]);

  // Don't render anything after animation completes
  if (!isVisible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          opacity: exitOpacity,
        },
      ]}
      pointerEvents="none"
    >
      {/* Background circles */}
      <Animated.View
        style={[
          styles.circle1,
          {
            backgroundColor: colors.card,
            opacity: circle1Opacity,
            transform: [{ scale: circle1Scale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.circle2,
          {
            backgroundColor: isDark ? primary[500] : primary[600],
            opacity: circle2Opacity,
            transform: [{ scale: circle2Scale }],
          },
        ]}
      />

      {/* Logo and slogan (centered block) */}
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }, { translateY: logoTranslateY }],
          },
        ]}
      >
        {isDark ? (
          <RalliaLogoLight width={200} height={80} />
        ) : (
          <RalliaLogoDark width={200} height={80} />
        )}
        <Animated.Text
          style={[
            styles.slogan,
            {
              color: colors.textSecondary,
              opacity: sloganOpacity,
              transform: [{ translateY: sloganTranslateY }],
            },
          ]}
        >
          {t('splash.slogan')}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  logoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  slogan: {
    marginTop: 48,
    textAlign: 'center',
    fontSize: 17,
    letterSpacing: 0.3,
  },
  circle1: {
    position: 'absolute',
    width: width * 1.4,
    height: width * 1.4,
    borderRadius: (width * 1.4) / 2,
    top: -width * 0.4,
    left: -width * 0.2,
  },
  circle2: {
    position: 'absolute',
    width: width * 1.6,
    height: width * 1.6,
    borderRadius: (width * 1.6) / 2,
    bottom: -width * 0.6,
    right: -width * 0.3,
  },
});
