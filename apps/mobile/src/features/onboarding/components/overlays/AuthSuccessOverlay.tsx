import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Button } from '@rallia/shared-components';
import { Ionicons } from '@expo/vector-icons';
import { Overlay } from '@rallia/shared-components';
import { Logger } from '@rallia/shared-services';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles } from '../../../../hooks';
import { useSport } from '../../../../context';
import { SportIcon } from '../../../../components/SportIcon';

interface AuthSuccessOverlayProps {
  visible: boolean;
  onClose: () => void;
}

const AuthSuccessOverlay: React.FC<AuthSuccessOverlayProps> = ({ visible, onClose }) => {
  const { colors, isDark } = useThemeStyles();
  const { selectedSport } = useSport();
  // Animation values (useState so we don't read refs during render)
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(50));

  // Trigger animations when overlay becomes visible
  useEffect(() => {
    if (visible) {
      // Reset animation values
      fadeAnim.setValue(0);
      slideAnim.setValue(50);

      // Run animations in parallel
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleCreateMatch = () => {
    mediumHaptic();
    Logger.logUserAction('create_match_intent', { source: 'auth_success_overlay' });
    // TODO: Navigate to create match screen
    onClose();
  };

  const handleJoinMatch = () => {
    mediumHaptic();
    Logger.logUserAction('join_match_intent', { source: 'auth_success_overlay' });
    // TODO: Navigate to join match screen
    onClose();
  };

  const handleJoinCommunity = () => {
    mediumHaptic();
    Logger.logUserAction('join_community_intent', { source: 'auth_success_overlay' });
    // TODO: Navigate to community screen
    onClose();
  };

  const handleClose = () => {
    lightHaptic();
    onClose();
  };

  return (
    <Overlay visible={visible} onClose={handleClose} showBackButton={false}>
      <Animated.View
        style={[
          styles.container,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>Welcome to Rallia!</Text>

        {/* Subtitle */}
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Your account was created successfully. Here are some actions you can now take.
        </Text>

        {/* Action Options */}
        <View style={styles.actionsContainer}>
          {/* Create a new match */}
          <TouchableOpacity
            style={[styles.actionItem, { backgroundColor: colors.inputBackground }]}
            onPress={handleCreateMatch}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <SportIcon
                sportName={selectedSport?.name ?? 'tennis'}
                size={24}
                color={colors.primary}
              />
              <View style={styles.actionTextContainer}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>Create a new match</Text>
                <Text style={[styles.actionDescription, { color: colors.textMuted }]}>
                  Create a new match and let other players join
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Join a match */}
          <TouchableOpacity
            style={[styles.actionItem, { backgroundColor: colors.inputBackground }]}
            onPress={handleJoinMatch}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="location-outline" size={24} color={colors.primary} />
              <View style={styles.actionTextContainer}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>Join a match</Text>
                <Text style={[styles.actionDescription, { color: colors.textMuted }]}>
                  Browse public matches and join a game nearby
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Join a community */}
          <TouchableOpacity
            style={[styles.actionItem, { backgroundColor: colors.inputBackground }]}
            onPress={handleJoinCommunity}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="people-outline" size={24} color={colors.primary} />
              <View style={styles.actionTextContainer}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>Join a community</Text>
                <Text style={[styles.actionDescription, { color: colors.textMuted }]}>
                  Create a new match and let other players join
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Close Button */}
        <Button variant="primary" size="lg" fullWidth onPress={handleClose} isDark={isDark}>
          Close
        </Button>
      </Animated.View>
    </Overlay>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
    // color will be set dynamically
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
    paddingHorizontal: 10,
    // color will be set dynamically
  },
  actionsContainer: {
    marginBottom: 25,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 15,
    borderRadius: 12,
    marginBottom: 12,
    // backgroundColor will be set dynamically
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    // color will be set dynamically
  },
  actionDescription: {
    fontSize: 13,
    lineHeight: 18,
    // color will be set dynamically
  },
});

export default AuthSuccessOverlay;
