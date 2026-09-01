/**
 * MatchOrganizerBanner
 *
 * A prominent, pinned CTA bar at the top of a chat (below the header, above the
 * messages) that opens the Match Organizer. Shown only when organizing a game
 * is available in this chat (small direct/group chat or a tournament round chat
 * with no game created yet). Replaces the subtle calendar icon in the input.
 *
 * The bar itself is ChatActionBanner, shared with the pairing score entry.
 */

import React from 'react';

import { useTranslation } from '#/hooks';

import { ChatActionBanner } from './ChatActionBanner';

interface MatchOrganizerBannerProps {
  onPress: () => void;
}

export function MatchOrganizerBanner({ onPress }: MatchOrganizerBannerProps) {
  const { t } = useTranslation();

  return (
    <ChatActionBanner
      icon="calendar"
      title={t('matchOrganizer.banner.title')}
      subtitle={t('matchOrganizer.banner.subtitle')}
      onPress={onPress}
      tone="primary"
    />
  );
}

export default MatchOrganizerBanner;
