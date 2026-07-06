import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Text } from '../foundation/Text';
import { Button } from '../foundation/Button';
import { VStack } from '../layout/Stack';
import { colors, spacing } from '../theme';

export interface ErrorMessageProps {
  /**
   * Error message to display
   */
  message: string;

  /**
   * Title/heading for the error
   * @default 'Error'
   */
  title?: string;

  /**
   * Callback when retry button is pressed
   * If not provided, retry button won't be shown
   */
  onRetry?: () => void;

  /**
   * Custom text for the retry button
   * @default 'Try Again'
   */
  retryText?: string;

  /**
   * Icon to display (emoji or component)
   * @default '⚠️'
   */
  icon?: React.ReactNode;

  /**
   * Variant style of the error message
   * - 'default': Light red background with border
   * - 'inline': Minimal styling for inline errors
   * - 'centered': Centered layout for full-screen errors
   * @default 'default'
   */
  variant?: 'default' | 'inline' | 'centered';

  /**
   * Whether to show the icon
   * @default true
   */
  showIcon?: boolean;

  /**
   * Additional style overrides
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

/**
 * ErrorMessage component for displaying errors with optional retry functionality
 *
 * @example
 * ```tsx
 * // Basic error message
 * <ErrorMessage message="Failed to load data" />
 *
 * // Error with retry
 * <ErrorMessage
 *   message="Network request failed"
 *   onRetry={() => refetch()}
 * />
 *
 * // Custom title and retry text
 * <ErrorMessage
 *   title="Connection Error"
 *   message="Unable to connect to the server"
 *   onRetry={() => refetch()}
 *   retryText="Reconnect"
 * />
 *
 * // Inline error (for forms)
 * <ErrorMessage
 *   variant="inline"
 *   message="Email is required"
 *   showIcon={false}
 * />
 *
 * // Centered full-screen error
 * <ErrorMessage
 *   variant="centered"
 *   title="Something went wrong"
 *   message="We couldn't load your matches. Please try again."
 *   icon="😕"
 *   onRetry={() => refetch()}
 * />
 *
 * // Custom icon
 * <ErrorMessage
 *   message="Authentication failed"
 *   icon={<CustomErrorIcon />}
 *   onRetry={() => login()}
 * />
 * ```
 */
export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message,
  title = 'Error',
  onRetry,
  retryText = 'Try Again',
  icon = '⚠️',
  variant = 'default',
  showIcon = true,
  style,
  testID = 'error-message',
}) => {
  const isCentered = variant === 'centered';
  const isInline = variant === 'inline';

  // Variant-specific styles
  const containerStyle: ViewStyle = {
    default: {
      backgroundColor: colors.error + '10', // 10% opacity
      borderWidth: 1,
      borderColor: colors.error + '40', // 40% opacity
      borderRadius: 8,
      padding: spacing[4], // 16px
    },
    inline: {
      // Minimal styling for inline errors
    },
    centered: {
      flex: 1,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      padding: spacing[6], // 24px
    },
  }[variant];

  const textAlign = isCentered ? 'center' : 'left';

  return (
    <View
      style={[styles.container, containerStyle, isCentered && styles.centeredContainer, style]}
      testID={testID}
    >
      <VStack
        spacing={spacing[3]} // 12px
        align={isCentered ? 'center' : 'stretch'}
      >
        {/* Icon */}
        {showIcon && (
          <View style={[styles.iconContainer, isCentered && styles.centeredIcon]}>
            {typeof icon === 'string' ? <Text size="2xl">{icon}</Text> : icon}
          </View>
        )}

        {/* Title (only show if not inline) */}
        {!isInline && (
          <Text weight="semibold" size="lg" color={colors.error} style={{ textAlign }}>
            {title}
          </Text>
        )}

        {/* Error message */}
        <Text color={isInline ? colors.error : colors.gray[700]} style={{ textAlign }}>
          {message}
        </Text>

        {/* Retry button */}
        {onRetry && (
          <View style={isCentered ? styles.centeredButton : undefined}>
            <Button variant="outline" size={isInline ? 'sm' : 'md'} onPress={onRetry}>
              {retryText}
            </Button>
          </View>
        )}
      </VStack>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    // Base styles
  },
  centeredContainer: {
    maxWidth: 400,
  },
  iconContainer: {
    // Base icon container
  },
  centeredIcon: {
    alignItems: 'center',
  },
  centeredButton: {
    marginTop: spacing[2], // 8px
  },
});
