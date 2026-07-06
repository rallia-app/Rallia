/**
 * Shared Components - Barrel Export
 */

// Foundation Components
export { Button } from './foundation/Button';
export { Text } from './foundation/Text';
export { Heading } from './foundation/Heading';

export type { ButtonProps } from './foundation/Button';
export type { TextProps } from './foundation/Text';
export type { HeadingProps } from './foundation/Heading';

// Form Components
export { Input } from './forms/Input';
export { Select } from './forms/Select';

export type { InputProps } from './forms/Input';
export type { SelectProps, SelectOption } from './forms/Select';

// Layout Components
export { Container } from './layout/Container';
export { Stack, VStack, HStack } from './layout/Stack';
export { Card } from './layout/Card';
export { Divider } from './layout/Divider';
export { Spacer } from './layout/Spacer';

export type { ContainerProps } from './layout/Container';
export type { StackProps } from './layout/Stack';
export type { CardProps } from './layout/Card';
export type { DividerProps } from './layout/Divider';
export type { SpacerProps } from './layout/Spacer';

// Feedback Components
export { Spinner } from './feedback/Spinner';
export { ErrorMessage } from './feedback/ErrorMessage';
export { Badge } from './feedback/Badge';
export { ErrorBoundary } from './ErrorBoundary';
export type { ErrorBoundaryTranslations } from './ErrorBoundary';
export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonList,
  SkeletonMatchCard,
  SkeletonMyMatchCard,
  SkeletonPlayerCard,
  SkeletonConversation,
} from './feedback/Skeleton';
export { Toast, ToastProvider, ToastOverlay, useToast } from './feedback/Toast';
export {
  OfflineIndicator,
  NetworkProvider,
  useNetwork,
  useNetworkStatus,
} from './feedback/OfflineIndicator';

export type { SpinnerProps } from './feedback/Spinner';
export type { ErrorMessageProps } from './feedback/ErrorMessage';
export type { BadgeProps } from './feedback/Badge';
export type {
  SkeletonProps,
  SkeletonTextProps,
  SkeletonAvatarProps,
  SkeletonCardProps,
  SkeletonListProps,
  SkeletonMatchCardProps,
  SkeletonMyMatchCardProps,
  SkeletonPlayerCardProps,
  SkeletonConversationProps,
} from './feedback/Skeleton';
export type { ToastProps, ToastType, ToastPosition } from './feedback/Toast';
export type { OfflineIndicatorProps, NetworkStatus } from './feedback/OfflineIndicator';

// Base Components
export { default as Overlay } from './Overlay';
export { default as MatchCard } from './MatchCard';
export { default as MyMatchCard } from './MyMatchCard';
export { default as AppHeader } from './AppHeader';
export { default as SettingsModal } from './SettingsModal';

export type { MatchCardProps } from './MatchCard';
export type { MyMatchCardProps } from './MyMatchCard';

// Header Components
export {
  ProfilePictureButton,
  NotificationButton,
  SettingsButton,
  SportSelector,
  LocationSelector,
} from './headers';
export type { LocationSelectorProps, LocationMode } from './headers';

// Overlays
export { PermissionOverlay, LocationPermissionOverlay } from './overlays';

export type { PermissionType } from './overlays';

// Preferences Components
export { PreferencesChips } from './preferences';
export type { PreferencesChipsProps } from './preferences';

// Charts and analytics layout components are intentionally NOT re-exported
// here. They pull in `react-native-gifted-charts`, whose top-level module
// init has crashed on iOS 26 (Sentry REACT-NATIVE-6J). Keeping them on a
// subpath means non-admin bundles never evaluate the chart code at startup.
// Import from '@rallia/shared-components/src/charts' in admin screens.

// Theme
export { colors, typography, spacing } from './theme';
