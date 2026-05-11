import React from 'react';
import { Linking } from 'react-native';

import { useTranslation } from '../hooks';
import HomeBanner from './HomeBanner';

interface BillingIssueBannerProps {
  onManagePress?: () => void;
  onDismiss: () => void;
}

const BillingIssueBanner: React.FC<BillingIssueBannerProps> = ({ onManagePress, onDismiss }) => {
  const { t } = useTranslation();

  const handleManage = () => {
    if (onManagePress) {
      onManagePress();
    } else {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    }
  };

  return (
    <HomeBanner
      variant="warning"
      icon="warning-outline"
      title={t('subscription.status_billing_issue')}
      description={t('subscription.billing_banner_description')}
      primaryAction={{ label: t('subscription.billing_banner_cta'), onPress: handleManage }}
      onDismiss={onDismiss}
    />
  );
};

export default BillingIssueBanner;
