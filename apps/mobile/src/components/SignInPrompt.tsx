/**
 * SignInPrompt Component
 * A beautiful full-screen prompt encouraging users to sign in
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels, radiusPixels, primary } from '@rallia/design-system';
import { useThemeStyles } from '../hooks';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type SignInPromptVariant = 'chat' | 'notifications' | 'generic';

interface SignInPromptProps {
  /** The variant determines the icon and can influence styling */
  variant?: SignInPromptVariant;
  /** Title text to display */
  title: string;
  /** Description text to display */
  description: string;
  /** Button text */
  buttonText: string;
  /** Callback when sign in button is pressed */
  onSignIn: () => void;
  /** Optional custom icon name */
  icon?: keyof typeof Ionicons.glyphMap;
}

const VARIANT_ICONS: Record<SignInPromptVariant, keyof typeof Ionicons.glyphMap> = {
  chat: 'chatbubbles',
  notifications: 'notifications',
  generic: 'person-circle',
};

const SignInPrompt: React.FC<SignInPromptProps> = ({
  variant = 'generic',
  title,
  description,
  buttonText,
  onSignIn,
  icon,
}) => {
  const { colors, isDark } = useThemeStyles();

  // Animation values - using useState with function initializer to avoid ref access during render
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [scaleAnim] = useState(() => new Animated.Value(0.9));
  const [iconBounce] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle icon floating animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconBounce, {
          toValue: -8,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(iconBounce, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [fadeAnim, scaleAnim, iconBounce]);

  const selectedIcon = icon || VARIANT_ICONS[variant];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Icon with glow effect */}
        <View style={styles.iconWrapper}>
          <View
            style={[
              styles.iconGlow,
              {
                backgroundColor: isDark ? `${primary[500]}20` : `${primary[500]}15`,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.iconContainer,
              {
                backgroundColor: isDark ? `${primary[500]}30` : `${primary[500]}20`,
                transform: [{ translateY: iconBounce }],
              },
            ]}
          >
            <Ionicons name={selectedIcon} size={56} color={primary[500]} />
          </Animated.View>
        </View>

        {/* Title */}
        <Text size="2xl" weight="bold" color={colors.text} style={styles.title}>
          {title}
        </Text>

        {/* Description */}
        <Text size="base" color={colors.textMuted} style={styles.description}>
          {description}
        </Text>

        {/* Sign In Button */}
        <Button
          variant="primary"
          size="md"
          rounded
          onPress={onSignIn}
          leftIcon={<Ionicons name="log-in-outline" size={20} color="#FFFFFF" />}
          isDark={isDark}
        >
          {buttonText}
        </Button>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    maxWidth: SCREEN_WIDTH * 0.85,
  },
  iconWrapper: {
    position: 'relative',
    marginBottom: spacingPixels[6],
  },
  iconGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -30,
    left: -30,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  description: {
    textAlign: 'center',
    lineHeight: fontSizePixels.base * 1.6,
    marginBottom: spacingPixels[8],
  },
});

export default SignInPrompt;
