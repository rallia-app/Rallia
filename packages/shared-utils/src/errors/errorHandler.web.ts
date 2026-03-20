/**
 * Error Handler - Web Implementation
 *
 * Platform-specific error handling using browser alerts/confirm
 * In a real implementation, you'd use a toast library or modal
 */

/**
 * Show error message to user
 */
export const showError = (title: string, message: string, onDismiss?: () => void): void => {
  alert(`${title}\n\n${message}`);
  onDismiss?.();
};

/**
 * Show success message to user
 */
export const showSuccess = (title: string, message: string, onDismiss?: () => void): void => {
  alert(`${title}\n\n${message}`);
  onDismiss?.();
};

/**
 * Show warning message to user
 */
export const showWarning = (title: string, message: string, onDismiss?: () => void): void => {
  alert(`${title}\n\n${message}`);
  onDismiss?.();
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
  const result = confirm(`${title}\n\n${message}`);
  if (result) {
    onConfirm();
  } else {
    onCancel?.();
  }
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
  const result = confirm(`${title}\n\n${message}\n\nClick OK to ${confirmText}`);
  if (result) {
    onConfirm();
  } else {
    onCancel?.();
  }
};
