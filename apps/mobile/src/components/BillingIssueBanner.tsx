import React, { useState } from 'react';
import { Linking } from 'react-native';

import { useTranslation } from '../hooks';
import HomeBanner from './HomeBanner';

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
    <HomeBanner
      variant="warning"
      icon="warning-outline"
      title={t('subscription.status_billing_issue')}
      description={t('subscription.billing_banner_description')}
      primaryAction={{ label: t('subscription.billing_banner_cta'), onPress: handleManage }}
      onDismiss={() => setDismissed(true)}
    />
  );
};

export default BillingIssueBanner;
