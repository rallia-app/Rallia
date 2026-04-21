import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';

import { useTranslation, type TranslationKey } from '../hooks';
import { isLaunched, LAUNCH_MS } from '../constants/beta';

interface LaunchCountdownBannerProps {
  isDark: boolean;
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function formatCountdown(
  diffMs: number,
  labels: { d: string; h: string; m: string; s: string }
): string | null {
  if (diffMs <= 0) return null;
  const totalSeconds = Math.floor(diffMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);

  if (days >= 1) {
    return `${days}${labels.d} ${pad(hours)}${labels.h} ${pad(minutes)}${labels.m}`;
  }
  if (hours >= 1) {
    return `${hours}${labels.h} ${pad(minutes)}${labels.m} ${pad(seconds)}${labels.s}`;
  }
  return `${minutes}${labels.m} ${pad(seconds)}${labels.s}`;
}

const LaunchCountdownBanner: React.FC<LaunchCountdownBannerProps> = ({ isDark }) => {
  const { t } = useTranslation();
  const [remainingMs, setRemainingMs] = useState(() => LAUNCH_MS - Date.now());

  useEffect(() => {
    if (isLaunched()) return;
    const id = setInterval(() => {
      const diff = LAUNCH_MS - Date.now();
      setRemainingMs(diff);
      if (diff <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (remainingMs <= 0) return null;

  const accentColor = isDark ? accent[400] : accent[500];
  const bgColor = `${accentColor}18`;
  const borderColor = `${accentColor}40`;
  const chipBg = `${accentColor}22`;

  const countdown = formatCountdown(remainingMs, {
    d: t('launch.days' as TranslationKey),
    h: t('launch.hours' as TranslationKey),
    m: t('launch.minutes' as TranslationKey),
    s: t('launch.seconds' as TranslationKey),
  });
  if (!countdown) return null;

  return (
    <View style={[styles.container, { backgroundColor: bgColor, borderColor }]}>
      <Ionicons name="rocket-outline" size={16} color={accentColor} />
      <Text size="sm" weight="semibold" color={accentColor} style={styles.title} numberOfLines={1}>
        {t('launch.mobileTitle' as TranslationKey)}
      </Text>
      <View style={[styles.chip, { backgroundColor: chipBg }]}>
        <Text size="xs" weight="bold" color={accentColor}>
          {countdown}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  title: {
    flex: 1,
  },
  chip: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
});

export default LaunchCountdownBanner;
