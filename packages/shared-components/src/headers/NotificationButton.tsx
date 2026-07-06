import React, { useRef, useEffect, useCallback, useState } from 'react';
import { TouchableOpacity, View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { lightHaptic } from '@rallia/shared-utils';

interface NotificationButtonProps {
  /** Callback when button is pressed */
  onPress?: () => void;
  /** Icon size */
  size?: number;
  /** Icon color */
  color?: string;
  /** Number of unread notifications to display as badge */
  unreadCount?: number;
  /** Badge background color */
  badgeColor?: string;
  /** Badge text color */
  badgeTextColor?: string;
}

const NotificationButton: React.FC<NotificationButtonProps> = ({
  onPress,
  size = 24,
  color = '#333',
  unreadCount = 0,
  badgeColor = '#EF6F7B',
  badgeTextColor = '#fff',
}) => {
  // Use useState with lazy init so Animated.Values are stable and not accessed via refs during render
  const [bellRotation] = useState(() => new Animated.Value(0));
  const [badgeScale] = useState(() => new Animated.Value(unreadCount > 0 ? 1 : 0));
  const prevUnreadCount = useRef(unreadCount);

  const shakeBell = useCallback(() => {
    Animated.sequence([
      Animated.timing(bellRotation, {
        toValue: 1,
        duration: 80,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(bellRotation, {
        toValue: -1,
        duration: 80,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(bellRotation, {
        toValue: 0.7,
        duration: 70,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(bellRotation, {
        toValue: -0.7,
        duration: 70,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(bellRotation, {
        toValue: 0.4,
        duration: 60,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(bellRotation, {
        toValue: -0.4,
        duration: 60,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(bellRotation, {
        toValue: 0,
        duration: 50,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start();
  }, [bellRotation]);

  const bounceBadge = useCallback(() => {
    Animated.sequence([
      Animated.timing(badgeScale, {
        toValue: 1.4,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 4,
        tension: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [badgeScale]);

  useEffect(() => {
    const prev = prevUnreadCount.current;
    prevUnreadCount.current = unreadCount;

    if (unreadCount > prev) {
      shakeBell();
      bounceBadge();
    } else if (unreadCount === 0 && prev > 0) {
      Animated.timing(badgeScale, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [unreadCount, shakeBell, bounceBadge, badgeScale]);

  const bellRotateInterpolation = bellRotation.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-20deg', '20deg'],
  });

  const handlePress = () => {
    lightHaptic();
    if (onPress) {
      onPress();
    }
  };

  const displayCount = unreadCount > 99 ? '99+' : unreadCount.toString();
  const showBadge = unreadCount > 0;

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress}>
      <View style={styles.iconContainer}>
        <Animated.View style={{ transform: [{ rotate: bellRotateInterpolation }] }}>
          <Ionicons name="notifications-outline" size={size} color={color} />
        </Animated.View>
        {showBadge && (
          <Animated.View
            style={[
              styles.badge,
              {
                backgroundColor: badgeColor,
                minWidth: unreadCount > 99 ? 22 : unreadCount > 9 ? 18 : 16,
                transform: [{ scale: badgeScale }],
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                {
                  color: badgeTextColor,
                  fontSize: unreadCount > 99 ? 8 : unreadCount > 9 ? 9 : 10,
                },
              ]}
            >
              {displayCount}
            </Text>
          </Animated.View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
  iconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default NotificationButton;
