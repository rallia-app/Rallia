/**
 * ConfirmationModal - Reusable confirmation dialog component
 *
 * Used for destructive actions that require user confirmation,
 * such as leaving a match or canceling a match.
 */

import * as React from 'react';
import { useCallback } from 'react';
import { View, StyleSheet, Modal, TouchableWithoutFeedback } from 'react-native';
import { Text, Button } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  neutral,
  status,
} from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';

// =============================================================================
// TYPES
// =============================================================================

export interface ConfirmationModalProps {
  /**
   * Whether the modal is visible
   */
  visible: boolean;

  /**
   * Callback when the modal is dismissed (backdrop tap or cancel)
   */
  onClose: () => void;

  /**
   * Callback when confirm button is pressed
   */
  onConfirm: () => void;

  /**
   * Modal title
   */
  title: string;

  /**
   * Modal message/description
   */
  message: string;

  /**
   * Optional additional info to display (e.g., participant count)
   */
  additionalInfo?: string;

  /**
   * Label for confirm button
   * @default "Confirm"
   */
  confirmLabel?: string;

  /**
   * Label for cancel button
   * @default "Cancel"
   */
  cancelLabel?: string;

  /**
   * Whether this is a destructive action (shows red confirm button)
   * @default false
   */
  destructive?: boolean;

  /**
   * Whether the confirm action is loading
   * @default false
   */
  isLoading?: boolean;

  /**
   * Disable interaction during loading
   * @default true when isLoading
   */
  disabled?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  additionalInfo,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  isLoading = false,
  disabled,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const isDisabled = disabled ?? isLoading;

  // Theme-aware colors
  const colors = {
    backdrop: 'rgba(0, 0, 0, 0.5)',
    background: isDark ? neutral[800] : themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: isDark ? neutral[700] : themeColors.border,
    // Warning box uses amber/warning colors for better readability
    warningBackground: isDark ? 'rgba(251, 191, 36, 0.15)' : 'rgba(245, 158, 11, 0.1)',
    warningBorder: isDark ? status.warning.light : status.warning.DEFAULT,
    warningText: isDark ? status.warning.light : status.warning.dark,
  };

  // Handle confirm with haptic
  const handleConfirm = useCallback(() => {
    if (isDisabled) return;
    mediumHaptic();
    onConfirm();
  }, [isDisabled, onConfirm]);

  // Handle cancel with haptic
  const handleCancel = useCallback(() => {
    if (isLoading) return; // Can't cancel during loading
    lightHaptic();
    onClose();
  }, [isLoading, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={handleCancel}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.modal, { backgroundColor: colors.background }]}>
              {/* Title */}
              <Text size="lg" weight="semibold" style={[styles.title, { color: colors.text }]}>
                {title}
              </Text>

              {/* Message */}
              <Text size="base" style={[styles.message, { color: colors.textMuted }]}>
                {message}
              </Text>

              {/* Additional Info / Warning Box */}
              {additionalInfo && (
                <View
                  style={[
                    styles.infoBox,
                    {
                      backgroundColor: destructive
                        ? colors.warningBackground
                        : isDark
                          ? neutral[800]
                          : neutral[100],
                      borderColor: destructive ? colors.warningBorder : colors.border,
                    },
                  ]}
                >
                  <Text
                    size="sm"
                    weight="medium"
                    style={{
                      color: destructive ? colors.warningText : colors.textMuted,
                    }}
                  >
                    {additionalInfo}
                  </Text>
                </View>
              )}

              {/* Buttons */}
              <View style={styles.buttonContainer}>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={isLoading}
                  onPress={handleCancel}
                  isDark={isDark}
                  style={styles.buttonFlex}
                >
                  {cancelLabel}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  destructive={destructive}
                  loading={isLoading}
                  disabled={isDisabled}
                  onPress={handleConfirm}
                  isDark={isDark}
                  style={styles.buttonFlex}
                >
                  {confirmLabel}
                </Button>
              </View>
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
    paddingBottom: spacingPixels[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  message: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
    lineHeight: 22,
  },
  infoBox: {
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  buttonFlex: {
    flex: 1,
  },
});

export default ConfirmationModal;
