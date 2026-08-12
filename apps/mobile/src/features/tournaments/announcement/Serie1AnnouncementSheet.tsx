/**
 * Serie1AnnouncementSheet
 *
 * One-time announcement for the Série 1 launch tournaments. Mirrors the
 * Summer League announcement sheet (same BaseActionSheet chrome, hero band,
 * icon ring) but wears the Série 1 banner aesthetic: deep-teal gradient and
 * one accent chip per category (teal / coral / gold).
 *
 * Presentational only — gating ("show once, tennis players, registration
 * actually open, never over the check-in wizard") lives in
 * Serie1AnnouncementAutoOpener, which opens this sheet via
 * SheetManager.show('serie1-announcement').
 *
 * The CTA switches the global sport to tennis when needed (the Tournaments
 * screen lists by selected sport) and then navigates there.
 */
import React, { useCallback, useRef } from 'react';
import { View, Text as RNText, StyleSheet } from 'react-native';
import { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { spacingPixels, base, neutral, primary, accent, secondary } from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useSport } from '#/context';
import { navigationRef } from '#/navigation';
import { serie1AnnouncementCtaPressed, serie1AnnouncementDismissed } from '#/services/analytics';
import { BaseActionSheet } from '#/components/BaseActionSheet';

const SHEET_ID = 'serie1-announcement';

// The Série 1 banner gradient (see the tournament banner artwork).
const HERO_GRADIENT = ['#021f1c', '#04332e', '#065f54'] as const;

export function Serie1AnnouncementActionSheet(_props: SheetProps<'serie1-announcement'>) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { selectedSport, userSports, setSelectedSport } = useSport();

  // Tracks whether the close came from the CTA, so onSheetClose can tell a
  // dismissal apart (any close path — backdrop, swipe — runs it).
  const ctaRef = useRef(false);

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

  // Category chips in the banner accents: teal / coral / gold. Tinted bg +
  // strong text so they read in both light and dark mode.
  const chips = [
    {
      label: t('serie1Announcement.catBeginner'),
      bg: `${primary[500]}26`,
      fg: isDark ? primary[300] : primary[700],
    },
    {
      label: t('serie1Announcement.catIntermediate'),
      bg: `${secondary[500]}26`,
      fg: isDark ? secondary[300] : secondary[600],
    },
    {
      label: t('serie1Announcement.catAdvanced'),
      bg: `${accent[500]}26`,
      fg: isDark ? accent[300] : accent[700],
    },
  ];

  const handleSeeTournaments = useCallback(async () => {
    void mediumHaptic();
    ctaRef.current = true;
    serie1AnnouncementCtaPressed();

    await SheetManager.hide(SHEET_ID);

    // The Tournaments screen lists by the global sport; Série 1 is tennis.
    if (selectedSport?.name !== 'tennis') {
      const tennis = userSports.find(s => s.name === 'tennis');
      if (tennis) await setSelectedSport(tennis);
    }
    if (navigationRef.isReady()) {
      navigationRef.navigate('Compete');
    }
  }, [selectedSport?.name, userSports, setSelectedSport]);

  const handleClose = useCallback(() => {
    void lightHaptic();
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleSheetClose = useCallback(() => {
    if (!ctaRef.current) {
      serie1AnnouncementDismissed();
    }
  }, []);

  return (
    <BaseActionSheet onSheetClose={handleSheetClose} flex={false} hideHandle>
      <View>
        {/* ---- Hero band: the Série 1 banner look ------------------------- */}
        <LinearGradient
          colors={HERO_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={[styles.blob, styles.blobLg, styles.blobTopRight]} />
          <View style={[styles.blob, styles.blobMd, styles.blobBottomLeft]} />
          <View style={[styles.blob, styles.blobSm, styles.blobTopLeft]} />

          <View style={styles.heroIconRing}>
            <RNText style={styles.heroEmoji}>🏆</RNText>
          </View>

          <View style={styles.heroBadge}>
            <RNText style={styles.heroBadgeText}>
              {`✨  ${t('serie1Announcement.badge').toUpperCase()}`}
            </RNText>
          </View>
        </LinearGradient>

        {/* ---- Body ------------------------------------------------------- */}
        <View style={styles.body}>
          <Text size={25} weight="bold" align="center" color={colors.text} style={styles.title}>
            {t('serie1Announcement.title')}
          </Text>
          <Text size="base" align="center" color={colors.textMuted} style={styles.subtitle}>
            {t('serie1Announcement.subtitle')}
          </Text>

          <View style={styles.chipRow}>
            {chips.map(chip => (
              <View key={chip.label} style={[styles.chip, { backgroundColor: chip.bg }]}>
                <Text size="xs" weight="semibold" color={chip.fg}>
                  {chip.label}
                </Text>
              </View>
            ))}
          </View>

          <Text size="sm" align="center" color={colors.textMuted}>
            {t('serie1Announcement.dates')}
          </Text>

          <View style={styles.actions}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              rounded
              onPress={() => void handleSeeTournaments()}
              isDark={isDark}
              themeColors={buttonThemeColors}
              leftIcon={<Ionicons name="trophy-outline" size={20} color={base.white} />}
            >
              {t('serie1Announcement.cta')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              onPress={handleClose}
              isDark={isDark}
              themeColors={buttonThemeColors}
            >
              {t('serie1Announcement.later')}
            </Button>
          </View>
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
    backgroundColor: 'rgba(94, 234, 212, 0.10)',
  },
  blobLg: { width: 130, height: 130, borderRadius: 65 },
  blobMd: { width: 90, height: 90, borderRadius: 45 },
  blobSm: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(94, 234, 212, 0.07)' },
  blobTopRight: { top: -34, right: -24 },
  blobBottomLeft: { bottom: -38, left: -22 },
  blobTopLeft: { top: 18, left: 26 },
  heroIconRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.45)',
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
    color: primary[700],
  },
  // Body
  body: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[7],
    paddingTop: spacingPixels[5],
    paddingBottom: spacingPixels[6],
  },
  title: {
    // Extra inset on the title only: it wraps earlier and more evenly, while
    // the stretched CTA buttons below keep the body's full width.
    paddingHorizontal: spacingPixels[3],
    marginBottom: spacingPixels[2],
    lineHeight: 32,
  },
  subtitle: {
    lineHeight: 22,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  chip: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: 999,
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: spacingPixels[6],
    gap: spacingPixels[2],
  },
});

export default Serie1AnnouncementActionSheet;
