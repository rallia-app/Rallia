/**
 * WeeklyCheckInScreen — root modal for the weekly check-in wizard.
 *
 * Full-screen layout modeled on PreOnboardingScreen.tsx:
 *   * Background: cream → pale-teal vertical gradient (no decorative blobs)
 *   * Pager: 4 steps side-by-side in a row that's SCREEN_WIDTH × 4 wide,
 *     translateX driven by a single Animated.timing (280ms cubic-out, native driver)
 *   * Header: back chevron (steps 2-3) + progress dots
 *   * Footer: each step manages its own CTA
 *
 * The weekly check-in is mandatory: there is no exit affordance and swipe-to-
 * dismiss is disabled at the navigator (gestureEnabled: false). The wizard only
 * leaves the screen once the user completes it (Done on the final step).
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetManager } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { accent, primary, spacingPixels } from '@rallia/design-system';

import * as Analytics from '#/services/analytics';
import { useTranslation } from '#/hooks';

import { WizardHeader } from './components/WizardHeader';
import { AvailabilityStep } from './steps/AvailabilityStep';
import { RecapGoalStep, deriveVariant } from './steps/RecapGoalStep';
import { AutoMatchStep } from './steps/AutoMatchStep';
import { AllSetStep } from './steps/AllSetStep';
import { useWeeklyCheckInWizard } from './useWeeklyCheckInWizard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function WeeklyCheckInScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const insets = useSafeAreaInsets();

  const dismissModal = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const wizard = useWeeklyCheckInWizard();

  // Analytics: which entry point opened the wizard (set by the navigator param).
  const route = useRoute();
  const source = (route.params as { source?: string } | undefined)?.source ?? 'unknown';

  // Fire `weekly_checkin_opened` once, after the cold-start context loads so the
  // streak + recap variant are populated.
  const openedFiredRef = useRef(false);
  useEffect(() => {
    if (openedFiredRef.current || !wizard.context) return;
    openedFiredRef.current = true;
    Analytics.weeklyCheckinOpened({
      source,
      current_streak: wizard.context.currentStreak,
      recap_variant: deriveVariant(wizard.context),
    });
  }, [wizard.context, source]);

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

  // CTA → submit transition from the auto-match step to the All-Set step.
  // Fire mediumHaptic immediately on press so the tap feels responsive — the
  // submit() call ultimately fires successHaptic on success or errorHaptic on
  // failure, but those land ~1-2s later after the RPC roundtrip.
  const handleSubmit = useCallback(async () => {
    mediumHaptic();
    try {
      await wizard.submit();
      // submit() advances to the final step internally; the slide animation
      // runs from the useEffect above via the currentStep dependency change.
    } catch {
      // Errors are logged + errorHaptic'd inside submit(); ignore here so the
      // wizard stays on the auto-match step for the user to retry.
    }
  }, [wizard]);

  const handleDone = useCallback(() => {
    lightHaptic();
    Analytics.weeklyCheckinCompleted({
      duration_seconds: Math.round((Date.now() - wizard.startedAt) / 1000),
      new_streak: wizard.result?.newStreak ?? wizard.context?.currentStreak ?? 0,
    });
    dismissModal();
  }, [dismissModal, wizard.startedAt, wizard.result, wizard.context]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Gradient extends edge-to-edge underneath the safe-area padding. */}
      <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />

      {/* Top inset. On iOS this screen presents as a card modal that already
          starts below the status bar, so we only need a small breathing gap —
          spending the full safe-area inset there leaves a dead band above the
          header. On Android the modal is full-screen, so keep the real inset
          to clear the status bar / notch. */}
      <View style={{ height: Platform.OS === 'ios' ? spacingPixels[5] : insets.top }} />

      {/* When the recap step is skipped, the header renumbers to 3 dots so
          availability reads as step 1 of 3. */}
      <WizardHeader
        currentStep={wizard.skipRecapStep ? wizard.currentStep - 1 : wizard.currentStep}
        totalSteps={wizard.skipRecapStep ? wizard.totalSteps - 1 : wizard.totalSteps}
        showBack={wizard.currentStep > (wizard.skipRecapStep ? 2 : 1) && wizard.currentStep < 4}
        onBack={wizard.goBack}
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
            <RecapGoalStep
              context={wizard.context}
              frequencyGoal={wizard.frequencyGoal}
              setFrequencyGoal={wizard.setFrequencyGoal}
              previousGoal={
                wizard.context.lastFrequencyGoal ?? wizard.context.lastWeekFrequencyGoal ?? null
              }
              onContinue={wizard.goNext}
            />
          ) : (
            <View style={styles.loading}>
              {wizard.contextError ? (
                <>
                  <Text style={[styles.errorTitle, { color: colors.text }]}>
                    {t('weeklyCheckIn.loadError')}
                  </Text>
                  <Text style={[styles.errorMsg, { color: colors.textMuted }]}>
                    {wizard.contextError.message}
                  </Text>
                </>
              ) : (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingHint, { color: colors.textMuted }]}>
                    {t('common.loading')}
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
            window={wizard.context?.window ?? []}
          />
        </StepSlot>

        <StepSlot>
          <AutoMatchStep
            autoCreate={wizard.autoCreate}
            setAutoCreate={wizard.setAutoCreate}
            autoInvite={wizard.autoInvite}
            setAutoInvite={wizard.setAutoInvite}
            isSubmitting={wizard.isSubmitting}
            onSubmit={handleSubmit}
          />
        </StepSlot>

        <StepSlot>
          {wizard.result && (
            <AllSetStep
              frequencyGoal={wizard.frequencyGoal}
              hoursConfirmed={wizard.windowCellCount}
              autoCreate={wizard.autoCreate}
              autoInvite={wizard.autoInvite}
              onDone={handleDone}
            />
          )}
        </StepSlot>
      </Animated.View>
    </View>
  );
}

function StepSlot({ children }: { children: React.ReactNode }) {
  return <View style={{ width: SCREEN_WIDTH, height: '100%' }}>{children}</View>;
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
});
