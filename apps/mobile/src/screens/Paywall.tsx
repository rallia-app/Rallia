import React, { useEffect } from 'react';
import { View, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import RevenueCatUI from 'react-native-purchases-ui';
import type { CustomerInfo } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { darkTheme, lightTheme } from '@rallia/design-system';
import { useAppNavigation } from '../navigation/hooks';
import {
  paywallViewed,
  paywallDismissed,
  subscriptionStarted,
  restorePurchasesSuccess,
} from '../services/analytics';
import { useTranslation } from '../hooks';

const Paywall: React.FC = () => {
  const navigation = useAppNavigation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;
  const { t } = useTranslation();

  useEffect(() => {
    paywallViewed();
  }, []);

  const handleDismiss = () => {
    paywallDismissed();
    navigation.goBack();
  };

  const handlePurchaseCompleted = ({ customerInfo }: { customerInfo: CustomerInfo }) => {
    const activeProductId = Object.keys(customerInfo.entitlements.active)[0] ?? 'unknown';
    subscriptionStarted({ product_id: activeProductId });
    navigation.goBack();
  };

  const handleRestoreCompleted = ({ customerInfo }: { customerInfo: CustomerInfo }) => {
    const hasActive = Object.keys(customerInfo.entitlements.active).length > 0;
    if (hasActive) {
      restorePurchasesSuccess();
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      edges={['top']}
    >
      {/* Close button */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={handleDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={24} color={themeColors.foreground} />
      </TouchableOpacity>

      {/* RevenueCat managed paywall */}
      <RevenueCatUI.Paywall
        style={styles.paywall}
        onPurchaseCompleted={handlePurchaseCompleted}
        onPurchaseCancelled={handleDismiss}
        onPurchaseError={() => {}}
        onRestoreCompleted={handleRestoreCompleted}
        onDismiss={handleDismiss}
      />

      {/* Required Apple links */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => Linking.openURL('https://rallia.ca/privacy')}>
          <Text size="xs" color={themeColors.mutedForeground}>
            {t('subscription.privacy_policy')}
          </Text>
        </TouchableOpacity>
        <Text size="xs" color={themeColors.mutedForeground}>
          {' · '}
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://rallia.ca/terms')}>
          <Text size="xs" color={themeColors.mutedForeground}>
            {t('subscription.terms_of_service')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paywall: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
});

export default Paywall;
