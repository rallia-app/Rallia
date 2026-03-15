/**
 * NotificationPreferencesScreen
 * Allows users to manage their notification preferences per type and channel.
 * Displays a grid of toggles organized by notification category.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useTheme, useNotificationPreferencesWithActions } from '@rallia/shared-hooks';
import { useAuth, useTranslation } from '../hooks';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  secondary,
  accent,
  status,
  neutral,
} from '@rallia/design-system';
import {
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_CATEGORIES,
  DELIVERY_CHANNEL_ICONS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type ExtendedNotificationTypeEnum,
  type DeliveryChannelEnum,
} from '@rallia/shared-types';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BASE_WHITE = '#ffffff';

// Only show notification types that are actually triggered in the app
const ACTIVE_NOTIFICATION_TYPES = new Set<ExtendedNotificationTypeEnum>([
  // Match lifecycle
  'match_invitation',
  'match_join_request',
  'match_join_accepted',
  'match_join_rejected',
  'match_player_joined',
  'match_cancelled',
  'match_updated',
  'match_starting_soon',
  'match_check_in_available',
  'match_new_available',
  'match_spot_opened',
  'nearby_match_available',
  'player_kicked',
  'player_left',
  // Feedback
  'feedback_request',
  'feedback_reminder',
  'score_confirmation',
  // Social
  'new_message',
  'rating_verified',
  // Reference requests
  'reference_request_received',
  'reference_request_accepted',
  'reference_request_declined',
] as ExtendedNotificationTypeEnum[]);

// Design-system colors for active notification types
// Teal (primary) = invitations/requests, Green (success) = positive outcomes,
// Red (secondary) = rejections/cancellations, Blue (info) = updates, Amber (accent) = warnings/reminders
const NOTIFICATION_DS_COLORS: Partial<Record<ExtendedNotificationTypeEnum, string>> = {
  match_invitation: primary[500],
  match_join_request: primary[500],
  match_join_accepted: status.success.light,
  match_join_rejected: secondary[500],
  match_player_joined: status.success.light,
  match_cancelled: secondary[500],
  match_updated: status.info.DEFAULT,
  match_starting_soon: accent[600],
  match_check_in_available: status.success.light,
  match_new_available: primary[500],
  match_spot_opened: status.success.light,
  nearby_match_available: status.info.DEFAULT,
  player_kicked: secondary[500],
  player_left: accent[600],
  feedback_request: accent[400],
  feedback_reminder: accent[600],
  score_confirmation: status.success.light,
  // Social
  new_message: primary[500],
  rating_verified: status.success.light,
  // Reference requests
  reference_request_received: primary[500],
  reference_request_accepted: status.success.light,
  reference_request_declined: secondary[500],
};

// Group notification types by category
function groupByCategory(): Record<NotificationCategory, ExtendedNotificationTypeEnum[]> {
  const groups: Record<NotificationCategory, ExtendedNotificationTypeEnum[]> = {
    match: [],
    social: [],
    system: [],
    organization: [], // Organization notifications are managed separately in the web dashboard
  };

  for (const [type, category] of Object.entries(NOTIFICATION_TYPE_CATEGORIES)) {
    if (ACTIVE_NOTIFICATION_TYPES.has(type as ExtendedNotificationTypeEnum)) {
      groups[category].push(type as ExtendedNotificationTypeEnum);
    }
  }

  return groups;
}

interface PreferenceToggleProps {
  enabled: boolean;
  isExplicit: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  color: string;
}

const PreferenceToggle: React.FC<PreferenceToggleProps> = ({
  enabled,
  onChange,
  disabled,
  color,
}) => {
  const [localValue, setLocalValue] = useState(enabled);
  const expectedValueRef = useRef(enabled);

  // Only sync from external when the external value differs from what we expect
  // This handles error rollbacks while ignoring optimistic update re-renders
  useEffect(() => {
    if (enabled !== expectedValueRef.current) {
      // External value changed unexpectedly (error rollback or external update)
      // Use setTimeout to avoid calling setState synchronously within effect
      setTimeout(() => {
        setLocalValue(enabled);
        expectedValueRef.current = enabled;
      }, 0);
    }
  }, [enabled]);

  const handleValueChange = useCallback(
    (value: boolean) => {
      lightHaptic();
      setLocalValue(value); // Update local state immediately for smooth animation
      expectedValueRef.current = value; // Track that we expect this value from server
      onChange(value); // Trigger the mutation
    },
    [onChange]
  );

  return (
    <Switch
      value={localValue}
      onValueChange={handleValueChange}
      disabled={disabled}
      trackColor={{ false: neutral[400], true: color }}
      thumbColor={BASE_WHITE}
    />
  );
};

interface NotificationTypeRowProps {
  notificationType: ExtendedNotificationTypeEnum;
  preferences: Record<string, { enabled: boolean; source: 'explicit' | 'default' }>;
  onToggle: (channel: DeliveryChannelEnum, enabled: boolean) => void;
  isUpdating: boolean;
  isDark: boolean;
  colors: ReturnType<typeof useColors>;
  typeLabel: string;
}

const NotificationTypeRow: React.FC<NotificationTypeRowProps> = ({
  notificationType,
  preferences,
  onToggle,
  isUpdating,
  colors,
  typeLabel,
}) => {
  const iconName = NOTIFICATION_TYPE_ICONS[notificationType];
  const iconColor = NOTIFICATION_DS_COLORS[notificationType] ?? neutral[500];
  const channels: DeliveryChannelEnum[] = ['push', 'email', 'sms'];

  return (
    <View style={[styles.typeRow, { borderBottomColor: colors.border }]}>
      <View style={styles.typeInfo}>
        <View style={[styles.typeIcon, { backgroundColor: `${iconColor}20` }]}>
          <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={18} color={iconColor} />
        </View>
        <Text
          size="sm"
          weight="medium"
          color={colors.text}
          style={styles.typeLabel}
          numberOfLines={2}
        >
          {typeLabel}
        </Text>
      </View>
      <View style={styles.togglesRow}>
        {channels.map(channel => {
          const pref = preferences[channel];
          const defaultValue =
            DEFAULT_NOTIFICATION_PREFERENCES[notificationType]?.[channel] ?? false;
          const enabled = pref?.enabled ?? defaultValue;
          const isExplicit = pref?.source === 'explicit';

          return (
            <View key={channel} style={styles.toggleCell}>
              <PreferenceToggle
                enabled={enabled}
                isExplicit={isExplicit}
                onChange={value => onToggle(channel, value)}
                disabled={isUpdating}
                color={iconColor}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
};

interface CategorySectionProps {
  category: NotificationCategory;
  types: ExtendedNotificationTypeEnum[];
  preferences: Record<string, Record<string, { enabled: boolean; source: 'explicit' | 'default' }>>;
  onToggle: (
    type: ExtendedNotificationTypeEnum,
    channel: DeliveryChannelEnum,
    enabled: boolean
  ) => void;
  isUpdating: boolean;
  isDark: boolean;
  colors: ReturnType<typeof useColors>;
  categoryLabel: string;
  channelLabels: Record<DeliveryChannelEnum, string>;
  typeLabels: Record<ExtendedNotificationTypeEnum, string>;
}

const CategorySection: React.FC<CategorySectionProps> = ({
  types,
  preferences,
  onToggle,
  isUpdating,
  isDark,
  colors,
  categoryLabel,
  channelLabels,
  typeLabels,
}) => {
  const channels: DeliveryChannelEnum[] = ['push', 'email', 'sms'];
  const [isExpanded, setIsExpanded] = useState(true);
  const rotateAnim = useMemo(() => new Animated.Value(1), []);

  const handleToggleExpand = useCallback(() => {
    lightHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded(!isExpanded);

    Animated.timing(rotateAnim, {
      toValue: isExpanded ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isExpanded, rotateAnim]);

  const chevronRotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={[styles.categorySection, { backgroundColor: colors.cardBackground }]}>
      <TouchableOpacity
        onPress={handleToggleExpand}
        activeOpacity={0.7}
        style={[styles.categoryHeader, !isExpanded && styles.categoryHeaderCollapsed]}
      >
        <Text size="base" weight="semibold" color={colors.text}>
          {categoryLabel}
        </Text>
        <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
          <Ionicons name="chevron-up" size={18} color={colors.textMuted} />
        </Animated.View>
      </TouchableOpacity>

      {isExpanded && (
        <>
          {/* Channel header labels */}
          <View style={[styles.channelHeaderRow, { borderBottomColor: colors.border }]}>
            <View style={styles.typeInfo} />
            <View style={styles.togglesRow}>
              {channels.map(channel => (
                <View key={channel} style={styles.toggleCell}>
                  <View style={styles.channelLabel}>
                    <Ionicons
                      name={DELIVERY_CHANNEL_ICONS[channel] as keyof typeof Ionicons.glyphMap}
                      size={14}
                      color={colors.textMuted}
                    />
                    <Text size="xs" color={colors.textMuted}>
                      {channelLabels[channel]}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Notification type rows */}
          {types.map(type => (
            <NotificationTypeRow
              key={type}
              notificationType={type}
              preferences={preferences[type] ?? {}}
              onToggle={(channel, enabled) => onToggle(type, channel, enabled)}
              isUpdating={isUpdating}
              isDark={isDark}
              colors={colors}
              typeLabel={typeLabels[type]}
            />
          ))}
        </>
      )}
    </View>
  );
};

function useColors() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  return useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextActive: BASE_WHITE,
      buttonInactive: themeColors.muted,
    }),
    [themeColors, isDark]
  );
}

const NotificationPreferencesScreen: React.FC = () => {
  const { session, isAuthenticated, loading: isLoadingAuth } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const colors = useColors();

  const userId = session?.user?.id;

  const {
    preferences,
    isLoading: isLoadingPreferences,
    setPreference,
    resetAll,
    isResetting,
  } = useNotificationPreferencesWithActions(userId);

  const categoryGroups = useMemo(() => groupByCategory(), []);

  // Translated labels
  const categoryLabels: Record<NotificationCategory, string> = useMemo(
    () => ({
      match: t('notifications.categories.match'),
      social: t('notifications.categories.social'),
      system: t('notifications.categories.system'),
      organization: t('notifications.categories.organization'),
    }),
    [t]
  );

  const channelLabels = useMemo(
    () => ({
      email: t('notifications.channels.email'),
      push: t('notifications.channels.push'),
      sms: t('notifications.channels.sms'),
    }),
    [t]
  );

  const typeLabels = useMemo(
    () =>
      ({
        // Match category
        match_invitation: t('notifications.types.match_invitation'),
        match_join_request: t('notifications.types.match_join_request'),
        match_join_accepted: t('notifications.types.match_join_accepted'),
        match_join_rejected: t('notifications.types.match_join_rejected'),
        match_player_joined: t('notifications.types.match_player_joined'),
        match_cancelled: t('notifications.types.match_cancelled'),
        match_updated: t('notifications.types.match_updated'),
        match_starting_soon: t('notifications.types.match_starting_soon'),
        match_check_in_available: t('notifications.types.match_check_in_available'),
        match_new_available: t('notifications.types.match_new_available'),
        match_spot_opened: t('notifications.types.match_spot_opened'),
        nearby_match_available: t('notifications.types.nearby_match_available'),
        player_kicked: t('notifications.types.player_kicked'),
        player_left: t('notifications.types.player_left'),
        feedback_request: t('notifications.types.feedback_request'),
        feedback_reminder: t('notifications.types.feedback_reminder'),
        score_confirmation: t('notifications.types.score_confirmation'),
        // Social category
        chat: t('notifications.types.chat'),
        new_message: t('notifications.types.new_message'),
        rating_verified: t('notifications.types.rating_verified'),
        // Reference request types
        reference_request_received: t('notifications.types.reference_request_received'),
        reference_request_accepted: t('notifications.types.reference_request_accepted'),
        reference_request_declined: t('notifications.types.reference_request_declined'),
        // System category
        reminder: t('notifications.types.reminder'),
        payment: t('notifications.types.payment'),
        support: t('notifications.types.support'),
        system: t('notifications.types.system'),
      }) as Record<ExtendedNotificationTypeEnum, string>,
    [t]
  );

  const handleToggle = useCallback(
    (type: ExtendedNotificationTypeEnum, channel: DeliveryChannelEnum, enabled: boolean) => {
      successHaptic();
      setPreference({ notificationType: type, channel, enabled });
    },
    [setPreference]
  );

  const handleResetAll = useCallback(() => {
    successHaptic();
    resetAll();
  }, [resetAll]);

  // Only disable toggles during reset (which affects all preferences)
  // Individual preference updates use optimistic updates so toggles stay enabled
  const isUpdating = isResetting;

  if (isLoadingAuth || isLoadingPreferences) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.emptyContainer}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.iconMuted} />
          <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
            {t('notifications.signInRequired')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Description */}
        <View style={styles.descriptionContainer}>
          <Text size="sm" color={colors.textMuted}>
            {t('settings.notificationsDescription')}
          </Text>
        </View>

        {/* Category sections */}
        {(['match', 'social', 'system'] as NotificationCategory[])
          .filter(category => categoryGroups[category].length > 0)
          .map(category => (
            <CategorySection
              key={category}
              category={category}
              types={categoryGroups[category]}
              preferences={preferences ?? {}}
              onToggle={handleToggle}
              isUpdating={isUpdating}
              isDark={isDark}
              colors={colors}
              categoryLabel={categoryLabels[category]}
              channelLabels={channelLabels}
              typeLabels={typeLabels}
            />
          ))}

        {/* Reset button */}
        <View style={styles.resetContainer}>
          <TouchableOpacity
            style={[styles.resetButton, { backgroundColor: colors.buttonInactive }]}
            onPress={handleResetAll}
            disabled={isResetting}
            activeOpacity={0.7}
          >
            {isResetting ? (
              <ActivityIndicator size="small" color={colors.buttonActive} />
            ) : (
              <>
                <Ionicons name="refresh-outline" size={18} color={colors.text} />
                <Text size="sm" weight="medium" color={colors.text}>
                  {t('common.resetToDefaults')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: spacingPixels[4],
  },
  descriptionContainer: {
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[4],
  },
  categorySection: {
    marginBottom: spacingPixels[4],
    marginHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  categoryHeaderCollapsed: {
    paddingBottom: spacingPixels[4],
  },
  channelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderBottomWidth: 1,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  typeInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeIcon: {
    width: spacingPixels[8],
    height: spacingPixels[8],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  typeLabel: {
    flex: 1,
    lineHeight: 18,
    minHeight: 36,
  },
  togglesRow: {
    flexDirection: 'row',
  },
  toggleCell: {
    width: spacingPixels[16],
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLabel: {
    alignItems: 'center',
    gap: spacingPixels[0.5],
  },
  resetContainer: {
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  bottomSpacer: {
    height: spacingPixels[10],
  },
});

export default NotificationPreferencesScreen;
