/**
 * WeeklyCheckInScreen — root modal for the weekly check-in wizard.
 *
 * Full-screen layout modeled on PreOnboardingScreen.tsx:
 *   * Background: cream → pale-teal vertical gradient (no decorative blobs)
 *   * Pager: 4 steps side-by-side in a row that's SCREEN_WIDTH × 4 wide,
 *     translateX driven by a single Animated.timing (280ms cubic-out, native driver)
 *   * Header: back chevron (steps 2-4) + progress dots + discrete ×
 *   * Footer: each step manages its own CTA
 *
 * Exit affordance — the × in the header opens an inline confirmation prompt.
 * Confirm sets the AsyncStorage cooldown (shared with the Home banner) and
 * calls the route's dismiss callback. Cancel just closes the prompt.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetManager } from 'react-native-actions-sheet';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import {
  accent,
  base,
  primary,
  radiusPixels,
  shadowsSemanticNative,
  spacingPixels,
} from '@rallia/design-system';

import { WizardHeader } from './components/WizardHeader';
import { WelcomeRecapStep } from './steps/WelcomeRecapStep';
import { AvailabilityStep } from './steps/AvailabilityStep';
import { FrequencyAutoStep } from './steps/FrequencyAutoStep';
import { AllSetStep } from './steps/AllSetStep';
import { useWeeklyCheckInWizard, type WizardStep } from './useWeeklyCheckInWizard';
import { useTranslation } from '../../hooks';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function WeeklyCheckInScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const insets = useSafeAreaInsets();

  const dismissModal = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const wizard = useWeeklyCheckInWizard({
    onDismiss: dismissModal,
  });

  // Warm light surface in day mode (accent-50 → primary-50, both from the
  // design-system palette); soft dark theme background in night mode.
  // We keep a 2-stop gradient on both so the canvas doesn't feel chromeless.
  const gradientColors = isDark
    ? ([colors.background, colors.card] as const)
    : ([accent[50], primary[50]] as const);

  // On mount, defensively dismiss any currently-presenting bottom sheet so
  // the wizard owns the screen. The wizard then takes precedence — other
  // auto-openers (DeepLinkHandler, PendingFeedbackHandler) consult
  // isWeeklyCheckInActive() before raising a competing surface.
  useEffect(() => {
    SheetManager.hideAll();
  }, []);

  // Slide pager — single translateX animation across all 4 steps.
  const slideAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: -(wizard.currentStep - 1) * SCREEN_WIDTH,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [wizard.currentStep, slideAnim]);

  // CTA → submit transition between steps 3 and 4.
  // Fire mediumHaptic immediately on press so the tap feels responsive — the
  // submit() call ultimately fires successHaptic on success or errorHaptic on
  // failure, but those land ~1-2s later after the RPC roundtrip.
  const handleStep3Submit = useCallback(async () => {
    mediumHaptic();
    try {
      await wizard.submit();
      // submit() advances to step 4 internally; the slide animation runs from
      // the useEffect above via currentStep dependency change.
    } catch {
      // Errors are logged + errorHaptic'd inside submit(); ignore here so the
      // wizard stays on step 3 for the user to retry.
    }
  }, [wizard]);

  const handleDone = useCallback(() => {
    lightHaptic();
    dismissModal();
  }, [dismissModal]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Gradient extends edge-to-edge underneath the safe-area padding. */}
      <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />

      {/* Top safe-area inset — matches PreOnboardingScreen pattern. */}
      <View style={{ height: insets.top }} />

      <WizardHeader
        currentStep={wizard.currentStep}
        totalSteps={wizard.totalSteps}
        showBack={wizard.currentStep > 1 && wizard.currentStep < 4}
        onBack={wizard.goBack}
        onRequestExit={wizard.requestExit}
      />

      <Animated.View
        style={[
          styles.pager,
          {
            width: SCREEN_WIDTH * 4,
            // Bottom safe-area inset keeps the CTA above the Android nav bar
            // / iOS home indicator. Each step's footer adds its own additional
            // breathing room on top of this.
            marginBottom: insets.bottom,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        <StepSlot>
          {wizard.context ? (
            <WelcomeRecapStep context={wizard.context} onContinue={wizard.goNext} />
          ) : (
            <View style={styles.loading}>
              {wizard.contextError ? (
                <>
                  <Text style={[styles.errorTitle, { color: colors.text }]}>
                    Failed to load check-in
                  </Text>
                  <Text style={[styles.errorMsg, { color: colors.textMuted }]}>
                    {wizard.contextError.message}
                  </Text>
                </>
              ) : (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingHint, { color: colors.textMuted }]}>
                    Loading{wizard.isContextLoading ? '…' : ' (idle?)'}
                  </Text>
                </>
              )}
            </View>
          )}
        </StepSlot>

        <StepSlot>
          <AvailabilityStep
            availability={wizard.availability}
            onChange={wizard.setAvailability}
            onContinue={wizard.goNext}
          />
        </StepSlot>

        <StepSlot>
          <FrequencyAutoStep
            frequencyGoal={wizard.frequencyGoal}
            setFrequencyGoal={wizard.setFrequencyGoal}
            previousGoal={
              wizard.context?.lastFrequencyGoal ?? wizard.context?.lastWeekFrequencyGoal ?? null
            }
            autoCreate={wizard.autoCreate}
            setAutoCreate={wizard.setAutoCreate}
            autoInvite={wizard.autoInvite}
            setAutoInvite={wizard.setAutoInvite}
            isSubmitting={wizard.isSubmitting}
            onSubmit={handleStep3Submit}
          />
        </StepSlot>

        <StepSlot>
          {wizard.result && (
            <AllSetStep
              result={wizard.result}
              // First-ever check-in iff both the new streak AND the longest-
              // ever streak are 1. After a broken streak the player's
              // longest_streak is preserved (e.g. 5), so re-starting reads as
              // streak=1, longest=5 — not first-ever. Only a brand-new player
              // satisfies both === 1.
              isFirstEver={wizard.result.newStreak === 1 && wizard.result.longestStreak === 1}
              frequencyGoal={wizard.frequencyGoal}
              hoursConfirmed={wizard.availability.size}
              autoCreate={wizard.autoCreate}
              autoInvite={wizard.autoInvite}
              onDone={handleDone}
            />
          )}
        </StepSlot>
      </Animated.View>

      <ExitPrompt
        visible={wizard.exitPromptVisible}
        onConfirm={wizard.confirmExit}
        onCancel={wizard.cancelExit}
        colors={colors}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

function StepSlot({ children }: { children: React.ReactNode }) {
  return <View style={{ width: SCREEN_WIDTH, height: '100%' }}>{children}</View>;
}

/**
 * ExitPrompt — "Are you sure?" overlay.
 *
 * Implemented as a plain absolute-positioned overlay (NOT React Native's
 * <Modal>). RN's Modal nested inside a `fullScreenModal` navigation route
 * has a known bug where its native view can stick around after dismissal,
 * blocking all touches on the underlying screen. A plain View unmounts
 * cleanly when `visible` flips to false.
 *
 * Returns null when not visible so the entire subtree (including its
 * pressables and layout) is gone — no chance of a leaked touch handler.
 */
function ExitPrompt({
  visible,
  onConfirm,
  onCancel,
  colors,
  bottomInset,
}: {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  bottomInset: number;
}) {
  const { t } = useTranslation();
  if (!visible) return null;
  // Tapping the dim backdrop calls onCancel (which already fires
  // selectionHaptic in the hook), so no extra haptic needed here.
  return (
    <Pressable
      style={[
        StyleSheet.absoluteFillObject,
        styles.exitBackdrop,
        { paddingBottom: spacingPixels[6] + bottomInset },
      ]}
      onPress={onCancel}
    >
      <Pressable
        style={[styles.exitSheet, { backgroundColor: colors.card }]}
        onPress={e => e.stopPropagation()}
      >
        <View style={styles.exitEmojiWrap}>
          <Text style={styles.exitEmoji}>🐿️</Text>
        </View>
        <Text style={[styles.exitTitle, { color: colors.text }]}>
          {t('weeklyCheckIn.exit.title')}
        </Text>
        <Text style={[styles.exitDesc, { color: colors.textMuted }]}>
          {t('weeklyCheckIn.exit.description')}
        </Text>
        {/* Primary = "Keep going" (the recommended choice). Secondary = "Exit
            for now" rendered as a ghost button so it reads clearly as the
            alternative without depending on the faint outline-border color
            that can wash out in dark mode. */}
        <View style={styles.exitButtons}>
          <Button variant="primary" size="md" fullWidth rounded onPress={onCancel}>
            {t('weeklyCheckIn.exit.cancel')}
          </Button>
          <Button variant="ghost" size="md" fullWidth rounded onPress={onConfirm}>
            {t('weeklyCheckIn.exit.confirm')}
          </Button>
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  pager: {
    flex: 1,
    flexDirection: 'row',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[5],
    gap: spacingPixels[3],
  },
  loadingHint: {
    fontSize: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMsg: {
    fontSize: 13,
    textAlign: 'center',
  },
  exitBackdrop: {
    backgroundColor: `${base.black}80`, // 50% opacity black scrim
    justifyContent: 'flex-end',
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    // Ensure the overlay paints above the pager + header on Android — RN
    // doesn't guarantee z-order from sibling render order without elevation.
    elevation: 50,
    zIndex: 50,
  },
  exitSheet: {
    borderRadius: radiusPixels['2xl'],
    paddingVertical: spacingPixels[5],
    paddingHorizontal: spacingPixels[5],
    ...shadowsSemanticNative.modal,
  },
  exitEmojiWrap: {
    alignItems: 'center',
    marginBottom: spacingPixels[2],
    // Give the emoji glyph extra vertical room — RN clips the top of emojis
    // when lineHeight equals fontSize. Wrapping in a sized container with
    // an explicit lineHeight prevents the clip on both iOS and Android.
    height: 52,
    justifyContent: 'center',
  },
  exitEmoji: {
    fontSize: 40,
    lineHeight: 48,
    textAlign: 'center',
  },
  exitTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacingPixels[1],
    letterSpacing: -0.3,
  },
  exitDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacingPixels[4],
  },
  exitButtons: {
    gap: spacingPixels[2],
  },
});
