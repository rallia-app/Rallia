import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import {
  darkTheme,
  lightTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status as statusColors,
} from '@rallia/design-system';
import { useSubscription } from '../context/SubscriptionContext';
import { useAppNavigation } from '../navigation/hooks';
import { useTranslation } from '../hooks';
import { PRO_ENTITLEMENT_ID } from '../lib/revenuecat';
import {
  restorePurchasesAttempted,
  restorePurchasesSuccess,
  restorePurchasesFailed,
} from '../services/analytics';

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

const SubscriptionManagement: React.FC = () => {
  const navigation = useAppNavigation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  const { t } = useTranslation();
  const toast = useToast();
  const { subscriptionStatus, customerInfo, isLoading, presentPaywall, restorePurchases } =
    useSubscription();

  const [isRestoring, setIsRestoring] = useState(false);

  const proEntitlement = customerInfo?.entitlements.active[PRO_ENTITLEMENT_ID];
  const allProEntitlement = customerInfo?.entitlements.all[PRO_ENTITLEMENT_ID];

  const renewalDate = proEntitlement?.expirationDate
    ? new Date(proEntitlement.expirationDate).toLocaleDateString()
    : null;

  const expirationDate = allProEntitlement?.expirationDate
    ? new Date(allProEntitlement.expirationDate).toLocaleDateString()
    : null;

  const colors = {
    background: themeColors.background,
    card: themeColors.card,
    text: themeColors.foreground,
    textMuted: themeColors.mutedForeground,
    border: themeColors.border,
    primary: isDark ? primary[400] : primary[600],
  };

  const handleManageSubscription = () => {
    Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    restorePurchasesAttempted();
    try {
      const restored = await restorePurchases();
      if (restored) {
        restorePurchasesSuccess();
        toast.success(t('subscription.restore_success'));
      } else {
        toast.info(t('subscription.restore_none'));
      }
    } catch {
      restorePurchasesFailed();
      toast.error(t('subscription.restore_none'));
    } finally {
      setIsRestoring(false);
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const badgeColor =
      status === 'active'
        ? statusColors.success.DEFAULT
        : status === 'cancelling'
          ? statusColors.warning.DEFAULT
          : status === 'billing_issue'
            ? statusColors.error.DEFAULT
            : colors.textMuted;

    const label =
      status === 'active'
        ? t('subscription.status_active')
        : status === 'cancelling'
          ? t('subscription.status_cancelling')
          : status === 'billing_issue'
            ? t('subscription.status_billing_issue')
            : status === 'expired'
              ? t('subscription.status_expired')
              : t('subscription.free_plan');

    return (
      <View
        style={[
          styles.badge,
          { backgroundColor: `${badgeColor}20`, borderColor: `${badgeColor}50` },
        ]}
      >
        <Text size="xs" weight="semibold" color={badgeColor}>
          {label}
        </Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isBillingIssue = subscriptionStatus === 'billing_issue';
  const isPaying = subscriptionStatus === 'active' || subscriptionStatus === 'cancelling';

  // Per-state card content — same layout, conditional copy/colors/CTA
  const description: string | null =
    subscriptionStatus === 'billing_issue'
      ? t('subscription.billing_banner_title')
      : isPaying
        ? t('subscription.manage_via_apple')
        : null;

  const dateLine: string | null =
    subscriptionStatus === 'cancelling' && renewalDate
      ? t('subscription.cancels_on', { date: renewalDate })
      : subscriptionStatus === 'active' && renewalDate
        ? t('subscription.renews_on', { date: renewalDate })
        : subscriptionStatus === 'expired' && expirationDate
          ? `${t('subscription.status_expired')} · ${expirationDate}`
          : null;

  const cta = isBillingIssue
    ? {
        label: t('subscription.billing_banner_cta'),
        icon: undefined as keyof typeof Ionicons.glyphMap | undefined,
        color: statusColors.error.DEFAULT,
        onPress: handleManageSubscription,
      }
    : isPaying
      ? {
          label: t('subscription.manage'),
          icon: 'settings-outline' as keyof typeof Ionicons.glyphMap,
          color: colors.primary,
          onPress: handleManageSubscription,
        }
      : {
          label: t('subscription.upgrade_cta'),
          icon: 'star-outline' as keyof typeof Ionicons.glyphMap,
          color: colors.primary,
          onPress: () => {
            navigation.goBack();
            presentPaywall();
          },
        };

  const cardBorderColor = isBillingIssue ? `${statusColors.error.DEFAULT}50` : colors.border;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: cardBorderColor }]}>
          <View style={styles.cardHeader}>
            <Text size="2xl" weight="bold" color={colors.text} style={styles.cardTitle}>
              Rallia Plus
            </Text>
            <StatusBadge status={subscriptionStatus} />
          </View>

          {description && (
            <Text size="sm" color={colors.textMuted}>
              {description}
            </Text>
          )}

          {dateLine && (
            <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
              <Text size="sm" color={colors.textMuted}>
                {dateLine}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: cta.color }]}
            onPress={cta.onPress}
            activeOpacity={0.8}
          >
            {cta.icon && <Ionicons name={cta.icon} size={16} color="#fff" />}
            <Text size="base" weight="semibold" color="#fff">
              {cta.label}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Restore purchases — always visible */}
        <View style={[styles.restoreSection, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={handleRestore}
            disabled={isRestoring}
            style={styles.restoreButton}
            activeOpacity={0.7}
          >
            {isRestoring ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text size="sm" color={colors.primary}>
                {t('subscription.restore')}
              </Text>
            )}
          </TouchableOpacity>

          <Text size="xs" color={colors.textMuted} style={styles.restoreNote}>
            {t('subscription.manage_via_apple')}
          </Text>
        </View>
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
  content: {
    padding: spacingPixels[5],
    gap: spacingPixels[4],
  },
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[5],
    gap: spacingPixels[3],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    lineHeight: 28,
    includeFontPadding: false,
  },
  badge: {
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
  },
  infoRow: {
    borderTopWidth: 1,
    paddingTop: spacingPixels[3],
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
  },
  restoreSection: {
    borderTopWidth: 1,
    paddingTop: spacingPixels[5],
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  restoreButton: {
    padding: spacingPixels[2],
    minHeight: 36,
    justifyContent: 'center',
  },
  restoreNote: {
    textAlign: 'center',
    maxWidth: 280,
  },
});

export default SubscriptionManagement;
