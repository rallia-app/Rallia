/**
 * AdminAlertsScreen
 *
 * Displays admin alerts and notifications with management capabilities.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@rallia/shared-hooks';
import {
  spacingPixels,
  radiusPixels,
  lightTheme,
  darkTheme,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { useAdminAlerts } from '@rallia/shared-hooks';
import {
  alertService,
  supabase,
  type AdminAlert,
  type AlertSeverity,
} from '@rallia/shared-services';

// =============================================================================
// COMPONENT
// =============================================================================

const AdminAlertsScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      accent: isDark ? primary[500] : primary[600],
      success: status.success.DEFAULT,
      warning: status.warning.DEFAULT,
      error: status.error.DEFAULT,
    }),
    [isDark, themeColors]
  );

  // Get current user's admin ID
  const [adminId, setAdminId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAdminId = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('admin')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        setAdminId(data?.id || null);
      }
    };
    fetchAdminId();
  }, []);

  // Alerts data
  const { alerts, counts, isLoading, refetch, markAsRead, markAllAsRead, dismiss } = useAdminAlerts(
    {
      adminId: adminId || '',
      autoFetch: !!adminId,
      includeRead: true,
      limit: 50,
      pollingInterval: 60000, // Refresh every minute
    }
  );

  // Get severity color
  const getSeverityColor = (severity: AlertSeverity): string => {
    switch (severity) {
      case 'critical':
        return colors.error;
      case 'warning':
        return colors.warning;
      default:
        return colors.success;
    }
  };

  // Format time
  const formatTime = (dateString: string): string => {
    return alertService.formatAlertTime(dateString);
  };

  // Handle alert press
  const handleAlertPress = useCallback(
    async (alert: AdminAlert) => {
      if (!alert.is_read) {
        await markAsRead(alert.id);
      }

      // If there's an action URL, navigate to it
      if (alert.action_url) {
        // Handle navigation based on action_url
        // For now, just mark as read
      }
    },
    [markAsRead]
  );

  // Handle dismiss
  const handleDismiss = useCallback(
    (alert: AdminAlert) => {
      Alert.alert(t('admin.alerts.dismissTitle'), t('admin.alerts.dismissMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.dismiss'),
          style: 'destructive',
          onPress: () => dismiss(alert.id),
        },
      ]);
    },
    [dismiss, t]
  );

  // Handle mark all as read
  const handleMarkAllRead = useCallback(() => {
    Alert.alert(t('admin.alerts.markAllReadTitle'), t('admin.alerts.markAllReadMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: () => markAllAsRead(),
      },
    ]);
  }, [markAllAsRead, t]);

  // Render counts summary
  const renderCountsSummary = () => (
    <View
      style={[
        styles.countsCard,
        { backgroundColor: colors.cardBackground, borderColor: colors.border },
      ]}
    >
      <View style={styles.countsRow}>
        <View style={styles.countItem}>
          <View style={[styles.countBadge, { backgroundColor: `${colors.error}15` }]}>
            <Text style={[styles.countValue, { color: colors.error }]}>{counts.critical}</Text>
          </View>
          <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
            {t('admin.alerts.critical')}
          </Text>
        </View>
        <View style={styles.countItem}>
          <View style={[styles.countBadge, { backgroundColor: `${colors.warning}15` }]}>
            <Text style={[styles.countValue, { color: colors.warning }]}>{counts.warning}</Text>
          </View>
          <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
            {t('admin.alerts.warning')}
          </Text>
        </View>
        <View style={styles.countItem}>
          <View style={[styles.countBadge, { backgroundColor: `${colors.success}15` }]}>
            <Text style={[styles.countValue, { color: colors.success }]}>{counts.info}</Text>
          </View>
          <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
            {t('admin.alerts.info')}
          </Text>
        </View>
        <View style={styles.countItem}>
          <View style={[styles.countBadge, { backgroundColor: `${colors.accent}15` }]}>
            <Text style={[styles.countValue, { color: colors.accent }]}>{counts.total}</Text>
          </View>
          <Text style={[styles.countLabel, { color: colors.textSecondary }]}>
            {t('admin.alerts.unread')}
          </Text>
        </View>
      </View>
    </View>
  );

  // Render alert item
  const renderAlertItem = ({ item }: { item: AdminAlert }) => {
    const iconName = alertService.getAlertTypeIcon(item.alert_type);
    const severityColor = getSeverityColor(item.severity);

    return (
      <TouchableOpacity
        style={[
          styles.alertCard,
          {
            backgroundColor: item.is_read ? colors.background : colors.cardBackground,
            borderColor: colors.border,
            opacity: item.is_read ? 0.7 : 1,
          },
        ]}
        onPress={() => handleAlertPress(item)}
        onLongPress={() => handleDismiss(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.alertIcon, { backgroundColor: `${severityColor}15` }]}>
          <Ionicons name={iconName as never} size={24} color={severityColor} />
        </View>

        <View style={styles.alertContent}>
          <View style={styles.alertHeader}>
            <Text
              style={[
                styles.alertTitle,
                { color: colors.text, fontWeight: item.is_read ? '500' : '700' },
              ]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {!item.is_read && (
              <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />
            )}
          </View>

          <Text style={[styles.alertMessage, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.message}
          </Text>

          <View style={styles.alertMeta}>
            <View style={[styles.typeBadge, { backgroundColor: `${severityColor}10` }]}>
              <Text style={[styles.typeText, { color: severityColor }]}>
                {alertService.getAlertTypeLabel(item.alert_type)}
              </Text>
            </View>
            <Text style={[styles.alertTime, { color: colors.textMuted }]}>
              {formatTime(item.created_at)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.dismissButton}
          onPress={() => handleDismiss(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('admin.alerts.noAlerts')}</Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {t('admin.alerts.allClear')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.icon} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t('admin.alerts.title')}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>
            {t('admin.sections.notifications.description')}
          </Text>
        </View>
        <TouchableOpacity onPress={refetch} style={styles.refreshButton} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="refresh" size={24} color={colors.accent} />
          )}
        </TouchableOpacity>
      </View>

      {/* Mark all read button when alerts exist */}
      {counts.total > 0 && (
        <TouchableOpacity
          style={[
            styles.markAllButton,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onPress={handleMarkAllRead}
        >
          <Ionicons name="checkmark-done-outline" size={20} color={colors.accent} />
          <Text style={[styles.markAllText, { color: colors.accent }]}>
            {t('admin.alerts.markAllReadTitle')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Content */}
      <FlatList
        data={alerts}
        keyExtractor={item => item.id}
        renderItem={renderAlertItem}
        ListHeaderComponent={renderCountsSummary}
        ListEmptyComponent={!isLoading ? renderEmptyState : null}
        contentContainerStyle={[styles.listContent, alerts.length === 0 && styles.emptyContent]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  backButton: {
    padding: spacingPixels[2],
    marginRight: spacingPixels[3],
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  refreshButton: {
    padding: spacingPixels[2],
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  markAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: spacingPixels[4],
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
  },
  countsCard: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[4],
  },
  countsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  countItem: {
    alignItems: 'center',
  },
  countBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  countLabel: {
    fontSize: 11,
    marginTop: 4,
  },
  alertCard: {
    flexDirection: 'row',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  alertIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  alertContent: {
    flex: 1,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 15,
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: spacingPixels[2],
  },
  alertMessage: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacingPixels[2],
  },
  alertMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
    borderRadius: radiusPixels.sm,
  },
  typeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  alertTime: {
    fontSize: 11,
  },
  dismissButton: {
    padding: spacingPixels[2],
    marginLeft: spacingPixels[2],
  },
  separator: {
    height: spacingPixels[3],
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacingPixels[4],
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacingPixels[2],
  },
});

export default AdminAlertsScreen;
