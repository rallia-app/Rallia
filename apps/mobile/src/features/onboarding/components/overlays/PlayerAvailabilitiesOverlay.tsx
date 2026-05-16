import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  ScrollView as RNScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { OnboardingService, Logger, supabase } from '@rallia/shared-services';
import type { DayEnum, PeriodEnum, OnboardingAvailability } from '@rallia/shared-types';
import ProgressIndicator from '../ProgressIndicator';
import { selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation, type TranslationKey } from '../../../../hooks';
import { radiusPixels, spacingPixels } from '@rallia/design-system';
import * as Analytics from '../../../../services/analytics';

type TimeSlot = PeriodEnum;
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type DayAvailability = Record<PeriodEnum, boolean>;
export type WeeklyAvailability = Record<DayOfWeek, DayAvailability>;

const TIME_SLOTS: TimeSlot[] = ['early', 'morning', 'midday', 'afternoon', 'evening', 'late'];
const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKEND: DayOfWeek[] = ['Sat', 'Sun'];

const SLOT_TO_I18N_KEY: Record<TimeSlot, TranslationKey> = {
  early: 'onboarding.availabilityStep.early',
  morning: 'onboarding.availabilityStep.morning',
  midday: 'onboarding.availabilityStep.midday',
  afternoon: 'onboarding.availabilityStep.afternoon',
  evening: 'onboarding.availabilityStep.evening',
  late: 'onboarding.availabilityStep.late',
};

const SLOT_TO_RANGE_KEY: Record<TimeSlot, TranslationKey> = {
  early: 'onboarding.availabilityStep.earlyRange',
  morning: 'onboarding.availabilityStep.morningRange',
  midday: 'onboarding.availabilityStep.middayRange',
  afternoon: 'onboarding.availabilityStep.afternoonRange',
  evening: 'onboarding.availabilityStep.eveningRange',
  late: 'onboarding.availabilityStep.lateRange',
};

interface Preset {
  key: 'afterWork' | 'weekendsAny' | 'weekdayLunches' | 'mornings';
  labelKey: TranslationKey;
  apply: () => Partial<Record<DayOfWeek, TimeSlot[]>>;
}

const PRESETS: Preset[] = [
  {
    key: 'afterWork',
    labelKey: 'onboarding.availabilityStep.presets.afterWork',
    apply: () => Object.fromEntries(WEEKDAYS.map(d => [d, ['evening', 'late']])),
  },
  {
    key: 'weekendsAny',
    labelKey: 'onboarding.availabilityStep.presets.weekendsAny',
    apply: () => Object.fromEntries(WEEKEND.map(d => [d, [...TIME_SLOTS]])),
  },
  {
    key: 'weekdayLunches',
    labelKey: 'onboarding.availabilityStep.presets.weekdayLunches',
    apply: () => Object.fromEntries(WEEKDAYS.map(d => [d, ['midday']])),
  },
  {
    key: 'mornings',
    labelKey: 'onboarding.availabilityStep.presets.mornings',
    apply: () => Object.fromEntries(DAYS.map(d => [d, ['early', 'morning']])),
  },
];

const DAY_TRANSLATION_KEY: Record<DayOfWeek, string> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
};

const DAY_MAP: Record<DayOfWeek, DayEnum> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
};

const STALENESS_DAYS = 14;

const emptyDay = (): DayAvailability => ({
  early: false,
  morning: false,
  midday: false,
  afternoon: false,
  evening: false,
  late: false,
});

const defaultAvailabilities = (): WeeklyAvailability => ({
  Mon: emptyDay(),
  Tue: emptyDay(),
  Wed: emptyDay(),
  Thu: emptyDay(),
  Fri: emptyDay(),
  Sat: emptyDay(),
  Sun: emptyDay(),
});

export function PlayerAvailabilitiesActionSheet({ payload }: SheetProps<'player-availabilities'>) {
  const mode = payload?.mode || 'onboarding';
  const onClose = () => SheetManager.hide('player-availabilities');
  const onBack = payload?.onBack;
  const onContinue = payload?.onContinue;
  const onSave = payload?.onSave;
  const currentStep = payload?.currentStep || 1;
  const totalSteps = payload?.totalSteps || 8;
  const initialData = payload?.initialData;
  const initialPrivacyShowAvailability = payload?.initialPrivacyShowAvailability ?? true;
  const initialLastConfirmedAt = payload?.initialLastConfirmedAt ?? null;
  const _selectedSportIds = payload?.selectedSportIds;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();

  const [availabilities, setAvailabilities] = useState<WeeklyAvailability>(
    initialData || defaultAvailabilities()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [privacyShowAvailability, setPrivacyShowAvailability] = useState(
    initialPrivacyShowAvailability
  );

  // Staleness — show the "confirm your week" banner whenever last_confirmed_at
  // is missing or older than STALENESS_DAYS. Visible in edit mode only; the
  // onboarding flow already implies a fresh write.
  const isStale = useMemo(() => {
    if (mode !== 'edit') return false;
    if (!initialLastConfirmedAt) return true;
    const last = new Date(initialLastConfirmedAt).getTime();
    if (Number.isNaN(last)) return true;
    return Date.now() - last > STALENESS_DAYS * 24 * 60 * 60 * 1000;
  }, [mode, initialLastConfirmedAt]);

  const toggleAvailability = (day: DayOfWeek, slot: TimeSlot) => {
    selectionHaptic();
    setAvailabilities(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [slot]: !prev[day][slot],
      },
    }));
  };

  // Smart toggle: tap a day letter to fill (or clear) all 6 blocks of that
  // day at once. If every block is already filled the tap clears the day.
  const toggleDay = (day: DayOfWeek) => {
    selectionHaptic();
    setAvailabilities(prev => {
      const allFilled = TIME_SLOTS.every(slot => prev[day][slot]);
      const next: DayAvailability = TIME_SLOTS.reduce(
        (acc, slot) => ({ ...acc, [slot]: !allFilled }),
        {} as DayAvailability
      );
      return { ...prev, [day]: next };
    });
  };

  // Same idea, the other axis: tap a time-block label to fill/clear that
  // block across all 7 days.
  const toggleTimeBlock = (slot: TimeSlot) => {
    selectionHaptic();
    setAvailabilities(prev => {
      const allFilled = DAYS.every(day => prev[day][slot]);
      const next: WeeklyAvailability = DAYS.reduce(
        (acc, day) => ({
          ...acc,
          [day]: { ...prev[day], [slot]: !allFilled },
        }),
        {} as WeeklyAvailability
      );
      return next;
    });
  };

  // Presets are toggleable: tap once to apply the pattern, tap again to
  // clear those exact cells. We detect "applied" by checking that every
  // cell in the preset's pattern is currently filled — if any cell of the
  // pattern is missing, the tap fills the gap rather than clearing.
  const isPresetApplied = (preset: Preset, state: WeeklyAvailability) => {
    const pattern = preset.apply();
    return (Object.entries(pattern) as Array<[DayOfWeek, TimeSlot[]]>).every(([day, slots]) =>
      slots.every(slot => state[day]?.[slot])
    );
  };

  const togglePreset = (preset: Preset) => {
    selectionHaptic();
    setAvailabilities(prev => {
      const pattern = preset.apply();
      const applied = isPresetApplied(preset, prev);
      const next: WeeklyAvailability = { ...prev };
      (Object.entries(pattern) as Array<[DayOfWeek, TimeSlot[]]>).forEach(([day, slots]) => {
        next[day] = { ...prev[day] };
        slots.forEach(slot => {
          next[day][slot] = !applied;
        });
      });
      return next;
    });
  };

  const clearAll = () => {
    selectionHaptic();
    setAvailabilities(defaultAvailabilities());
  };

  const totalSelections = useMemo(
    () =>
      DAYS.reduce(
        (count, day) => count + TIME_SLOTS.filter(slot => availabilities[day][slot]).length,
        0
      ),
    [availabilities]
  );

  const handleContinue = async () => {
    mediumHaptic();

    if (isSaving) return;

    // Edit mode: hand the in-memory state back to the caller, who is
    // responsible for persisting via OnboardingService.saveAvailability (which
    // bumps last_confirmed_at). The Save button intentionally remains tappable
    // even when no toggles changed — tapping "Save" refreshes the freshness
    // timestamp, which is the "I confirm this week" UX driven by the weekly
    // refresh notification.
    if (mode === 'edit' && onSave) {
      const selectedCount = DAYS.reduce(
        (count, day) => count + TIME_SLOTS.filter(slot => availabilities[day][slot]).length,
        0
      );
      if (selectedCount < 3) {
        toast.error(t('alerts.minAvailabilitiesRequired'));
        return;
      }
      // Detect no-op "refresh only" save vs a real edit so the analytics
      // event can distinguish weekly-confirm taps from actual schedule
      // changes. Cheap structural compare against the initial payload.
      const wasRefreshOnly =
        !!initialData && JSON.stringify(availabilities) === JSON.stringify(initialData);
      Analytics.availabilityScheduleUpdated({ was_refresh_only: wasRefreshOnly });
      onSave(availabilities, privacyShowAvailability);
      SheetManager.hide('player-availabilities');
      return;
    }

    // Onboarding mode: save to database
    if (onContinue) {
      setIsSaving(true);
      try {
        // Slot keys match the DB period_enum 1:1 after the 6-block refactor —
        // no AM→morning translation needed.
        const availabilityData: OnboardingAvailability[] = [];
        DAYS.forEach(day => {
          TIME_SLOTS.forEach(slot => {
            if (availabilities[day][slot]) {
              availabilityData.push({
                day: DAY_MAP[day],
                period: slot,
                is_active: true,
              });
            }
          });
        });

        const { error } = await OnboardingService.saveAvailability(availabilityData);

        if (error) {
          Logger.error('Failed to save player availability', error as Error, { availabilityData });
          setIsSaving(false);
          toast.error(t('onboarding.validation.failedToSaveAvailability'));
          return;
        }

        Logger.debug('player_availabilities_saved', { availabilityData });
        Analytics.availabilityScheduleUpdated({ was_refresh_only: false });

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { error: privacyError } = await supabase
            .from('player')
            .update({ privacy_show_availability: privacyShowAvailability })
            .eq('id', user.id);

          if (privacyError) {
            Logger.warn('Failed to save availability privacy setting', { error: privacyError });
          } else {
            Logger.debug('availability_privacy_saved', { privacyShowAvailability });
          }
        }

        const { error: completeError } = await OnboardingService.completeOnboarding();
        if (completeError) {
          Logger.warn('Failed to mark onboarding as completed', { error: completeError });
        } else {
          Logger.info('onboarding_completed', {
            message: 'Onboarding marked as completed in profile',
          });
        }

        onContinue(availabilities);
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
          contentContainerStyle={[styles.content, { paddingBottom: spacingPixels[8] }]}
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

          {isStale && (
            <View style={[styles.staleBanner, { backgroundColor: colors.inputBackground }]}>
              <Ionicons name="time-outline" size={18} color={colors.text} />
              <Text size="sm" style={[styles.staleBannerText, { color: colors.text }]}>
                {t('playerAvailability.staleHint')}
              </Text>
            </View>
          )}

          <Text style={[styles.subtitle, { color: colors.text }]}>
            {t('onboarding.availabilityStep.subtitle')}
          </Text>

          {/* Preset chips — tap to toggle a common pattern on/off. Active
              chips render with the primary fill so the user can see at a
              glance which presets are currently part of their selection. */}
          <RNScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetRow}
          >
            {PRESETS.map(preset => {
              const active = isPresetApplied(preset, availabilities);
              return (
                <TouchableOpacity
                  key={preset.key}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: active ? colors.primary : colors.inputBackground,
                      borderColor: active ? colors.primary : colors.inputBorder,
                    },
                  ]}
                  onPress={() => togglePreset(preset)}
                  activeOpacity={0.7}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: active }}
                >
                  {active && (
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={colors.primaryForeground}
                      style={styles.presetChipIcon}
                    />
                  )}
                  <Text
                    size="xs"
                    weight="semibold"
                    color={active ? colors.primaryForeground : colors.text}
                  >
                    {t(preset.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {totalSelections > 0 && (
              <TouchableOpacity
                style={[
                  styles.presetChip,
                  { backgroundColor: 'transparent', borderColor: colors.inputBorder },
                ]}
                onPress={clearAll}
                activeOpacity={0.7}
              >
                <Text size="xs" weight="semibold" color={colors.textMuted}>
                  {t('onboarding.availabilityStep.presets.clear')}
                </Text>
              </TouchableOpacity>
            )}
          </RNScrollView>

          <View style={styles.gridContainer}>
            <View style={styles.headerRow}>
              <View style={styles.timeLabelCell} />
              {DAYS.map(day => (
                <TouchableOpacity
                  key={`header-${day}`}
                  style={styles.headerCell}
                  onPress={() => toggleDay(day)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(`playerDirectory.dayLetters.${DAY_TRANSLATION_KEY[day]}` as TranslationKey)} — ${t('onboarding.availabilityStep.toggleDayHint')}`}
                >
                  <Text size="xs" weight="semibold" color={colors.textMuted}>
                    {t(`playerDirectory.dayLetters.${DAY_TRANSLATION_KEY[day]}` as TranslationKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {TIME_SLOTS.map(slot => (
              <View key={slot} style={styles.row}>
                <TouchableOpacity
                  style={styles.timeLabelCell}
                  onPress={() => toggleTimeBlock(slot)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(SLOT_TO_I18N_KEY[slot])} — ${t('onboarding.availabilityStep.toggleBlockHint')}`}
                >
                  <Text size="sm" weight="semibold" color={colors.text}>
                    {t(SLOT_TO_I18N_KEY[slot])}
                  </Text>
                  <Text size="xs" color={colors.textMuted} style={styles.timeRangeText}>
                    {t(SLOT_TO_RANGE_KEY[slot])}
                  </Text>
                </TouchableOpacity>
                {DAYS.map(day => {
                  const isSelected = availabilities[day][slot];
                  return (
                    <TouchableOpacity
                      key={`${day}-${slot}`}
                      style={[
                        styles.dayCell,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.inputBackground,
                          borderColor: isSelected ? colors.primary : colors.inputBorder,
                        },
                      ]}
                      onPress={() => toggleAvailability(day, slot)}
                      activeOpacity={0.8}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`${t(`onboarding.availabilityStep.days.${DAY_TRANSLATION_KEY[day]}` as TranslationKey)} ${t(SLOT_TO_I18N_KEY[slot])}`}
                    />
                  );
                })}
              </View>
            ))}
          </View>

          <View style={[styles.privacySection, { borderTopColor: colors.border }]}>
            <View style={styles.privacyHeader}>
              <Ionicons
                name={privacyShowAvailability ? 'globe-outline' : 'lock-closed-outline'}
                size={20}
                color={colors.text}
              />
              <Text weight="semibold" style={[styles.privacyTitle, { color: colors.text }]}>
                {t('profile.availabilities.privacyTitle')}
              </Text>
            </View>
            <Text style={[styles.privacyDescription, { color: colors.textMuted }]}>
              {privacyShowAvailability
                ? t('profile.availabilities.publicDescription')
                : t('profile.availabilities.privateDescription')}
            </Text>
            <View style={styles.privacyToggleRow}>
              <Text style={{ color: colors.text }}>
                {privacyShowAvailability
                  ? t('profile.availabilities.public')
                  : t('profile.availabilities.private')}
              </Text>
              <Switch
                value={privacyShowAvailability}
                onValueChange={value => {
                  selectionHaptic();
                  setPrivacyShowAvailability(value);
                }}
                trackColor={{ false: colors.inputBackground, true: colors.primary }}
                thumbColor={colors.card}
              />
            </View>
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
    padding: spacingPixels[4],
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[4],
  },
  staleBannerText: {
    flex: 1,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacingPixels[6],
  },
  gridContainer: {
    marginBottom: spacingPixels[6],
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    marginBottom: spacingPixels[2],
    alignItems: 'center',
  },
  timeLabelCell: {
    width: 96,
    paddingRight: spacingPixels[2],
    justifyContent: 'center',
  },
  timeRangeText: {
    marginTop: 2,
    lineHeight: 14,
  },
  presetRow: {
    paddingVertical: spacingPixels[1],
    gap: spacingPixels[2],
    marginBottom: spacingPixels[4],
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  presetChipIcon: {
    marginRight: spacingPixels[1],
  },
  headerCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCell: {
    flex: 1,
    height: 36,
    borderRadius: radiusPixels.md,
    marginHorizontal: spacingPixels[1] / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
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
  privacySection: {
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  privacyTitle: {
    fontSize: 16,
  },
  privacyDescription: {
    fontSize: 13,
    marginBottom: spacingPixels[3],
  },
  privacyToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
