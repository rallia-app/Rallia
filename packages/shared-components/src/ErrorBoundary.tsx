/**
 * ErrorBoundary Component
 *
 * React Error Boundary component that catches JavaScript errors anywhere in the component tree,
 * logs those errors, and displays a fallback UI instead of crashing the whole app.
 *
 * Features:
 * - Catches render errors in child components
 * - Logs errors to console (dev) and error tracking service (production)
 * - Displays user-friendly fallback UI
 * - Supports custom fallback components
 * - Provides retry functionality
 *
 * @example
 * ```tsx
 * import { ErrorBoundary } from '@rallia/shared-components';
 *
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 * ```
 *
 * @example Custom fallback
 * ```tsx
 * <ErrorBoundary fallback={<CustomErrorScreen />}>
 *   <FeatureComponent />
 * </ErrorBoundary>
 * ```
 */

import React, { Component, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './foundation/Text.native';
import { Heading } from './foundation/Heading.native';
import { Button } from './foundation/Button.native';
import { VStack } from './layout/Stack.native';

export interface ErrorBoundaryTranslations {
  title?: string;
  description?: string;
  tryAgain?: string;
  errorDetailsTitle?: string;
  errorMessage?: string;
  stackTrace?: string;
  componentStack?: string;
}

const defaultTranslations: Required<ErrorBoundaryTranslations> = {
  title: 'Oops! Something went wrong',
  description: "We're sorry for the inconvenience. The app encountered an unexpected error.",
  tryAgain: 'Try Again',
  errorDetailsTitle: 'Error Details (Development Only)',
  errorMessage: 'Error Message:',
  stackTrace: 'Stack Trace:',
  componentStack: 'Component Stack:',
};

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
  translations?: ErrorBoundaryTranslations;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Default fallback UI component displayed when an error occurs
 */
interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  onReset?: () => void;
  translations: Required<ErrorBoundaryTranslations>;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  onReset,
  translations: t,
}) => {
  const isDevelopment = __DEV__;

  return (
    <View style={styles.container}>
      <VStack spacing={24} align="center">
        <View style={styles.iconContainer}>
          <Text size="5xl">⚠️</Text>
        </View>

        <VStack spacing={8} align="center">
          <Heading level={2} align="center">
            {t.title}
          </Heading>
          <Text align="center" color="#666" size="base">
            {t.description}
          </Text>
        </VStack>

        {onReset && (
          <Button variant="primary" onPress={onReset}>
            {t.tryAgain}
          </Button>
        )}

        {isDevelopment && error && (
          <View style={styles.errorDetails}>
            <VStack spacing={12}>
              <Heading level={4} color="#D32F2F">
                {t.errorDetailsTitle}
              </Heading>

              <VStack spacing={8}>
                <Text weight="bold" size="sm" color="#666">
                  {t.errorMessage}
                </Text>
                <View style={styles.errorBox}>
                  <Text size="sm" color="#D32F2F">
                    {error.message}
                  </Text>
                </View>
              </VStack>

              {error.stack && (
                <VStack spacing={8}>
                  <Text weight="bold" size="sm" color="#666">
                    {t.stackTrace}
                  </Text>
                  <View style={styles.errorBox}>
                    <Text size="xs" color="#333">
                      {error.stack}
                    </Text>
                  </View>
                </VStack>
              )}

              {errorInfo?.componentStack && (
                <VStack spacing={8}>
                  <Text weight="bold" size="sm" color="#666">
                    {t.componentStack}
                  </Text>
                  <View style={styles.errorBox}>
                    <Text size="xs" color="#333">
                      {errorInfo.componentStack}
                    </Text>
                  </View>
                </VStack>
              )}
            </VStack>
          </View>
        )}

        {!isDevelopment && (
          <Text size="sm" color="#999" align="center">
            Error ID: {Date.now().toString(36)}
          </Text>
        )}
      </VStack>
    </View>
  );
};

/**
 * ErrorBoundary class component
 *
 * Note: Error boundaries must be class components as React doesn't yet support
 * error boundaries in functional components with hooks.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Update state so the next render will show the fallback UI
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Log error information when an error is caught
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console in development
    if (__DEV__) {
      console.error('🚨 Error Boundary caught an error:', error);
      console.error('Component Stack:', errorInfo.componentStack);
    }

    // Store error info in state for display
    this.setState({
      errorInfo,
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log to error tracking service in production
    if (!__DEV__) {
      this.logErrorToService(error, errorInfo);
    }
  }

  /**
   * Log error to external error tracking service (e.g., Sentry)
   */
  private logErrorToService(error: Error, errorInfo: React.ErrorInfo): void {
    // Import Logger dynamically to avoid circular dependencies
    // In production, this will be handled by the Logger service
    try {
      // In production environments, this should integrate with your error tracking service
      // For now, we log to console
      console.error('Error Boundary - Error:', error.message);
      console.error('Error Boundary - Stack:', error.stack);
      console.error('Error Boundary - Component Stack:', errorInfo.componentStack);

      // TODO: When Logger is available, use:
      // import { Logger } from '../../services/logger';
      // Logger.error('Error caught by ErrorBoundary', error, {
      //   componentStack: errorInfo.componentStack,
      //   errorBoundary: true,
      // });
    } catch (loggingError) {
      // Fallback if logging fails
      console.error('Failed to log error:', loggingError);
    }
  }

  /**
   * Reset the error boundary state and retry rendering
   */
  private handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Render custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Render default fallback
      const mergedTranslations = { ...defaultTranslations, ...this.props.translations };
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
          translations={mergedTranslations}
        />
      );
    }

    // Render children normally when no error
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  iconContainer: {
    marginBottom: 8,
  },
  errorDetails: {
    width: '100%',
    marginTop: 16,
    padding: 16,
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  errorBox: {
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#D32F2F',
  },
});

export default ErrorBoundary;
