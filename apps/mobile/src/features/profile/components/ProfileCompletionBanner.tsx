import React, { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightHaptic } from '@rallia/shared-utils';
import type { CompletenessItem } from '@rallia/shared-hooks';

import HomeBanner from '#/components/HomeBanner';

const STORAGE_KEY_DISMISS_COUNT = '@rallia/profile-completion-banner-dismiss-count';
const STORAGE_KEY_COOLDOWN = '@rallia/profile-completion-banner-cooldown';
const MAX_DISMISSALS = 3;

/** Escalating cooldowns: 24h, 72h, then permanent */
const COOLDOWN_MS = [
  24 * 60 * 60 * 1000, // 24 hours
  72 * 60 * 60 * 1000, // 72 hours
];

/**
 * Visibility + dismissal state for the profile completion banner.
 * Lives outside the component so Home can decide whether to render the banner
 * at all — that keeps `bannerCards.length` accurate so the carousel/full-width
 * switch matches what the user actually sees.
 */
export function useProfileCompletionBannerVisibility(isComplete: boolean) {
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [countStr, cooldownStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_DISMISS_COUNT),
          AsyncStorage.getItem(STORAGE_KEY_COOLDOWN),
        ]);

        const dismissCount = countStr ? parseInt(countStr, 10) : 0;

        if (dismissCount >= MAX_DISMISSALS) {
          setVisible(false);
          setReady(true);
          return;
        }

        if (cooldownStr) {
          const cooldownUntil = parseInt(cooldownStr, 10);
          if (Date.now() < cooldownUntil) {
            setVisible(false);
            setReady(true);
            return;
          }
        }

        setVisible(true);
      } catch {
        setVisible(true);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (isComplete) {
      AsyncStorage.multiRemove([STORAGE_KEY_DISMISS_COUNT, STORAGE_KEY_COOLDOWN]).catch(() => {});
    }
  }, [isComplete]);

  const handleDismiss = useCallback(async () => {
    void lightHaptic();
    setVisible(false);
    try {
      const countStr = await AsyncStorage.getItem(STORAGE_KEY_DISMISS_COUNT);
      const dismissCount = countStr ? parseInt(countStr, 10) : 0;
      const newCount = dismissCount + 1;

      await AsyncStorage.setItem(STORAGE_KEY_DISMISS_COUNT, newCount.toString());

      if (newCount < MAX_DISMISSALS) {
        const cooldownMs = COOLDOWN_MS[Math.min(newCount - 1, COOLDOWN_MS.length - 1)];
        await AsyncStorage.setItem(STORAGE_KEY_COOLDOWN, (Date.now() + cooldownMs).toString());
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  return { visible, ready, handleDismiss };
}

interface ProfileCompletionBannerProps {
  percentage: number;
  nextAction: CompletenessItem;
  onAction: (item: CompletenessItem) => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, string | number | boolean>) => string;
}

const ProfileCompletionBanner: React.FC<ProfileCompletionBannerProps> = ({
  percentage,
  nextAction,
  onAction,
  onDismiss,
  t,
}) => (
  <HomeBanner
    variant="action"
    icon="person-circle-outline"
    title={t('profileCompletion.bannerTitle', { percentage })}
    description={t('profileCompletion.bannerDescription')}
    primaryAction={{
      label: t('profileCompletion.bannerCta'),
      onPress: () => {
        void lightHaptic();
        onAction(nextAction);
      },
    }}
    onDismiss={onDismiss}
  />
);

export default ProfileCompletionBanner;
