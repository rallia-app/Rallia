import React, { useCallback, useMemo } from 'react';
import {
  View,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useTheme, useMatch } from '@rallia/shared-hooks';
import { useAuth, useRequireOnboarding } from '../hooks';
import { useTranslation, type TranslationOptions } from '../hooks/useTranslation';
import type { TranslationKey } from '@rallia/shared-translations';
import { useActionsSheet, useMatchDetailSheet } from '../context';
import SignInPrompt from '../components/SignInPrompt';
import {
  Notification,
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_COLORS,
  ExtendedNotificationTypeEnum,
} from '@rallia/shared-types';
import { useNotificationsWithActions } from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  fontSizePixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';

/**
 * Match-related notification types that should open match detail sheet
 */
const MATCH_NOTIFICATION_TYPES: ExtendedNotificationTypeEnum[] = [
  'match_invitation',
  'match_join_request',
  'match_join_accepted',
  'match_join_rejected',
  'match_player_joined',
  'match_cancelled',
  'match_updated',
  'match_starting_soon',
  'match_completed',
  'match_new_available',
  'player_kicked',
  'player_left',
  'score_confirmation',
  'feedback_request',
  'feedback_reminder',
];

const BASE_WHITE = '#ffffff';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';

// Helper function to format relative time
function formatRelativeTime(
  dateString: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string,
  locale: string
): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return t('notifications.time.justNow');
  } else if (diffMin < 60) {
    return t('notifications.timeAgo', { time: `${diffMin}m` });
  } else if (diffHour < 24) {
    return t('notifications.timeAgo', { time: `${diffHour}h` });
  } else if (diffDay < 7) {
    return t('notifications.timeAgo', { time: `${diffDay}d` });
  } else {
    return date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
    });
  }
}

// Helper function to get date section key
function getDateSectionKey(
  dateString: string,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly.getTime() >= today.getTime()) {
    return t('notifications.time.today');
  } else if (dateOnly.getTime() >= yesterday.getTime()) {
    return t('notifications.time.yesterday');
  } else if (dateOnly.getTime() >= thisWeekStart.getTime()) {
    return t('notifications.time.thisWeek');
  } else {
    return t('notifications.time.earlier');
  }
}

// Group notifications by date
function groupNotificationsByDate(
  notifications: Notification[],
  t: (key: TranslationKey, options?: TranslationOptions) => string
): { title: string; data: Notification[] }[] {
  const groups: Record<string, Notification[]> = {};
  const order = [
    t('notifications.time.today'),
    t('notifications.time.yesterday'),
    t('notifications.time.thisWeek'),
    t('notifications.time.earlier'),
  ];

  notifications.forEach(notification => {
    const key = getDateSectionKey(notification.created_at, t);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(notification);
  });

  return order
    .filter(key => groups[key]?.length > 0)
    .map(key => ({ title: key, data: groups[key] }));
}

// Helper function to get notification title with fallback to translations
function getNotificationTitle(
  notification: Notification,
  t: (key: TranslationKey, options?: TranslationOptions) => string
): string {
  // If title exists and is not empty, use it
  if (notification.title && notification.title.trim().length > 0) {
    return notification.title;
  }

  // Fallback to translation key for message title
  const messageTitleKey = `notifications.messages.${notification.type}.title` as TranslationKey;
  const messageTitle = t(messageTitleKey, notification.payload as Record<string, string | number>);

  // If translation was found (not the same as key), use it
  if (messageTitle !== messageTitleKey && messageTitle.trim().length > 0) {
    return messageTitle;
  }

  // Final fallback to type label
  const typeLabelKey = `notifications.types.${notification.type}` as TranslationKey;
  const typeLabel = t(typeLabelKey);

  // If type label was found, use it; otherwise return a default
  if (typeLabel !== typeLabelKey && typeLabel.trim().length > 0) {
    return typeLabel;
  }

  // Ultimate fallback
  return notification.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Notification card component
interface NotificationCardProps {
  notification: Notification;
  onPress: () => void;
  onDelete: () => void;
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  locale: string;
}

const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  onPress,
  onDelete,
  isDark,
  t,
  locale,
}) => {
  const isUnread = !notification.read_at;
  const notificationType = notification.type;
  const iconName = NOTIFICATION_TYPE_ICONS[notificationType] ?? 'notifications-outline';
  const iconColor = NOTIFICATION_TYPE_COLORS[notificationType] ?? primary[500];
  const notificationTitle = getNotificationTitle(notification, t);

  const themeColors = isDark ? darkTheme : lightTheme;
  const cardColors = {
    background: isUnread ? themeColors.card : themeColors.muted,
    text: themeColors.foreground,
    textSecondary: themeColors.mutedForeground,
    iconMuted: themeColors.mutedForeground,
    border: themeColors.border,
  };

  const handlePress = () => {
    lightHaptic();
    onPress();
  };

  const handleDelete = () => {
    warningHaptic();
    onDelete();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.9}
      style={[
        styles.card,
        {
          backgroundColor: cardColors.background,
          borderColor: isUnread ? iconColor : cardColors.border,
          borderLeftWidth: isUnread ? 8 : 1,
          opacity: isUnread ? 1 : 0.8,
        },
      ]}
    >
      <View style={styles.cardContent}>
        {/* Icon */}
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: `${iconColor}${isUnread ? '30' : '15'}` },
          ]}
        >
          <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={20} color={iconColor} />
        </View>

        {/* Content */}
        <View style={styles.contentContainer}>
          <View style={styles.contentHeader}>
            {/* Unread indicator */}
            {isUnread && <View style={[styles.unreadIndicator, { backgroundColor: iconColor }]} />}
            <Text
              size="base"
              weight={isUnread ? 'semibold' : 'regular'}
              color={isUnread ? cardColors.text : cardColors.textSecondary}
              numberOfLines={1}
            >
              {notificationTitle}
            </Text>
          </View>
          {notification.body && (
            <Text
              size="sm"
              color={cardColors.textSecondary}
              numberOfLines={3}
              style={styles.bodyText}
            >
              {notification.body}
            </Text>
          )}
          <Text size="xs" color={cardColors.textSecondary} style={styles.timeText}>
            {formatRelativeTime(notification.created_at, t, locale)}
          </Text>
        </View>

        {/* Delete action */}
        <TouchableOpacity
          onPress={e => {
            e.stopPropagation();
            handleDelete();
          }}
          style={styles.actionButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={20} color={primary[500]} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const Notifications: React.FC = () => {
  const { session, isAuthenticated, loading: isLoadingAuth } = useAuth();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { openSheet } = useActionsSheet();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { isReady: isOnboarded } = useRequireOnboarding();
  const isDark = theme === 'dark';

  // State for handling match detail opening
  const [selectedMatchId, setSelectedMatchId] = React.useState<string | null>(null);

  // Fetch match data when a match notification is tapped
  const { match: selectedMatch, isLoading: isLoadingMatch } = useMatch(
    selectedMatchId ?? undefined,
    { enabled: !!selectedMatchId }
  );

  // Open match detail sheet when match data is loaded
  React.useEffect(() => {
    if (selectedMatch && !isLoadingMatch && selectedMatchId) {
      Logger.logUserAction('notification_match_opened', { matchId: selectedMatchId });
      openMatchDetail(selectedMatch);
      // Clear the selected match ID after opening
      setSelectedMatchId(null);
    }
  }, [selectedMatch, isLoadingMatch, selectedMatchId, openMatchDetail]);

  // Theme-aware colors from design system
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextActive: BASE_WHITE,
      border: themeColors.border,
    }),
    [themeColors, isDark]
  );

  const userId = session?.user?.id;

  const {
    notifications,
    isLoading: isLoadingNotifications,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isMarkingAllAsRead,
  } = useNotificationsWithActions(userId);

  // Group notifications by date
  const sections = useMemo(() => groupNotificationsByDate(notifications, t), [notifications, t]);

  const handleNotificationPress = useCallback(
    (notification: Notification) => {
      // Mark as read when pressed
      if (!notification.read_at) {
        successHaptic();
        markAsRead(notification.id);
      }

      // Navigate to target based on notification type and target_id
      if (notification.target_id && notification.type) {
        const isMatchNotification = MATCH_NOTIFICATION_TYPES.includes(
          notification.type as ExtendedNotificationTypeEnum
        );

        if (isMatchNotification) {
          // Set the selected match ID to trigger match detail fetch and sheet opening
          Logger.logUserAction('notification_match_tapped', {
            notificationId: notification.id,
            matchId: notification.target_id,
            type: notification.type,
          });
          setSelectedMatchId(notification.target_id);
        }

        // TODO: Handle other notification types (messages, friend requests, etc.)
      }
    },
    [markAsRead]
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderNotificationCard = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationCard
        notification={item}
        onPress={() => handleNotificationPress(item)}
        onDelete={() => deleteNotification(item.id)}
        isDark={isDark}
        t={t}
        locale={locale}
      />
    ),
    [handleNotificationPress, deleteNotification, isDark, t, locale]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
        <Text size="sm" weight="semibold" color={colors.textMuted}>
          {section.title}
        </Text>
      </View>
    ),
    [colors]
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="notifications-off-outline" size={64} color={colors.iconMuted} />
      <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
        {t('notifications.empty')}
      </Text>
      <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
        {t('notifications.emptyDescription')}
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.buttonActive} />
      </View>
    );
  };

  const renderHeader = () => {
    if (unreadCount === 0) return null;
    return (
      <View style={styles.headerContainer}>
        <Text size="sm" color={colors.textMuted}>
          {unreadCount} {t('notifications.unread')}
        </Text>
        <TouchableOpacity
          onPress={() => {
            successHaptic();
            markAllAsRead();
          }}
          disabled={isMarkingAllAsRead}
          style={styles.markAllButton}
        >
          {isMarkingAllAsRead ? (
            <ActivityIndicator size="small" color={colors.buttonActive} />
          ) : (
            <>
              <Ionicons name="checkmark-done-outline" size={16} color={colors.buttonActive} />
              <Text size="sm" color={colors.buttonActive} style={styles.markAllText}>
                {t('notifications.markAllRead')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated && !isLoadingAuth) {
    return (
      <SignInPrompt
        variant="notifications"
        title={t('notifications.signInRequired')}
        description={t('notifications.signInPrompt')}
        buttonText={t('auth.signIn')}
        onSignIn={openSheet}
      />
    );
  }

  // Show onboarding prompt if authenticated but not onboarded
  if (!isOnboarded && !isLoadingAuth) {
    return (
      <SignInPrompt
        variant="notifications"
        title={t('notifications.onboardingRequired')}
        description={t('notifications.onboardingPrompt')}
        buttonText={t('notifications.completeOnboarding')}
        onSignIn={openSheet}
        icon="person-add"
      />
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {isLoadingAuth ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
        </View>
      ) : isLoadingNotifications ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.buttonActive} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderNotificationCard}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.listContent,
            sections.length === 0 && styles.emptyListContent,
          ]}
          ListHeaderComponent={sections.length > 0 ? renderHeader : null}
          ListEmptyComponent={renderEmptyState}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isFetchingNextPage}
              onRefresh={refetch}
              tintColor={colors.buttonActive}
              colors={[colors.buttonActive]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
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
  listContent: {
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[5],
    flexGrow: 1,
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  contentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 'auto',
    gap: spacingPixels[2],
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  markAllText: {
    marginLeft: spacingPixels[1],
  },
  card: {
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  unreadIndicator: {
    width: spacingPixels[2],
    height: spacingPixels[2],
    borderRadius: radiusPixels.DEFAULT,
  },
  iconContainer: {
    width: spacingPixels[10],
    height: spacingPixels[10],
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  contentContainer: {
    flex: 1,
  },
  bodyText: {
    marginTop: spacingPixels[0.5],
  },
  timeText: {
    marginTop: spacingPixels[1],
  },
  actionButton: {
    padding: spacingPixels[2],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[8],
    paddingVertical: spacingPixels[14],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[2],
  },
  emptyDescription: {
    textAlign: 'center',
    lineHeight: fontSizePixels.sm * 1.5,
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
});

export default Notifications;
