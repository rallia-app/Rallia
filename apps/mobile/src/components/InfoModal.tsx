/**
 * InfoModal - Reusable info dialog component
 *
 * Used for displaying informational content in a modal
 * that matches the app's UI/UX style.
 */

import * as React from 'react';
import { useCallback } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  neutral,
  primary,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';

const BASE_WHITE = '#ffffff';

// =============================================================================
// TYPES
// =============================================================================

export interface InfoModalProps {
  /**
   * Whether the modal is visible
   */
  visible: boolean;

  /**
   * Callback when the modal is dismissed
   */
  onClose: () => void;

  /**
   * Modal title
   */
  title: string;

  /**
   * Modal message/description
   */
  message: string;

  /**
   * Label for close button
   * @default "Got it"
   */
  closeLabel?: string;

  /**
   * Optional icon name (Ionicons)
   */
  iconName?: keyof typeof Ionicons.glyphMap;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const InfoModal: React.FC<InfoModalProps> = ({
  visible,
  onClose,
  title,
  message,
  closeLabel = 'Got it',
  iconName = 'information-circle',
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  // Theme-aware colors
  const colors = {
    backdrop: 'rgba(0, 0, 0, 0.5)',
    background: isDark ? neutral[800] : themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: isDark ? neutral[700] : themeColors.border,
    primary: themeColors.primary,
    iconBackground: isDark ? 'rgba(139, 92, 246, 0.15)' : primary[50],
  };

  // Handle close with haptic
  const handleClose = useCallback(() => {
    lightHaptic();
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.modal, { backgroundColor: colors.background }]}>
              {/* Icon */}
              <View style={[styles.iconContainer, { backgroundColor: colors.iconBackground }]}>
                <Ionicons name={iconName} size={32} color={colors.primary} />
              </View>

              {/* Title */}
              <Text size="lg" weight="semibold" style={[styles.title, { color: colors.text }]}>
                {title}
              </Text>

              {/* Message */}
              <Text size="base" style={[styles.message, { color: colors.textMuted }]}>
                {message}
              </Text>

              {/* Close Button */}
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={handleClose}
                activeOpacity={0.7}
              >
                <Text
                  size="base"
                  weight="medium"
                  style={{ color: BASE_WHITE, textAlign: 'center' }}
                >
                  {closeLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
  },
  modal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radiusPixels.xl,
    paddingTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[5],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  message: {
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    lineHeight: 22,
  },
  button: {
    width: '100%',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
});

export default InfoModal;
