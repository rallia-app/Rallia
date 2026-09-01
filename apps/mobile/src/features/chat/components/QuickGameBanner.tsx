/**
 * QuickGameBanner
 *
 * The pinned CTA at the top of a community chat. Members already post "anyone
 * for a game Thursday?" as plain text; this turns that same intent into a real
 * game others can join in one tap.
 *
 * The bar itself is ChatActionBanner, shared with the Match Organizer.
 */

import React from 'react';

import { useTranslation } from '#/hooks';

import { ChatActionBanner } from './ChatActionBanner';

interface QuickGameBannerProps {
  onPress: () => void;
}

export function QuickGameBanner({ onPress }: QuickGameBannerProps) {
  const { t } = useTranslation();

  return (
    <ChatActionBanner
      icon="flash"
      title={t('quickGame.banner.title')}
      subtitle={t('quickGame.banner.subtitle')}
      onPress={onPress}
      tone="primary"
    />
  );
}

export default QuickGameBanner;
