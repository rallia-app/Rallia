/**
 * MilestoneScreen — the 1000-player takeover: a thank-you, then the ask.
 *
 * Full-screen campaign modal chassis (gradient canvas, close X, footer
 * CTA) but two steps instead of one, so it borrows the check-in pager: both
 * steps sit side by side in a row two screens wide and a single translateX
 * slides between them.
 *
 * The split is deliberate. Step 1 carries no ask at all, so the thank-you
 * doesn't read as a set-up for the share button; step 2 does the asking once
 * the player has chosen to go there.
 *
 * The reward line comes from the active referral contest, so the prize wording
 * is admin-editable and the screen ships without knowing it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, Card, useToast, WizardProgressDots } from '@rallia/shared-components';
import { useAuth, useReferral } from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels, base, neutral, primary, accent } from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

import { useThemeStyles, useTranslation } from '#/hooks';
import { useAppNavigation } from '#/navigation/hooks';
import {
  milestoneViewed,
  milestoneStepViewed,
  milestoneShared,
  milestoneDismissed,
  invitationLinkGenerated,
} from '#/services/analytics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_STEPS = 2;

export function MilestoneScreen() {
  const { colors, isDark } = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslation();
  const navigation = useAppNavigation();
  const toast = useToast();
  const { session } = useAuth();
  const { code, referralLink, contest, stats } = useReferral(session?.user?.id, locale);

  const [step, setStep] = useState(1);

  // Tracks whether the player got as far as sharing, so the unmount cleanup
  // can tell a completed run apart from a drop-off. Every close path (X, swipe,
  // hardware back) unmounts the screen.
  const sharedRef = useRef(false);
  // Mirrored in an effect, not during render: the unmount cleanup below runs
  // with an empty dep list and would otherwise close over a stale step.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    milestoneViewed();
  }, []);

  useEffect(() => {
    return () => {
      if (!sharedRef.current) milestoneDismissed({ step: stepRef.current });
    };
  }, []);

  const slideAnim = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: -(step - 1) * SCREEN_WIDTH,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [step, slideAnim]);

  // Champion Gold ring at 18% fill / 45% border.
  const ringStyle = {
    backgroundColor: `${accent[400]}2E`,
    borderColor: `${accent[400]}73`,
  };

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

  const handleContinue = useCallback(() => {
    void mediumHaptic();
    milestoneStepViewed(2);
    setStep(2);
  }, []);

  const handleBack = useCallback(() => {
    void lightHaptic();
    setStep(1);
  }, []);

  const handleClose = useCallback(() => {
    void lightHaptic();
    navigation.goBack();
  }, [navigation]);

  const handleShare = useCallback(async () => {
    if (!referralLink) return;
    void mediumHaptic();
    try {
      const result = await Share.share({
        message: t('milestone1000.shareMessage').replace('{link}', referralLink),
        title: t('milestone1000.shareTitle'),
      });
      if (result.action === Share.sharedAction) {
        sharedRef.current = true;
        milestoneShared({ channel: 'share_sheet' });
        invitationLinkGenerated({ invitation_type: 'referral', channel: 'share_sheet' });
      }
    } catch (error) {
      if (error instanceof Error && error.message !== 'User did not share') {
        toast.error(t('common.error'));
      }
    }
  }, [referralLink, t, toast]);

  const handleCopyCode = useCallback(async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      sharedRef.current = true;
      milestoneShared({ channel: 'copy_code' });
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [code, toast, t]);

  const handleCopyLink = useCallback(async () => {
    if (!referralLink) return;
    try {
      await Clipboard.setStringAsync(referralLink);
      sharedRef.current = true;
      milestoneShared({ channel: 'copy_link' });
      invitationLinkGenerated({ invitation_type: 'referral', channel: 'copy_link' });
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [referralLink, toast, t]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />

      {/* iOS presents this as a card modal already below the status bar, so a
          small breathing gap; Android is full-screen, keep the real inset. */}
      <View style={{ height: Platform.OS === 'ios' ? spacingPixels[5] : insets.top }} />

      <View style={styles.headerRow}>
        <View style={styles.sideSlot}>
          {step > 1 && (
            <TouchableOpacity
              onPress={handleBack}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>

        <WizardProgressDots current={step} total={TOTAL_STEPS} />

        <View style={styles.sideSlot}>
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
      </View>

      <View style={styles.viewport}>
        <Animated.View
          style={[
            styles.pager,
            { width: SCREEN_WIDTH * TOTAL_STEPS, transform: [{ translateX: slideAnim }] },
          ]}
        >
          {/* Step 1 — gratitude. No ask of any kind on this step. */}
          <ScrollView
            style={{ width: SCREEN_WIDTH }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.heroIconRing, ringStyle]}>
              <RNText style={styles.heroEmoji}>🙌</RNText>
            </View>
            <View style={[styles.heroBadge, { backgroundColor: `${primary[500]}26` }]}>
              <RNText
                style={[styles.heroBadgeText, { color: isDark ? primary[300] : primary[700] }]}
              >
                {`✨  ${t('milestone1000.badge').toUpperCase()}`}
              </RNText>
            </View>

            <Text size={25} weight="bold" align="center" color={colors.text} style={styles.title}>
              {t('milestone1000.title')}
            </Text>
            <Text size="base" align="center" color={colors.textMuted} style={styles.body}>
              {t('milestone1000.body1')}
            </Text>
            <Text size="base" align="center" color={colors.textMuted} style={styles.body}>
              {t('milestone1000.body2')}
            </Text>
            <Text
              size="base"
              weight="semibold"
              align="center"
              color={colors.text}
              style={styles.body}
            >
              {t('milestone1000.body2b')}
            </Text>
            <Text size="base" align="center" color={colors.text} style={styles.body}>
              {t('milestone1000.body3')}
            </Text>
            <Text
              size="base"
              weight="semibold"
              align="center"
              color={colors.textMuted}
              style={styles.signature}
            >
              {t('milestone1000.signature')}
            </Text>
          </ScrollView>

          {/* Step 2 — the ask. */}
          <ScrollView
            style={{ width: SCREEN_WIDTH }}
            contentContainerStyle={styles.scrollContentSpread}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.stepGroup}>
              <View style={[styles.heroIconRing, ringStyle]}>
                <RNText style={styles.heroEmoji}>🎯</RNText>
              </View>

              <Text size={25} weight="bold" align="center" color={colors.text} style={styles.title}>
                {t('milestone1000.ctaTitle')}
              </Text>
              <Text size="base" align="center" color={colors.textMuted} style={styles.body}>
                {t('milestone1000.ctaSubtitle')}
              </Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text size={28} weight="bold" align="center" color={colors.text}>
                  {stats?.total_clicked ?? 0}
                </Text>
                <Text size="xs" weight="semibold" align="center" color={colors.textMuted}>
                  {t('referral.clicked').toUpperCase()}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.stat}>
                <Text size={28} weight="bold" align="center" color={colors.primary}>
                  {stats?.total_converted ?? 0}
                </Text>
                <Text size="xs" weight="semibold" align="center" color={colors.textMuted}>
                  {t('referral.signedUp').toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.stepGroup}>
              {contest?.prizeDescription && (
                <View style={[styles.prizePill, { backgroundColor: `${accent[500]}1F` }]}>
                  <Text size="sm" weight="semibold" color={isDark ? accent[300] : accent[700]}>
                    {t('milestone1000.prize').replace('{prize}', contest.prizeDescription)}
                  </Text>
                </View>
              )}

              {code && (
                <Card
                  variant="outlined"
                  onPress={() => void handleCopyCode()}
                  backgroundColor={colors.cardBackground}
                  borderRadius={radiusPixels.xl}
                  padding={spacingPixels[4]}
                  style={{ alignSelf: 'stretch', borderColor: colors.border }}
                >
                  <Text
                    size="xs"
                    weight="semibold"
                    align="center"
                    color={colors.textMuted}
                    style={styles.codeLabel}
                  >
                    {t('milestone1000.yourCode').toUpperCase()}
                  </Text>
                  <Text
                    size="xl"
                    weight="bold"
                    align="center"
                    color={colors.text}
                    style={styles.code}
                  >
                    {code}
                  </Text>
                  <Text size="xs" align="center" color={colors.primary} style={styles.copyHint}>
                    {t('milestone1000.copyCode')}
                  </Text>
                </Card>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacingPixels[3] }]}>
        {step === 1 ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            rounded
            onPress={handleContinue}
            isDark={isDark}
            themeColors={buttonThemeColors}
          >
            {t('milestone1000.continueCta')}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              rounded
              onPress={() => void handleShare()}
              isDark={isDark}
              themeColors={buttonThemeColors}
              leftIcon={<Ionicons name="share-social-outline" size={20} color={base.white} />}
            >
              {t('milestone1000.shareCta')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              onPress={() => void handleCopyLink()}
              isDark={isDark}
              themeColors={buttonThemeColors}
            >
              {t('milestone1000.copyLink')}
            </Button>
          </>
        )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
  },
  sideSlot: {
    width: 40,
    alignItems: 'center',
  },
  iconButton: {
    padding: spacingPixels[2],
  },
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  pager: {
    flex: 1,
    flexDirection: 'row',
  },
  scrollContent: {
    // Fill and centre: both steps are shorter than the viewport on most
    // devices, so without this the content stacks at the top and leaves a
    // dead band above the footer. Still scrolls normally when it overflows
    // (small screens, large text sizes).
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  heroIconRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1,
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
    marginBottom: spacingPixels[3],
    lineHeight: 32,
  },
  body: {
    lineHeight: 22,
    marginBottom: spacingPixels[3],
  },
  signature: {
    marginTop: spacingPixels[2],
  },
  prizePill: {
    marginTop: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: 999,
  },
  scrollContentSpread: {
    // Step 2 carries less copy than step 1, so centring still left it adrift.
    // Two groups pushed apart span the canvas instead.
    flexGrow: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[6],
    paddingBottom: spacingPixels[5],
  },
  stepGroup: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[5],
  },
  stat: {
    minWidth: 96,
    gap: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: spacingPixels[1],
  },
  codeLabel: {
    letterSpacing: 0.6,
  },
  code: {
    letterSpacing: 2,
    marginTop: spacingPixels[1],
  },
  copyHint: {
    marginTop: spacingPixels[2],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingTop: spacingPixels[3],
    gap: spacingPixels[2],
  },
});

export default MilestoneScreen;
