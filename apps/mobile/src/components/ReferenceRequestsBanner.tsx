import React from 'react';

import HomeBanner from './HomeBanner';

interface ReferenceRequestsBannerProps {
  count: number;
  onPress: () => void;
  /** Theme colors — accepted for backwards compatibility but no longer used. */
  colors?: unknown;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}

const ReferenceRequestsBanner: React.FC<ReferenceRequestsBannerProps> = ({ count, onPress, t }) => (
  <HomeBanner
    variant="info"
    icon="checkmark-circle-outline"
    title={t('referenceRequest.bannerTitle', { count })}
    description={t('referenceRequest.bannerDescription')}
    primaryAction={{ label: t('referenceRequest.reviewCta'), onPress }}
  />
);

export default ReferenceRequestsBanner;
