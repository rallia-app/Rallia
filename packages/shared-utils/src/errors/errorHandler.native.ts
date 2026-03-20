/**
 * Error Handler - Native Implementation (React Native)
 *
 * Platform-specific error handling using React Native Alert
 */

import { Alert } from 'react-native';

/**
 * Show error message to user
 */
export const showError = (title: string, message: string, onDismiss?: () => void): void => {
  Alert.alert(title, message, [
    {
      text: 'OK',
      onPress: onDismiss,
    },
  ]);
};

/**
 * Show success message to user
 */
export const showSuccess = (title: string, message: string, onDismiss?: () => void): void => {
  Alert.alert(title, message, [
    {
      text: 'OK',
      onPress: onDismiss,
    },
  ]);
};

/**
 * Show warning message to user
 */
export const showWarning = (title: string, message: string, onDismiss?: () => void): void => {
  Alert.alert(title, message, [
    {
      text: 'OK',
      onPress: onDismiss,
    },
  ]);
};

/**
 * Show confirmation dialog
 */
export const showConfirmation = (
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void
): void => {
  Alert.alert(title, message, [
    {
      text: 'Cancel',
      style: 'cancel',
      onPress: onCancel,
    },
    {
      text: 'Confirm',
      onPress: onConfirm,
    },
  ]);
};

/**
 * Show destructive action confirmation
 */
export const showDestructiveConfirmation = (
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void,
  onCancel?: () => void
): void => {
  Alert.alert(title, message, [
    {
      text: 'Cancel',
      style: 'cancel',
      onPress: onCancel,
    },
    {
      text: confirmText,
      style: 'destructive',
      onPress: onConfirm,
    },
  ]);
};
