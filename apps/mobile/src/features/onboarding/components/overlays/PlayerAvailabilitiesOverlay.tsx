/**
 * PlayerAvailabilitiesActionSheet
 *
 * Action-sheet wrapper around the hourly availability editor. Two modes:
 *   • onboarding — saves directly via OnboardingService.saveAvailability,
 *     stamps last_confirmed_at, completes onboarding.
 *   • edit — hands the new grid back to the caller (e.g. UserProfile) via
 *     `onSave(grid, privacy)`. The caller is responsible for persisting.
 *
 * The grid is the hourly 7×17 component from
 * `components/HourlyAvailabilityGrid`; presets come from the matching
 * presets component. Both are controlled by local `selection` state here,
 * which is seeded from the caller's `initialData`.
 *
 */
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { OnboardingService, Logger } from '@rallia/shared-services';
import type { OnboardingAvailability, DayEnum } from '@rallia/shared-types';
import { mediumHaptic } from '@rallia/shared-utils';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

import ProgressIndicator from '#/features/onboarding/components/ProgressIndicator';
import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';
import { useLocale } from '#/context';
import * as Analytics from '#/services/analytics';
import {
  HourlyAvailabilityGrid,
  cellKey,
  emptyGrid,
  type HourGrid,
} from '#/features/onboarding/components/HourlyAvailabilityGrid';
import { HourlyAvailabilityPresets } from '#/features/onboarding/components/HourlyAvailabilityPresets';

const MIN_SELECTIONS = 6;

// =============================================================================
// COMPONENT
// =============================================================================

export function PlayerAvailabilitiesActionSheet({ payload }: SheetProps<'player-availabilities'>) {
  const mode = payload?.mode || 'onboarding';
  const onClose = () => SheetManager.hide('player-availabilities');
  const onBack = payload?.onBack;
  const onContinue = payload?.onContinue;
  const onSave = payload?.onSave;
  const currentStep = payload?.currentStep || 1;
  const totalSteps = payload?.totalSteps || 8;
  const initialData = payload?.initialData;
  const _selectedSportIds = payload?.selectedSportIds;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const toast = useToast();

  const [selection, setSelection] = useState<HourGrid>(initialData ?? emptyGrid());
  const [isSaving, setIsSaving] = useState(false);

  const gridColors = useMemo(
    () => ({
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      border: colors.inputBorder,
      cellInactive: colors.inputBackground,
      cellActive: colors.primary,
    }),
    [colors]
  );

  const presetColors = useMemo(
    () => ({
      presetActiveBg: colors.primary,
      presetInactiveBg: colors.inputBackground,
      presetActiveBorder: colors.primary,
      presetInactiveBorder: colors.inputBorder,
      presetActiveText: colors.primaryForeground,
      presetInactiveText: colors.text,
      textMuted: colors.textMuted,
      border: colors.inputBorder,
    }),
    [colors]
  );

  const handleContinue = async () => {
    mediumHaptic();
    if (isSaving) return;

    // Edit mode: detect refresh-only save (no data change) so analytics can
    // distinguish weekly-confirm taps from real edits. The Save button stays
    // tappable even on no-op so users can refresh last_confirmed_at via the
    // weekly prompt.
    if (mode === 'edit' && onSave) {
      if (selection.size < MIN_SELECTIONS) {
        toast.error(t('alerts.minAvailabilitiesRequired'));
        return;
      }
      const wasRefreshOnly = !!initialData && setsEqual(selection, initialData);
      Analytics.availabilityScheduleUpdated({ was_refresh_only: wasRefreshOnly });
      onSave(selection);
      SheetManager.hide('player-availabilities');
      return;
    }

    // Onboarding mode: persist directly.
    if (onContinue) {
      setIsSaving(true);
      try {
        const availabilityData: OnboardingAvailability[] = [];
        for (const key of selection) {
          const sepIdx = key.lastIndexOf('-');
          const day = key.slice(0, sepIdx) as DayEnum;
          const hour = Number(key.slice(sepIdx + 1));
          availabilityData.push({ day, hour_of_day: hour, is_active: true });
        }

        const { error } = await OnboardingService.saveAvailability(availabilityData);
        if (error) {
          Logger.error('Failed to save player availability', error as Error, { availabilityData });
          setIsSaving(false);
          toast.error(t('onboarding.validation.failedToSaveAvailability'));
          return;
        }
        Logger.debug('player_availabilities_saved', { count: availabilityData.length });
        Analytics.availabilityScheduleUpdated({ was_refresh_only: false });

        const { error: completeError } = await OnboardingService.completeOnboarding();
        if (completeError) {
          Logger.warn('Failed to mark onboarding as completed', { error: completeError });
        } else {
          Logger.info('onboarding_completed', {
            message: 'Onboarding marked as completed in profile',
          });
        }

        onContinue(selection);
      } catch (error) {
        Logger.error('Unexpected error saving availability', error as Error);
        setIsSaving(false);
        toast.error(t('onboarding.validation.unexpectedError'));
      }
    }
  };

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }}>
              {t('onboarding.availabilityStep.title')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {mode === 'onboarding' && (
            <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
          )}

          {mode === 'onboarding' && onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}

          <HourlyAvailabilityPresets
            value={selection}
            onChange={setSelection}
            colors={presetColors}
            t={t}
          />

          <View style={styles.gridWrapper}>
            <HourlyAvailabilityGrid
              value={selection}
              onChange={setSelection}
              colors={gridColors}
              t={t}
              locale={locale}
            />
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              isSaving && { opacity: 0.6 },
            ]}
            onPress={handleContinue}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                {mode === 'edit'
                  ? t('onboarding.availabilityStep.saveButton')
                  : t('onboarding.availabilityStep.complete')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

export default PlayerAvailabilitiesActionSheet;

// Helper: shallow equality between two Sets of cell keys. Used to detect
// "refresh only" saves so analytics can distinguish them from real edits.
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

// Re-export so legacy imports (UserProfile, sheet registry payload typing)
// keep resolving. The old `DayAvailability` / `WeeklyAvailability` shapes
// are gone; consumers now thread `HourGrid` through.
export { cellKey, type HourGrid };

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  modalContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacingPixels[3],
    paddingTop: spacingPixels[2],
    paddingBottom: 0,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  gridWrapper: {
    marginTop: spacingPixels[2],
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});
