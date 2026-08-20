/**
 * Serie2AnnouncementScreen — one-time campaign interstitial: celebrates the
 * relevant Série 1 winner and pitches the viewer's ONE relevant Série 2 draw.
 *
 * Full-screen modal on the weekly check-in chassis (gradient canvas, close X,
 * footer CTA) but a single step: no pager, no progress dots. Presented once
 * per player by Serie2AnnouncementAutoOpener, which fetches the data, runs
 * the relevance ladder (serie2Relevance.ts) and passes the precomputed result
 * via route params, so the screen renders complete on first frame.
 *
 * Three variants: 'champion' (the viewer won their Série 1 draw), 'played'
 * (their draw's winner is named), 'generic' (they sat Série 1 out).
 *
 * The featured card and the primary CTA both push TournamentDetail on top
 * (back returns here); the ghost CTA dismisses and lands on the Compete hub,
 * switching the global sport to tennis first since that screen lists by
 * selected sport.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, Card } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, base, neutral, primary, accent } from '@rallia/design-system';
import { lightHaptic, mediumHaptic, formatPrice } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useSport } from '#/context';
// Direct imports: the barrel re-exports AppNavigator, which imports this
// screen — going through '#/navigation' here is a require cycle.
import { navigationRef } from '#/navigation/navigationRef';
import type { RootStackParamList } from '#/navigation/types';
import { useAppNavigation } from '#/navigation/hooks';
import {
  serie2AnnouncementViewed,
  serie2AnnouncementCtaPressed,
  serie2AnnouncementDrawPressed,
  serie2AnnouncementDismissed,
} from '#/services/analytics';

import { prizeAmountLabel } from '../prizeLabel';

import { drawLabel } from './serie2Relevance';

export function Serie2AnnouncementScreen() {
  const { colors, isDark } = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslation();
  const navigation = useAppNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Serie2Announcement'>>();
  const { variant = 'generic', myDrawLabel, championName, featured } = route.params ?? {};
  const { selectedSport, userSports, setSelectedSport } = useSport();

  // Tracks whether the close came from a CTA (featured card or footer
  // buttons), so the unmount cleanup can tell a plain dismissal apart — any
  // close path (X, swipe, hardware back) unmounts the screen.
  const ctaRef = useRef(false);

  // Route params are set once at navigate time, so this fires exactly once.
  useEffect(() => {
    serie2AnnouncementViewed(variant);
  }, [variant]);

  useEffect(() => {
    return () => {
      if (!ctaRef.current) serie2AnnouncementDismissed();
    };
  }, []);

  // Same canvas as the check-in wizard: warm light surface in day mode, soft
  // dark background at night.
  const gradientColors = isDark
    ? ([colors.background, colors.card] as const)
    : ([accent[50], primary[50]] as const);

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
  const goldFg = isDark ? accent[300] : accent[700];

  const switchToTennis = useCallback(async () => {
    if (selectedSport?.name !== 'tennis') {
      const tennis = userSports.find(s => s.name === 'tennis');
      if (tennis) await setSelectedSport(tennis);
    }
  }, [selectedSport?.name, userSports, setSelectedSport]);

  const handleRegister = useCallback(async () => {
    if (!featured) return;
    void mediumHaptic();
    ctaRef.current = true;
    serie2AnnouncementDrawPressed(featured.id);
    await switchToTennis();
    navigation.navigate('TournamentDetail', {
      tournamentId: featured.id,
      tournamentName: featured.name,
    });
  }, [featured, switchToTennis, navigation]);

  const handleSeeAll = useCallback(async () => {
    void mediumHaptic();
    ctaRef.current = true;
    serie2AnnouncementCtaPressed();
    await switchToTennis();
    navigation.goBack();
    if (navigationRef.isReady()) {
      navigationRef.navigate('Compete');
    }
  }, [switchToTennis, navigation]);

  const handleClose = useCallback(() => {
    void lightHaptic();
    navigation.goBack();
  }, [navigation]);

  const title = t(
    variant === 'champion' ? 'serie2Announcement.titleChampion' : 'serie2Announcement.title'
  );
  const subtitle =
    variant === 'champion'
      ? t('serie2Announcement.subtitleChampion').replace('{label}', myDrawLabel ?? '')
      : variant === 'played'
        ? t('serie2Announcement.subtitlePlayed')
            .replace('{label}', myDrawLabel ?? '')
            .replace('{name}', championName ?? '')
        : t('serie2Announcement.subtitleGeneric');

  const fee =
    featured && featured.entryFeeCents > 0
      ? formatPrice(featured.entryFeeCents, featured.currency ?? undefined, {
          locale,
          trimZeroCents: true,
        })
      : null;
  const prize = featured
    ? prizeAmountLabel(
        {
          prize_money_cents: featured.prizeMoneyCents,
          prize_is_prorated: featured.prizeIsProrated,
          prize_top_share_bps: featured.prizeTopShareBps,
          currency: featured.currency,
        },
        locale,
        t
      )
    : null;
  const deadline = featured?.registrationClosesAt
    ? t('serie2Announcement.deadline').replace(
        '{date}',
        new Date(featured.registrationClosesAt).toLocaleDateString(locale, {
          day: 'numeric',
          month: 'long',
        })
      )
    : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />

      {/* Top inset: iOS presents this as a card modal already below the status
          bar, so a small breathing gap; Android is full-screen, keep the real
          inset (same treatment as WeeklyCheckInScreen). */}
      <View style={{ height: Platform.OS === 'ios' ? spacingPixels[5] : insets.top }} />

      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroIconRing}>
          <RNText style={styles.heroEmoji}>🏆</RNText>
        </View>
        <View style={[styles.heroBadge, { backgroundColor: `${primary[500]}26` }]}>
          <RNText style={[styles.heroBadgeText, { color: isDark ? primary[300] : primary[700] }]}>
            {`✨  ${t('serie2Announcement.badge').toUpperCase()}`}
          </RNText>
        </View>

        <Text size={25} weight="bold" align="center" color={colors.text} style={styles.title}>
          {title}
        </Text>
        <Text size="base" align="center" color={colors.textMuted} style={styles.subtitle}>
          {subtitle}
        </Text>

        {featured && (
          <>
            <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionLabel}>
              {t('serie2Announcement.featuredTitle').toUpperCase()}
            </Text>
            <Card
              variant="outlined"
              onPress={() => void handleRegister()}
              backgroundColor={colors.cardBackground}
              borderRadius={radiusPixels.xl}
              padding={spacingPixels[4]}
              style={{ alignSelf: 'stretch', borderColor: colors.border }}
              testID="serie2-featured-draw"
            >
              <View style={styles.cardTop}>
                <View style={styles.cardTexts}>
                  <Text size="lg" weight="bold" color={colors.text}>
                    {drawLabel(featured.name)}
                  </Text>
                  {prize && (
                    <Text size="sm" weight="semibold" color={goldFg}>
                      {prize}
                    </Text>
                  )}
                </View>
                <View style={styles.cardRight}>
                  {fee && (
                    <Text size="base" weight="bold" color={colors.text}>
                      {fee}
                    </Text>
                  )}
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </View>
              {deadline && (
                <Text size="sm" color={colors.textMuted} style={styles.cardDeadline}>
                  {deadline}
                </Text>
              )}
            </Card>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacingPixels[3] }]}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          rounded
          onPress={() => void handleRegister()}
          isDark={isDark}
          themeColors={buttonThemeColors}
          leftIcon={<Ionicons name="trophy-outline" size={20} color={base.white} />}
        >
          {t('serie2Announcement.cta')}
        </Button>
        <Button
          variant="ghost"
          size="md"
          fullWidth
          onPress={() => void handleSeeAll()}
          isDark={isDark}
          themeColors={buttonThemeColors}
        >
          {t('serie2Announcement.seeAll')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacingPixels[4],
  },
  iconButton: {
    padding: spacingPixels[2],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
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
    paddingHorizontal: spacingPixels[3],
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  title: {
    paddingHorizontal: spacingPixels[3],
    marginTop: spacingPixels[5],
    marginBottom: spacingPixels[2],
    lineHeight: 32,
  },
  subtitle: {
    lineHeight: 22,
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    letterSpacing: 0.6,
    marginTop: spacingPixels[7],
    marginBottom: spacingPixels[2],
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  cardTexts: {
    flex: 1,
    gap: 2,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  cardDeadline: {
    marginTop: spacingPixels[3],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    gap: spacingPixels[2],
  },
});

export default Serie2AnnouncementScreen;
