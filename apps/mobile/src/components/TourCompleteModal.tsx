/**
 * TourCompleteModal - Confirmation sheet shown after completing the main tour.
 *
 * Mirrors the WelcomeTourModal bottom-sheet pattern (icon ring, title, copy,
 * primary CTA) so the start and end of the tour read as a matched pair.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStyles } from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';
import { Ionicons } from '@expo/vector-icons';

import { useTranslation } from '#/hooks';
import { lightHaptic } from '#/utils/haptics';

interface TourCompleteModalProps {
  /** Whether the modal should be visible */
  visible: boolean;
  /** Callback when modal is dismissed */
  onDismiss: () => void;
  /** The tour that was completed (for analytics) */
  tourId?: string;
}

export const TourCompleteModal: React.FC<TourCompleteModalProps> = ({
  visible,
  onDismiss,
  tourId = 'main_navigation',
}) => {
  const { t } = useTranslation();
  const { colors } = useThemeStyles();
  const insets = useSafeAreaInsets();
  const tintedPrimaryBg = `${colors.primary}26`;

  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  useEffect(() => {
    if (!visible) return;
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
    Logger.logUserAction('tour_complete_modal_shown', { tourId });
  }, [visible, fadeAnim, slideAnim, tourId]);

  const handleDismiss = useCallback(() => {
    lightHaptic();
    Logger.logUserAction('tour_complete_modal_dismissed', { tourId });
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 50,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [fadeAnim, slideAnim, onDismiss, tourId]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Animated.View
          style={[
            styles.container,
            {
              backgroundColor: colors.cardBackground,
              transform: [{ translateY: slideAnim }],
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <View style={[styles.iconContainer, { backgroundColor: tintedPrimaryBg }]}>
            <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{t('tour.complete.title')}</Text>

          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {t('tour.complete.description')}
          </Text>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={handleDismiss}
              accessibilityLabel={t('tour.complete.button')}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                {t('tour.complete.button')}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.tip, { color: colors.textMuted }]}>{t('tour.complete.tip')}</Text>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  tip: {
    marginTop: 16,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});

export default TourCompleteModal;
