import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, status as statusColors } from '@rallia/design-system';
import { useTranslation } from '../hooks';

interface BillingIssueBannerProps {
  onManagePress?: () => void;
}

const BillingIssueBanner: React.FC<BillingIssueBannerProps> = ({ onManagePress }) => {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleManage = () => {
    if (onManagePress) {
      onManagePress();
    } else {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Ionicons
          name="warning-outline"
          size={18}
          color={statusColors.warning.DEFAULT}
          style={styles.icon}
        />
        <Text size="sm" color={statusColors.warning.DEFAULT} style={styles.text} numberOfLines={2}>
          {t('subscription.billing_banner_title')}
        </Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity onPress={handleManage} style={styles.ctaButton}>
          <Text size="xs" weight="semibold" color={statusColors.warning.DEFAULT}>
            {t('subscription.billing_banner_cta')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setDismissed(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={16} color={statusColors.warning.DEFAULT} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    backgroundColor: `${statusColors.warning.DEFAULT}18`,
    borderWidth: 1,
    borderColor: `${statusColors.warning.DEFAULT}40`,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacingPixels[2],
  },
  icon: {
    marginRight: spacingPixels[2],
  },
  text: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  ctaButton: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
});

export default BillingIssueBanner;
