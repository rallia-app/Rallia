/**
 * SummerLeagueAnnouncementSheet
 *
 * One-time announcement for the first Rallia Summer League. A single
 * "Count me in" tap records the player's interest (see ./api), then the sheet
 * swaps to a celebratory thank-you state.
 *
 * Presentational only — gating ("show once, after onboarding, not over the
 * weekly check-in") lives in SummerLeagueAnnouncementAutoOpener, which opens
 * this sheet via SheetManager.show('summer-league-announcement').
 *
 * Built on BaseActionSheet so it matches every other bottom sheet in the app
 * (handle indicator, rounded chrome, swipe/backdrop dismiss).
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, base, neutral } from '@rallia/design-system';
import { useAuth, usePlayer } from '@rallia/shared-hooks';
import { lightHaptic, mediumHaptic, successHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useSport } from '#/context';
import {
  summerLeagueInterestRegistered,
  summerLeagueAnnouncementDismissed,
} from '#/services/analytics';
import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SportIcon } from '#/components/SportIcon';

import { registerSummerLeagueInterest } from './api';

const SHEET_ID = 'summer-league-announcement';

// Warm "summer sunset" for the announcement; cool brand teal to celebrate.
const HERO_GRADIENT = ['#fbbf24', '#f59e0b', '#ed6a6d'] as const; // gold → amber → coral
const SUCCESS_GRADIENT = ['#2dd4bf', '#14b8a6', '#0d9488'] as const; // teal → deep teal

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function SummerLeagueAnnouncementActionSheet(
  _props: SheetProps<'summer-league-announcement'>
) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const playerId = player?.id ?? session?.user?.id ?? null;

  const [status, setStatus] = useState<Status>('idle');
  // Tracks the outcome so onSheetClose can tell a dismissal apart from a
  // successful opt-in (any close path — button, backdrop, swipe — runs it).
  const registeredRef = useRef(false);
  const isSuccess = status === 'success';

  // Dark-mode-aware theme mapping for the shared-components Button.
  const buttonThemeColors = {
    primary: colors.primary,
    primaryForeground: base.white,
    buttonActive: colors.primary,
    buttonInactive: isDark ? neutral[700] : neutral[300],
    buttonTextActive: base.white,
    buttonTextInactive: isDark ? neutral[400] : neutral[500],
    text: colors.textMuted,
    textMuted: colors.textMuted,
    border: colors.border,
    background: colors.cardBackground,
  };

  const handleInterested = useCallback(async () => {
    if (!playerId || status === 'submitting') return;
    void mediumHaptic();
    setStatus('submitting');

    const ok = await registerSummerLeagueInterest({ playerId, locale });

    if (ok) {
      void successHaptic();
      registeredRef.current = true;
      summerLeagueInterestRegistered();
      setStatus('success');
    } else {
      setStatus('error');
    }
  }, [playerId, status, locale]);

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide(SHEET_ID);
  }, []);

  // Runs after the sheet finishes closing via ANY path. If the player never
  // opted in, count it as a dismissal.
  const handleSheetClose = useCallback(() => {
    if (!registeredRef.current) {
      summerLeagueAnnouncementDismissed();
    }
  }, []);

  return (
    <BaseActionSheet onSheetClose={handleSheetClose} flex={false} hideHandle>
      <View>
        {/* ---- Hero band -------------------------------------------------- */}
        <LinearGradient
          colors={isSuccess ? SUCCESS_GRADIENT : HERO_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          {/* Playful translucent "confetti" blobs */}
          <View style={[styles.blob, styles.blobLg, styles.blobTopRight]} />
          <View style={[styles.blob, styles.blobMd, styles.blobBottomLeft]} />
          <View style={[styles.blob, styles.blobSm, styles.blobTopLeft]} />

          <View style={styles.heroIconRing}>
            <RNText style={styles.heroEmoji}>{isSuccess ? '🎉' : '🏆'}</RNText>
          </View>

          {!isSuccess && (
            <View style={styles.heroBadge}>
              <RNText style={styles.heroBadgeText}>
                {`☀️  ${t('summerLeague.announcement.badge').toUpperCase()}`}
              </RNText>
            </View>
          )}
        </LinearGradient>

        {/* ---- Body ------------------------------------------------------- */}
        <View style={styles.body}>
          {isSuccess ? (
            <>
              <Text size={24} weight="bold" align="center" color={colors.text} style={styles.title}>
                {t('summerLeague.announcement.successTitle')}
              </Text>
              <Text size="base" align="center" color={colors.textMuted} style={styles.subtitle}>
                {t('summerLeague.announcement.successBody')}
              </Text>
              <View style={styles.actions}>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  rounded
                  onPress={handleClose}
                  isDark={isDark}
                  themeColors={buttonThemeColors}
                >
                  {t('summerLeague.announcement.done')}
                </Button>
              </View>
            </>
          ) : (
            <>
              <Text size={25} weight="bold" align="center" color={colors.text} style={styles.title}>
                {t('summerLeague.announcement.title')}
              </Text>
              <Text size="base" align="center" color={colors.textMuted} style={styles.subtitle}>
                {t('summerLeague.announcement.subtitle')}
              </Text>

              {status === 'error' && (
                <Text size="sm" align="center" color={colors.error} style={styles.error}>
                  {t('summerLeague.announcement.error')}
                </Text>
              )}

              <View style={styles.actions}>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  rounded
                  loading={status === 'submitting'}
                  disabled={status === 'submitting'}
                  onPress={() => void handleInterested()}
                  isDark={isDark}
                  themeColors={buttonThemeColors}
                  leftIcon={
                    <SportIcon
                      sportName={selectedSport?.name ?? 'tennis'}
                      size={20}
                      color={base.white}
                    />
                  }
                >
                  {t('summerLeague.announcement.interested')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  fullWidth
                  disabled={status === 'submitting'}
                  onPress={handleClose}
                  isDark={isDark}
                  themeColors={buttonThemeColors}
                >
                  {t('summerLeague.announcement.later')}
                </Button>
              </View>
            </>
          )}
        </View>
      </View>
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  // Hero
  hero: {
    alignItems: 'center',
    paddingTop: spacingPixels[7],
    paddingBottom: spacingPixels[6],
    paddingHorizontal: spacingPixels[5],
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  blobLg: { width: 130, height: 130, borderRadius: 65 },
  blobMd: { width: 90, height: 90, borderRadius: 45 },
  blobSm: { width: 54, height: 54, borderRadius: 27 },
  blobTopRight: { top: -34, right: -24 },
  blobBottomLeft: { bottom: -38, left: -22 },
  blobTopLeft: { top: 18, left: 26, backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  heroIconRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 50,
    textAlign: 'center',
  },
  heroBadge: {
    marginTop: spacingPixels[4],
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#b45309', // accent[700] — warm amber on the white pill
  },
  // Body
  body: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[7],
    paddingTop: spacingPixels[5],
    paddingBottom: spacingPixels[6],
  },
  title: {
    marginBottom: spacingPixels[2],
    lineHeight: 32,
  },
  subtitle: {
    lineHeight: 22,
  },
  error: {
    marginTop: spacingPixels[4],
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: spacingPixels[6],
    gap: spacingPixels[2],
  },
});

export default SummerLeagueAnnouncementActionSheet;
