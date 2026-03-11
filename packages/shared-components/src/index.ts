/**
 * Shared Components - Barrel Export
 */

// Foundation Components
export { Button } from './foundation/Button.native';
export { Text } from './foundation/Text.native';
export { Heading } from './foundation/Heading.native';

export type { ButtonProps } from './foundation/Button.native';
export type { TextProps } from './foundation/Text.native';
export type { HeadingProps } from './foundation/Heading.native';

// Form Components
export { Input } from './forms/Input.native';
export { Select } from './forms/Select.native';

export type { InputProps } from './forms/Input.native';
export type { SelectProps, SelectOption } from './forms/Select.native';

// Layout Components
export { Container } from './layout/Container.native';
export { Stack, VStack, HStack } from './layout/Stack.native';
export { Card } from './layout/Card.native';
export { Divider } from './layout/Divider.native';
export { Spacer } from './layout/Spacer.native';

export type { ContainerProps } from './layout/Container.native';
export type { StackProps } from './layout/Stack.native';
export type { CardProps } from './layout/Card.native';
export type { DividerProps } from './layout/Divider.native';
export type { SpacerProps } from './layout/Spacer.native';

// Feedback Components
export { Spinner } from './feedback/Spinner.native';
export { ErrorMessage } from './feedback/ErrorMessage.native';
export { Badge } from './feedback/Badge.native';
export { ErrorBoundary } from './ErrorBoundary';
export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonList,
  SkeletonMatchCard,
  SkeletonPlayerCard,
  SkeletonConversation,
} from './feedback/Skeleton.native';
export { Toast, ToastProvider, useToast } from './feedback/Toast.native';
export {
  OfflineIndicator,
  NetworkProvider,
  useNetwork,
  useNetworkStatus,
} from './feedback/OfflineIndicator.native';

export type { SpinnerProps } from './feedback/Spinner.native';
export type { ErrorMessageProps } from './feedback/ErrorMessage.native';
export type { BadgeProps } from './feedback/Badge.native';
export type {
  SkeletonProps,
  SkeletonTextProps,
  SkeletonAvatarProps,
  SkeletonCardProps,
  SkeletonListProps,
  SkeletonMatchCardProps,
  SkeletonPlayerCardProps,
  SkeletonConversationProps,
} from './feedback/Skeleton.native';
export type { ToastProps, ToastType, ToastPosition } from './feedback/Toast.native';
export type { OfflineIndicatorProps, NetworkStatus } from './feedback/OfflineIndicator.native';

// Base Components
export { default as Overlay } from './Overlay.native';
export { default as MatchCard } from './MatchCard.native';
export { default as MyMatchCard } from './MyMatchCard.native';
export { default as AppHeader } from './AppHeader.native';
export { default as SettingsModal } from './SettingsModal.native';

export type { MatchCardProps } from './MatchCard.native';
export type { MyMatchCardProps } from './MyMatchCard.native';

// Header Components
export {
  ProfilePictureButton,
  NotificationButton,
  SettingsButton,
  HelpButton,
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

// Charts Components
export {
  SparklineChart,
  TimeRangeSelector,
  AnalyticsSectionCard,
  BarChart,
  LineChart,
  PieChart,
  FunnelChart,
} from './charts';
export type {
  SparklineChartProps,
  SparklineDataPoint,
  TimeRangeSelectorProps,
  TimeRange,
  AnalyticsSectionCardProps,
  BarChartProps,
  BarChartDataPoint,
  LineChartProps,
  LineChartDataPoint,
  PieChartProps,
  PieChartDataPoint,
  FunnelChartProps,
  FunnelChartDataPoint,
} from './charts';

// Theme
export { colors, typography, spacing } from './theme';
